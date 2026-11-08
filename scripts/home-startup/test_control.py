"""Offline tests for the separate startup controller; no TV access."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('startup_control', HERE / 'control.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.scope_patch = patch.object(control, 'HERE', self.folder)
        self.scope_patch.start()
        self.addCleanup(self.scope_patch.stop)

    def test_home_only_bundle_is_refused(self):
        (self.folder / 'control-manifest.json').write_text('{"schema":1,"files":{}}')
        with self.assertRaisesRegex(RuntimeError, 'separate Home-and-startup'):
            control.verify_bundle()

    def test_home_only_profile_is_refused_before_device_access(self):
        (self.folder / 'recovery.json').write_text('{"schema":1,"scope":"home-only"}')
        with patch.object(control, 'verify_bundle'), patch.object(control, 'tv_info') as device:
            with self.assertRaisesRegex(ValueError, 'not for Home and startup'):
                control.run_action(argparse.Namespace(action='apply'))
            device.assert_not_called()

    def test_old_plan_is_refused_without_staging(self):
        original = b'{"host":"192.0.2.10"}'
        digest = hashlib.sha256(original).hexdigest()
        profile = {'scope': 'home-and-startup', 'host': '192.0.2.10', 'device': {},
                   'original_sha256': digest, 'target': 'abcdefghij.Home'}
        (self.folder / 'recovery.json').write_text(json.dumps(profile))
        (self.folder / 'original-query.json').write_bytes(original)
        (self.folder / 'verified-plan.json').write_text(json.dumps({
            'transport_protocol': 2, 'original_sha256': digest,
            'result': {'Success': True, 'WriteAttempted': False}}))
        args = argparse.Namespace(action='apply', confirm_target=profile['target'], confirm_scope='home-and-startup')
        with patch.object(control, 'verify_bundle'), patch.object(control, 'validate_snapshot', return_value={'host': profile['host']}), \
             patch.object(control, 'tv_info', return_value={}), patch.object(control, 'connected'), \
             patch.object(control.subprocess, 'run') as stage:
            with self.assertRaisesRegex(ValueError, 'No successful read-only plan'):
                control.run_action(args)
            stage.assert_not_called()

    def test_new_request_parser_requires_scope_and_protocol_three(self):
        source = (HERE / 'RequestFile.cs').read_text()
        self.assertIn('GetInt32() != 3', source)
        self.assertIn('GetProperty("scope").GetString() != "home-and-startup"', source)
        source = (HERE / 'HomeStartup.cs').read_text()
        self.assertIn('transport_protocol = 3, scope = "home-and-startup"', source)
        self.assertIn('CheckAeroWatcher()', source)


if __name__ == '__main__':
    unittest.main()
