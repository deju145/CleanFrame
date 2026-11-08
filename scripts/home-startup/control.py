"""Prepare, inspect, plan, apply or restore a bounded Home-and-startup experiment."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import uuid
import xml.etree.ElementTree as XML

HERE = Path(__file__).resolve().parent
KEYS = ('main_operation', 'db/appfw/home_appid', 'db/appfw/startup_appid',
        'db/appfw/booting_appid_backup', 'db/first_screen/type',
        'db/menu/smart_hub/ontvsetting/auto_start')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, data, mode=0o400):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)


def verify_bundle():
    manifest = json.loads((HERE / 'control-manifest.json').read_bytes())
    if manifest.get('scope') != 'home-and-startup':
        raise RuntimeError('Expected the separate Home-and-startup bundle.')
    for name, digest in manifest['files'].items():
        if Path(name).name != name or sha((HERE / name).read_bytes()) != digest:
            raise RuntimeError('Control bundle checksum failed: ' + name)
    return manifest


def validate_snapshot(data):
    snapshot = json.loads(data)
    host = str(ipaddress.IPv4Address(snapshot['host']))
    if snapshot['serial'] != host + ':26101':
        raise ValueError('Snapshot serial/host mismatch.')
    query = snapshot['query']
    if query['schema'] != 1 or query['uid'] != 901 or query['architecture'] != 'Arm':
        raise ValueError('Expected original SDK UID 901 ARM32 snapshot.')
    for name in ['firmware', 'os', 'boot_id']:
        item = query[name]
        if item['status'] != 'ok' or not isinstance(item['value'], str) or not item['value'].strip():
            raise ValueError('Original ' + name + ' is unavailable.')
    if set(query['values']) != set(KEYS):
        raise ValueError('Snapshot has missing or extra native settings.')
    for name in KEYS:
        item = query['values'][name]
        if item['status'] != 'ok':
            raise ValueError('Original setting unavailable: ' + name)
        value = item['value']
        if name == KEYS[-1]:
            if type(value) is not int or value not in (0, 1):
                raise ValueError('Unsupported autostart type or value.')
        elif not isinstance(value, str) or not value.strip():
            raise ValueError('Original string setting is empty or unavailable: ' + name)
    if query['values'][KEYS[0]]['value'] != query['values'][KEYS[1]]['value']:
        raise ValueError('Original Home getters disagree.')
    return snapshot


def tv_info(host):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://' + host + ':8001/api/v2/', timeout=8) as response:
        info = json.load(response)['device']
    if not isinstance(info.get('duid'), str) or not info['duid'] or not isinstance(info.get('modelName'), str):
        raise ValueError('TV API did not return a stable device ID and exact model.')
    return {name: info[name] for name in ['duid', 'modelName']}


def sdb_run(profile, *args):
    result = subprocess.run([profile['sdb'], *args], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError('SDB failed: ' + result.stdout[-600:] + result.stderr[-600:])
    return result.stdout


def connected(profile, require_installed):
    serial = profile['host'] + ':26101'
    devices = sdb_run(profile, 'devices')
    if not any(line.split()[:2] == [serial, 'device'] for line in devices.splitlines()):
        raise RuntimeError('TV is not connected; run your SDB reconnect sequence first.')
    if require_installed:
        listing = sdb_run(profile, '-s', serial, 'shell', '0', 'vd_applist')
        if not re.search(r'\bapp_id\s*=\s*' + re.escape(profile['target']) + r'(?=-|\s|$)', listing):
            raise RuntimeError('The exact CleanFrame application ID was not found on the TV.')


def prepare(args):
    manifest = verify_bundle()
    project = args.project.resolve()
    recovery = args.recovery.expanduser().resolve() / 'home-startup'
    if recovery.is_relative_to(project):
        raise ValueError('Recovery folder must be outside the project checkout.')
    raw = args.snapshot.expanduser().read_bytes()
    snapshot = validate_snapshot(raw)
    settings = json.loads((project / '.local/signing.json').read_bytes())
    app = XML.fromstring((project / 'app/config.xml').read_bytes()).find('{http://tizen.org/ns/widgets}application')
    if app is None:
        raise ValueError('Project manifest has no application identity.')
    package = settings.get('package_id', app.get('package'))
    target = settings.get('app_id', app.get('id'))
    if not isinstance(package, str) or not re.fullmatch(r'[A-Za-z0-9]{10}', package) or not isinstance(target, str) or not re.fullmatch(re.escape(package) + r'\.[A-Za-z0-9_-]{1,52}', target):
        raise ValueError('Invalid local signing identity.')
    if any(item['value'] == target for item in snapshot['query']['values'].values()):
        raise ValueError('Original settings already contain the target; review before preparing recovery.')
    sdk = Path(settings['sdk_path']).expanduser()
    if not sdk.is_absolute():
        sdk = project / sdk
    device = tv_info(snapshot['host'])
    if device['modelName'] != args.expected_model:
        raise ValueError('Exact TV model check failed.')
    profile = {'schema': 1, 'scope': 'home-and-startup', 'host': snapshot['host'], 'device': device,
               'target': target, 'package': package, 'sdb': str(sdk.resolve() / 'tools/sdb'),
               'original_sha256': sha(raw)}
    connected(profile, True)
    recovery.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name in [*manifest['files'], 'control-manifest.json']:
        write_private(recovery / name, (HERE / name).read_bytes())
    write_private(recovery / 'original-query.json', raw)
    write_private(recovery / 'recovery.json', (json.dumps(profile, indent=2) + '\n').encode())
    print('Prepared external recovery folder:', recovery)
    print('Target:', target)
    print('Original snapshot SHA256:', profile['original_sha256'])
    print('No native settings changed. Next run plan from this recovery folder.')


def run_action(args):
    verify_bundle()
    profile = json.loads((HERE / 'recovery.json').read_bytes())
    if profile.get('scope') != 'home-and-startup':
        raise ValueError('This recovery profile is not for Home and startup.')
    raw = (HERE / 'original-query.json').read_bytes()
    if sha(raw) != profile['original_sha256']:
        raise ValueError('Saved original snapshot checksum failed.')
    original = validate_snapshot(raw)
    if original['host'] != profile['host'] or tv_info(profile['host']) != profile['device']:
        raise ValueError('Device identity differs from the saved recovery profile.')
    connected(profile, args.action in ('plan', 'apply'))
    if args.action == 'apply':
        if args.confirm_scope != 'home-and-startup':
            raise ValueError('Explicit Home-and-startup scope confirmation is required.')
        if args.confirm_target != profile['target']:
            raise ValueError('Apply requires --confirm-target with the exact resolved app ID.')
        plan = json.loads((HERE / 'verified-plan.json').read_bytes())
        if plan.get('transport_protocol') != 3 or plan.get('scope') != 'home-and-startup' or plan['original_sha256'] != profile['original_sha256'] or not plan['result']['Success'] or plan['result']['WriteAttempted']:
            raise ValueError('No successful read-only plan for this original snapshot.')
    request = {'schema': 1, 'transport_protocol': 3, 'scope': 'home-and-startup', 'action': args.action,
               'target': profile['target'], 'package': profile['package'],
               'original_sha256': profile['original_sha256'],
               'original_base64': base64.b64encode(raw).decode()}
    runtime = json.loads((HERE / 'control-runtimeconfig.json').read_bytes())
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:12]
    job = HERE / 'runs' / (args.action + '-' + stamp)
    job.mkdir(mode=0o700, parents=True)
    runner = (HERE / 'query_transport.py').read_text()
    replacements = {
        'One-shot read-only Home query. No apply, restore, launch or signing commands.':
            'Bounded Home-and-startup control transport. The requested action is ' + args.action + '.',
        'Staging a read-only query as SDK UID 901. No Home/startup writes.':
            'Staging Home-and-startup action ' + args.action + ' as SDK UID 901.',
        'Saved diagnostic snapshot:': 'Saved control receipt:',
        'This is a review candidate, not an approved recovery baseline. No settings changed.':
            'Control receipt saved. Inspect the action, result and all values; no automatic retry.'
    }
    for before, after in replacements.items():
        if runner.count(before) != 1:
            raise ValueError('Transport template differs from the reviewed version.')
        runner = runner.replace(before, after)
    write_private(job / 'query.py', runner.encode(), 0o600)
    write_private(job / 'Query.dll', (HERE / 'HomeStartup.dll').read_bytes(), 0o600)
    write_private(job / 'Query.runtimeconfig.json', json.dumps(runtime).encode(), 0o600)
    write_private(job / 'Request.json', json.dumps(request).encode(), 0o600)
    manifest = {'files': {name: sha((job / name).read_bytes()) for name in ['Query.dll', 'Query.runtimeconfig.json', 'Request.json']}}
    write_private(job / 'manifest.json', json.dumps(manifest).encode(), 0o600)
    print('Action:', args.action, '| Target:', profile['target'], flush=True)
    process = subprocess.run([sys.executable, str(job / 'query.py'), '--host', profile['host'], '--sdb', profile['sdb'], '--control-request'])
    if process.returncode:
        raise RuntimeError('Control action did not complete successfully. Keep all receipts. Inspect state before any retry.')
    receipts = list(job.glob('snapshot-*.json'))
    if len(receipts) != 1:
        raise RuntimeError('Expected one control receipt. State needs inspection.')
    receipt = json.loads(receipts[0].read_bytes())['query']
    if receipt.get('transport_protocol') != 3 or receipt.get('scope') != 'home-and-startup' or receipt.get('action') != args.action or receipt.get('original_sha256') != profile['original_sha256'] or not receipt.get('result', {}).get('Success'):
        raise RuntimeError('Control receipt verification failed; inspect before any retry.')
    if args.action == 'plan':
        if receipt['result']['WriteAttempted']:
            raise RuntimeError('Plan unexpectedly reports a write. Stop for review.')
        # Plans are fresh read-only evidence, not the immutable original backup.
        temporary = HERE / ('plan-' + uuid.uuid4().hex + '.json')
        write_private(temporary, (json.dumps(receipt, indent=2) + '\n').encode(), 0o600)
        temporary.replace(HERE / 'verified-plan.json')
        print('Read-only native plan verified. No settings changed.')
    else:
        print('Verified action:', args.action)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    preparation = commands.add_parser('prepare')
    preparation.add_argument('--snapshot', type=Path, required=True)
    preparation.add_argument('--recovery', type=Path, required=True)
    preparation.add_argument('--expected-model', required=True)
    preparation.add_argument('--project', type=Path, default=Path.cwd())
    for name in ['plan', 'inspect', 'restore', 'apply']:
        command = commands.add_parser(name)
        if name == 'apply':
            command.add_argument('--confirm-target', required=True)
            command.add_argument('--confirm-scope', choices=['home-and-startup'], required=True)
    args = parser.parse_args()
    if args.action == 'prepare': prepare(args)
    else: run_action(args)


if __name__ == '__main__':
    try: main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
