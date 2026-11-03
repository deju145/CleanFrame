"""Offline checks for exact backups and the Home-only request/receipt wrapper."""
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('home_control', SOURCE / 'control.py')
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)
HOST = '192.0.2.8'
DEVICE = {'duid': 'uuid:test-device', 'modelName': 'test-model'}


def original_bytes():
    values = {key: {'status': 'ok', 'value': ('samsung.home' if key in ('main_operation', 'db/appfw/home_appid', 'db/first_screen/type') else 'tv.viewer')} for key in CONTROL.KEYS}
    values[CONTROL.KEYS[-1]]['value'] = 0
    return json.dumps({'host': HOST, 'serial': HOST + ':26101', 'query': {
        'schema': 1, 'uid': 901, 'architecture': 'Arm',
        'firmware': {'status': 'ok', 'value': 'test-firmware'},
        'os': {'status': 'ok', 'value': 'test-os'},
        'boot_id': {'status': 'ok', 'value': 'test-boot-id'}, 'values': values
    }}).encode()


class Checks(unittest.TestCase):
    def bundle(self, folder):
        files = {'control.py': (SOURCE / 'control.py').read_bytes(),
                 'query_transport.py': (SOURCE / 'query.py').read_bytes(),
                 'HomeOnly.dll': b'helper fixture',
                 'control-runtimeconfig.json': b'{"runtimeOptions":{"tfm":"net6.0"}}'}
        for name, data in files.items(): (folder / name).write_bytes(data)
        (folder / 'control-manifest.json').write_text(json.dumps({'files': {name: CONTROL.sha(data) for name, data in files.items()}}))

    def test_unavailable_original_refused(self):
        value = json.loads(original_bytes())
        value['query']['values'][CONTROL.KEYS[1]]['status'] = 'unavailable'
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            CONTROL.validate_snapshot(json.dumps(value))

    def test_boolean_is_not_integer_autostart(self):
        value = json.loads(original_bytes())
        value['query']['values'][CONTROL.KEYS[-1]]['value'] = False
        with self.assertRaisesRegex(ValueError, 'type or value'):
            CONTROL.validate_snapshot(json.dumps(value))

    def test_disagreeing_original_getters_refused(self):
        value = json.loads(original_bytes())
        value['query']['values'][CONTROL.KEYS[0]]['value'] = 'other.home'
        with self.assertRaisesRegex(ValueError, 'disagree'):
            CONTROL.validate_snapshot(json.dumps(value))

    def test_prepare_keeps_exact_original_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); bundle = root / 'bundle'; bundle.mkdir(); self.bundle(bundle)
            project = root / 'project'; (project / '.local').mkdir(parents=True); (project / 'app').mkdir()
            settings = {'sdk_path': str(root / 'sdk'), 'package_id': 'abcdefghij', 'app_id': 'abcdefghij.CleanFrame'}
            (project / '.local/signing.json').write_text(json.dumps(settings))
            manifest = '<widget xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application package="abcdefghij" id="abcdefghij.CleanFrame"/></widget>'
            (project / 'app/config.xml').write_text(manifest)
            snapshot = root / 'snapshot.json'; snapshot.write_bytes(original_bytes())
            args = SimpleNamespace(project=project, recovery=root / 'backup', snapshot=snapshot, expected_model='test-model')
            with patch.object(CONTROL, 'HERE', bundle), patch.object(CONTROL, 'tv_info', return_value=DEVICE), patch.object(CONTROL, 'connected'), contextlib.redirect_stdout(io.StringIO()):
                CONTROL.prepare(args)
                with self.assertRaises(FileExistsError): CONTROL.prepare(args)
            self.assertEqual((root / 'backup/home-only/original-query.json').read_bytes(), original_bytes())
            self.assertEqual((project / '.local/signing.json').read_text(), json.dumps(settings))

    def test_recovery_inside_project_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.bundle(root)
            with patch.object(CONTROL, 'HERE', root):
                with self.assertRaisesRegex(ValueError, 'outside'):
                    CONTROL.prepare(SimpleNamespace(project=root, recovery=root / 'backup'))

    def test_plan_stages_correct_request_and_creates_verified_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); self.bundle(folder)
            raw = original_bytes()
            profile = {'host': HOST, 'sdb': '/test/sdb', 'device': DEVICE, 'package': 'abcdefghij', 'target': 'abcdefghij.CleanFrame', 'original_sha256': CONTROL.sha(raw)}
            (folder / 'original-query.json').write_bytes(raw)
            (folder / 'recovery.json').write_text(json.dumps(profile))

            def child(args):
                job = Path(args[1]).parent
                runtime = json.loads((job / 'Query.runtimeconfig.json').read_bytes())
                self.assertNotIn('configProperties', runtime['runtimeOptions'])
                self.assertIn('--control-request', args)
                request = json.loads((job / 'Request.json').read_bytes())
                self.assertEqual(request['transport_protocol'], 2)
                self.assertEqual(request['action'], 'plan')
                self.assertEqual(base64.b64decode(request['original_base64']), raw)
                manifest = json.loads((job / 'manifest.json').read_bytes())
                self.assertEqual(manifest['files']['Request.json'], CONTROL.sha((job / 'Request.json').read_bytes()))
                self.assertEqual(request['target'], profile['target'])
                self.assertNotIn('No settings changed.', (job / 'query.py').read_text())
                receipt = {'query': {'transport_protocol': 2, 'action': 'plan', 'original_sha256': profile['original_sha256'], 'result': {'Success': True, 'WriteAttempted': False}}}
                (job / 'snapshot-fixture.json').write_text(json.dumps(receipt))
                return SimpleNamespace(returncode=0)

            with patch.object(CONTROL, 'HERE', folder), patch.object(CONTROL, 'tv_info', return_value=DEVICE), patch.object(CONTROL, 'connected'), patch.object(CONTROL.subprocess, 'run', side_effect=child), contextlib.redirect_stdout(io.StringIO()):
                CONTROL.run_action(SimpleNamespace(action='plan'))
            self.assertEqual((folder / 'original-query.json').read_bytes(), raw)
            self.assertTrue(json.loads((folder / 'verified-plan.json').read_bytes())['result']['Success'])

    def test_apply_requires_exact_confirmation_and_a_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); self.bundle(folder)
            raw = original_bytes()
            profile = {'host': HOST, 'device': DEVICE, 'target': 'abcdefghij.CleanFrame', 'original_sha256': CONTROL.sha(raw)}
            (folder / 'original-query.json').write_bytes(raw)
            (folder / 'recovery.json').write_text(json.dumps(profile))
            with patch.object(CONTROL, 'HERE', folder), patch.object(CONTROL, 'tv_info', return_value=DEVICE), patch.object(CONTROL, 'connected'), patch.object(CONTROL.subprocess, 'run') as child:
                with self.assertRaisesRegex(ValueError, 'confirm-target'):
                    CONTROL.run_action(SimpleNamespace(action='apply', confirm_target='wrong.app'))
                with self.assertRaises(FileNotFoundError):
                    CONTROL.run_action(SimpleNamespace(action='apply', confirm_target=profile['target']))
                child.assert_not_called()


if __name__ == '__main__': unittest.main()
