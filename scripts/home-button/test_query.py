"""Offline transport and output validation checks; never contacts a TV."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('home_query', Path(__file__).with_name('query.py'))
QUERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QUERY)
HOST = '192.0.2.8'


class Socket:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def connect(self, *args): pass
    def getsockname(self): return ('192.0.2.9', 43210)
    def bind(self, *args): pass
    def listen(self, *args): pass
    def settimeout(self, *args): pass
    def accept(self): return (self, (HOST, 1234))
    def recv(self, *args):
        data, self.payload = self.payload, b''
        return data


class Checks(unittest.TestCase):
    def exercise(self, *, corrupt=False, connected=True, caps='cpu_arch:armv7\nplatform_version:9.0\n', output=None, control=False, corrupt_request=False):
        if output is None:
            output = 'CLEANFRAME_HOME_QUERY=' + json.dumps({'uid': 901, 'architecture': 'Arm', 'values': {}}) + '\nCLEANFRAME_QUERY_CLEANUP=0\nCLEANFRAME_QUERY_EXIT=0\n'
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            files = {}
            for name in ['Query.dll', 'Query.runtimeconfig.json']:
                (folder / name).write_bytes(b'test fixture')
                files[name] = hashlib.sha256(b'test fixture').hexdigest()
            if control:
                payload = json.dumps({'schema': 1, 'transport_protocol': 2, 'action': 'plan'}).encode()
                (folder / 'Request.json').write_bytes(payload)
                files['Request.json'] = hashlib.sha256(payload).hexdigest()
                if corrupt_request:
                    (folder / 'Request.json').write_bytes(b'changed request')
            (folder / 'manifest.json').write_text(json.dumps({'files': files}))
            if corrupt: (folder / 'Query.dll').write_bytes(b'changed')
            original = folder / 'original.json'
            original.write_text('preserve this baseline')
            remote = folder / 'remote'
            remote.mkdir()
            actual_run = subprocess.run
            actual_popen = subprocess.Popen

            def run(args, **kwargs):
                calls.append(args)
                command = args[1:]
                result = ''
                if command == ['devices']:
                    result = HOST + ':26101 device TV\n' if connected else ''
                elif command[-1] == 'capability': result = caps
                elif 'push' in command:
                    shutil.copyfile(command[-2], command[-1])
                    if command[-2].endswith('.sh'):
                        script = Path(command[-2]).read_text()
                        self.assertIn('test "$(id -u)" = 901', script)
                        self.assertIn('sha256sum -c -', script)
                        self.assertNotIn('vconf_set', script)
                        invocation = shlex.split(next(line for line in script.splitlines() if line.startswith('/usr/bin/dotnet ')))
                        self.assertEqual(len(invocation), 3 if control else 2)
                        if control:
                            self.assertEqual(invocation[2], invocation[1].removesuffix('Query.dll') + 'Request.json')
                            # Exercise actual argv and file delivery on this host,
                            # without a TV, a network connection or runtime props.
                            code = 'import sys,json; from pathlib import Path; assert len(sys.argv)==3; assert Path(sys.argv[1]).read_bytes()==b"test fixture"; request=json.loads(Path(sys.argv[2]).read_bytes()); assert request["transport_protocol"]==2 and request["action"]=="plan"'
                            with patch.object(subprocess, 'Popen', actual_popen):
                                actual_run([sys.executable, '-c', code, *invocation[1:]], check=True, capture_output=True)
                            self.assertIn(invocation[2], next(line for line in script.splitlines() if line.startswith('trap ')))
                return SimpleNamespace(returncode=0, stdout=result, stderr='')

            error = None
            arguments = ['query.py', '--host', HOST] + (['--control-request'] if control else [])
            with patch.object(QUERY, '__file__', str(folder / 'query.py')), patch.object(QUERY, 'REMOTE', str(remote)), patch.object(QUERY.subprocess, 'run', side_effect=run), patch.object(QUERY.subprocess, 'Popen') as process, patch.object(QUERY.socket, 'socket', side_effect=lambda *args: Socket(output.encode())), patch('sys.argv', arguments), contextlib.redirect_stdout(io.StringIO()):
                process.return_value.poll.return_value = 0
                try: QUERY.main()
                except RuntimeError as caught: error = str(caught)
            self.assertEqual(original.read_text(), 'preserve this baseline')
            snapshots = list(folder.glob('snapshot-*.json'))
            return error, calls, len(snapshots)

    def test_bad_hash_does_not_contact_sdb(self):
        error, calls, count = self.exercise(corrupt=True)
        self.assertIn('checksum', error)
        self.assertEqual(calls, [])

    def test_missing_device_does_not_stage(self):
        error, calls, count = self.exercise(connected=False)
        self.assertIn('not connected', error)
        self.assertEqual(len(calls), 1)

    def test_wrong_architecture_does_not_stage(self):
        error, calls, count = self.exercise(caps='cpu_arch:aarch64\nplatform_version:9.0\n')
        self.assertIn('nothing staged', error)
        self.assertEqual(len(calls), 2)

    def test_missing_cleanup_is_not_accepted(self):
        error, calls, count = self.exercise(output='CLEANFRAME_QUERY_EXIT=0\n')
        self.assertIn('cleanup failed', error)
        self.assertEqual(count, 0)

    def test_valid_result_creates_candidate_only(self):
        error, calls, count = self.exercise()
        self.assertIsNone(error)
        self.assertEqual(count, 1)
        self.assertFalse(any('connect' in call for call in calls))

    def test_control_request_is_staged_hashed_and_passed_as_real_argv(self):
        error, calls, count = self.exercise(control=True)
        self.assertIsNone(error)
        self.assertEqual(count, 1)
        self.assertTrue(any('push' in call and call[-2].endswith('/Request.json') for call in calls))

    def test_changed_request_refused_before_sdb(self):
        error, calls, count = self.exercise(control=True, corrupt_request=True)
        self.assertIn('checksum failed: Request.json', error)
        self.assertEqual(calls, [])


if __name__ == '__main__': unittest.main()
