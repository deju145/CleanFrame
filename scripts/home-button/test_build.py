"""Offline SDK selection and complete private bundle checks."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('home_build', SOURCE / 'build.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class Checks(unittest.TestCase):
    def test_both_mac_architectures_have_pinned_sha512(self):
        for machine, expected in [('x86_64', 'osx-x64'), ('arm64', 'osx-arm64')]:
            rid = BUILD.choose_rid('Darwin', machine)
            self.assertEqual(rid, expected)
            self.assertRegex(BUILD.SDKS[rid], r'^[a-f0-9]{128}$')

    def test_unsupported_build_host_refused(self):
        with self.assertRaisesRegex(ValueError, 'No pinned SDK'):
            BUILD.choose_rid('Other', 'unknown')

    def test_bundle_has_sources_license_checksums_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); compiled = root / 'compiled'; compiled.mkdir()
            (compiled / 'Query.dll').write_bytes(b'compiled fixture')
            (compiled / 'Query.runtimeconfig.json').write_text('{"runtimeOptions":{}}')
            output = root / 'private-bundle'
            manifest = BUILD.make_bundle(compiled, output, BUILD.VERSION)
            self.assertIn('HomeOnly.cs', manifest['files'])
            self.assertIn('HomeOnlyPolicy.cs', manifest['files'])
            self.assertIn('RequestFile.cs', manifest['files'])
            self.assertIn('AeroTizen-LICENSE.txt', manifest['files'])
            self.assertIn('query_transport.py', manifest['files'])
            self.assertIn('build.json', manifest['files'])
            for name, checksum in manifest['files'].items():
                self.assertEqual(BUILD.digest(output / name), checksum)
            self.assertEqual(json.loads((output / 'build.json').read_bytes())['sdk'], BUILD.VERSION)
            with self.assertRaises(FileExistsError):
                BUILD.make_bundle(compiled, output, BUILD.VERSION)


if __name__ == '__main__': unittest.main()
