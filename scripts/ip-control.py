"""Set up CleanFrame HDMI 5 or install its existing signed widget through a paired SDB bridge.

Uses the owner's local AeroTizen Python source and existing private pairing.
No certificate creation, native Home writes, root setup, or automatic retries.
"""
import argparse
import http.client
import importlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import xml.etree.ElementTree as XML
import zipfile

from local_config import ROOT, load_settings
from private_files import check_signed_widget


class ControlError(ValueError):
    """A fixed, public-facing validation failure."""


class ResponseSocket:
    def __init__(self, data):
        self.data = data

    def makefile(self, *args):
        return io.BytesIO(self.data)


def read_token(path):
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT / 'app') or resolved.is_relative_to(ROOT / '.git'):
        raise ControlError('Token must stay outside app/ and .git/.')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) not in {0o600, 0o400}:
            raise ControlError('Token file must be owned by you with mode 600 or 400.')
        data = source.read(4097)
    if len(data) > 4096:
        raise ControlError('Token file is too large.')
    try:
        token = json.loads(data)['AccessToken']
    except (ValueError, KeyError, TypeError):
        raise ControlError('Invalid IP Control token file.') from None
    if not isinstance(token, str) or not 1 <= len(token) <= 2048:
        raise ControlError('Invalid IP Control token file.')
    return token


def service_request(session, method, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else b''
    packet = (f'{method} {path} HTTP/1.1\r\n'
              'Host: 127.0.0.1:47791\r\nConnection: close\r\n'
              'Content-Type: application/json\r\nX-CleanFrame-HDMI5: 1\r\n'
              f'Content-Length: {len(body)}\r\n\r\n').encode() + body
    data = session.tcp_request(47791, packet, timeout=12, max_output=32768)
    response = http.client.HTTPResponse(ResponseSocket(data))
    response.begin()
    result = json.loads(response.read())
    allowed_status = {200, 502} if method == 'GET' else {200}
    if response.status not in allowed_status or not isinstance(result, dict) or type(result.get('configured')) is not bool:
        raise ControlError('CleanFrame IP Control request failed. Open the updated app and its Inputs screen first.')
    return result


def validate_install_widget(widget, identity):
    check_signed_widget(widget, identity)
    with zipfile.ZipFile(widget) as archive:
        if not {'service/index.js', 'service/hdmi5.js'}.issubset(archive.namelist()):
            raise ControlError('The signed widget has no IP Control service. Package the updated source first.')
        manifest = XML.fromstring(archive.read('config.xml'))
        if len(manifest.findall('{http://tizen.org/ns/widgets}service')) != 1:
            raise ControlError('The signed widget has no IP Control service identity. Package the updated source first.')


def install(session, widget, identity):
    # Validate before sending any package bytes, and keep the owner's existing signatures.
    validate_install_widget(widget, identity)
    data = widget.read_bytes()
    remote = '/home/owner/share/tmp/sdk_tools/CleanFrame-IP-' + str(time.time_ns()) + '.wgt'
    session.push(data, remote)
    output = session.shell_bounded('0 vd_appinstall ' + identity['app_id'] + ' ' + remote,
                                   timeout=150, max_output=131072)
    if 'install completed' not in output or 'install failed' in output.lower():
        raise ControlError('Installation was not confirmed. Check the TV before retrying.')
    if not re.search(r'\bapp_id\s*=\s*' + re.escape(identity['app_id']) + r'(?![A-Za-z0-9_.-])', session.applist()):
        raise ControlError('Installed app was not found in the TV catalogue.')
    print('CleanFrame installation confirmed. Existing signing and Home settings retained.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'status', 'disable', 'install', 'launch'])
    parser.add_argument('--host', required=True, type=ipaddress.IPv4Address)
    parser.add_argument('--aerotizen-source', required=True, type=Path,
                        help='Trusted local AeroTizen cli/src directory; uses its existing paired SDB transport')
    parser.add_argument('--token-file', type=Path,
                        default=Path.home() / '.config/cleanframe-hdmi-diagnostics/ip-control-token.json')
    args = parser.parse_args()
    source = args.aerotizen_source.expanduser().resolve()
    if not (source / 'aerotizen/device.py').is_file():
        raise ControlError('Expected the local AeroTizen cli/src directory.')
    settings = load_settings()
    widget = ROOT / 'dist/CleanFrame.wgt'
    if args.action == 'install':
        validate_install_widget(widget, settings['identity'])
    token = read_token(args.token_file.expanduser()) if args.action == 'setup' else None
    sys.path.insert(0, str(source))
    try:
        DeviceSession = importlib.import_module('aerotizen.device').DeviceSession
    except ImportError:
        raise ControlError('Use the existing AeroTizen Python environment with websocket-client installed.') from None
    # AeroTizen owns bridge selection, certificate pinning, token authentication,
    # and the per-device lock. Never force direct SDB or change Developer Mode.
    with DeviceSession(str(args.host)) as session:
        if args.action == 'install':
            print('Installing the existing signed CleanFrame widget through SDB.', flush=True)
            install(session, widget, settings['identity'])
            return
        if args.action == 'launch':
            output = session.shell_bounded('0 execute ' + settings['identity']['app_id'], timeout=30)
            if 'successfully launched' not in output:
                raise ControlError('CleanFrame launch was not confirmed. Check the TV.')
            print('CleanFrame launch accepted; confirm it is visible on the TV.')
            return
        if args.action == 'setup':
            result = service_request(session, 'POST', '/control/hdmi5',
                                     {'schema': 1, 'host': str(args.host), 'token': token})
        elif args.action == 'disable':
            result = service_request(session, 'POST', '/control/hdmi5', {'enabled': False})
        else:
            result = service_request(session, 'GET', '/inputs/hdmi5')
        print('HDMI 5 configured:', result['configured'])
        if args.action == 'status':
            print('Input:', result.get('inputSource') or 'unknown')
            print('Read successful:', result.get('ok') is True)
        elif result['configured'] != (args.action == 'setup'):
            raise ControlError('The requested configuration change was not confirmed.')
        print('No native Home, startup, certificate, or root settings changed.')


if __name__ == '__main__':
    try:
        main()
    except ControlError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        # Bridge/HTTP responses and OS errors can contain private configuration.
        raise SystemExit('IP Control operation failed. Check the app/service, local paths and paired bridge. '
                         'No automatic retry was performed.') from None
