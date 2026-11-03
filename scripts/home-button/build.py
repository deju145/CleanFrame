"""Build private Home-only tools from source. Does not contact or change a TV."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent
VERSION = '6.0.428'
# Pinned official Microsoft release metadata, independently retrieved during
# preparation. Never execute a downloaded SDK before verifying the full archive.
SDKS = {
    'osx-x64': 'ffd6d342cc700cad4fe8fd6a29896d55f8bd7f687f5c2ef9ae68449c3c1cee4897d2318505075bab2a92538e0db8605df13559923d861d9123ba59c5fb0e5bd2',
    'osx-arm64': 'b60e74b56efc5bdb05be9c954bca6fddbc6baa79213b120fd803c75252c54cf4a6f45255b532c18ceae8c4c1c2a60d2702309156f9ab1436bd71f68947c37215',
    'linux-x64': '04395f991ab50e4755ce1ae53e23592a7420b71b82160883bae3194dd1dfd5dcaed78743e4e0b4dd51ea43c49ec84b5643630707b3854f1471265dc98490d2f9'
}


def digest(path, algorithm='sha256'):
    value = hashlib.new(algorithm)
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def choose_rid(system, machine):
    architecture = {'x86_64': 'x64', 'AMD64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(machine)
    operating_system = {'Darwin': 'osx', 'Linux': 'linux'}.get(system)
    rid = str(operating_system) + '-' + str(architecture)
    if rid not in SDKS:
        raise ValueError('No pinned SDK for this build host: ' + system + '/' + machine)
    return rid


def sdk_for_host(work):
    rid = choose_rid(platform.system(), platform.machine())
    directory = work / ('sdk-' + rid + '-' + VERSION)
    receipt = directory / 'cleanframe-sdk-receipt.json'
    executable = directory / 'dotnet'
    if directory.exists():
        saved = json.loads(receipt.read_bytes())
        if saved.get('archive_sha512') != SDKS[rid] or saved.get('dotnet_sha256') != digest(executable):
            raise ValueError('Cached private SDK failed its receipt checks.')
        return executable
    archive = work / ('sdk-' + rid + '-' + VERSION + '.tar.gz')
    url = 'https://builds.dotnet.microsoft.com/dotnet/Sdk/' + VERSION + '/dotnet-sdk-' + VERSION + '-' + rid + '.tar.gz'
    if not archive.exists():
        partial = work / (archive.name + '.part-' + uuid.uuid4().hex)
        print('Downloading official Microsoft SDK to .local (one-time download).', flush=True)
        count = 0
        next_report = 32 * 1024 * 1024
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(url, timeout=60) as response, partial.open('xb') as target:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    target.write(chunk)
                    count += len(chunk)
                    if count >= next_report:
                        print('Downloaded', count // (1024 * 1024), 'MiB', flush=True)
                        next_report += 32 * 1024 * 1024
            if digest(partial, 'sha512') != SDKS[rid]:
                raise ValueError('SDK archive SHA-512 verification failed; SDK not executed.')
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    if digest(archive, 'sha512') != SDKS[rid]:
        raise ValueError('Cached SDK archive SHA-512 verification failed; SDK not executed.')
    staging = work / ('sdk-extract-' + uuid.uuid4().hex)
    staging.mkdir(mode=0o700)
    with tarfile.open(archive, 'r:gz') as package:
        package.extractall(staging, filter='data')
    saved = {'version': VERSION, 'url': url, 'archive_sha512': SDKS[rid],
             'dotnet_sha256': digest(staging / 'dotnet')}
    (staging / receipt.name).write_text(json.dumps(saved, indent=2) + '\n')
    staging.rename(directory)
    return executable


def make_bundle(compiled, destination, sdk_version):
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    files = {'HomeOnly.dll': compiled / 'Query.dll',
             'control-runtimeconfig.json': compiled / 'Query.runtimeconfig.json',
             'query_transport.py': SOURCE / 'query.py'}
    for name in ['control.py', 'HomeOnly.cs', 'HomeOnlyPolicy.cs', 'HomeOnly.csproj',
                 'HOME-ONLY.md', 'AeroTizen-LICENSE.txt']:
        files[name] = SOURCE / name
    for name, source in files.items():
        shutil.copyfile(source, destination / name)
        (destination / name).chmod(0o400)
    build = {'schema': 1, 'sdk': sdk_version, 'configuration': 'Release',
             'sources': {name: digest(source) for name, source in files.items() if source.suffix in ('.cs', '.csproj', '.py')}}
    (destination / 'build.json').write_text(json.dumps(build, indent=2) + '\n')
    manifest = {'schema': 1, 'files': {path.name: digest(path) for path in destination.iterdir() if path.is_file()}}
    (destination / 'control-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for name in ['build.json', 'control-manifest.json']:
        (destination / name).chmod(0o400)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dotnet', type=Path, help='Explicit existing SDK executable; must be version ' + VERSION)
    parser.add_argument('--output', type=Path, default=Path('.local/home-button/home-only-built'))
    args = parser.parse_args()
    output = (ROOT / args.output).resolve() if not args.output.is_absolute() else args.output.resolve()
    if not output.is_relative_to((ROOT / '.local').resolve()):
        raise ValueError('Compiled helper output must remain inside ignored .local/.')
    if output.exists():
        raise ValueError('Output folder already exists; choose a new --output path. No existing files overwritten.')
    work = ROOT / '.local/home-button-source-build'
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    dotnet = args.dotnet.expanduser().resolve() if args.dotnet else sdk_for_host(work)
    environment = dict(os.environ)
    environment.update({
        'DOTNET_CLI_HOME': str(work / 'cli'), 'XDG_DATA_HOME': str(work / 'data'),
        'NUGET_PACKAGES': str(work / 'nuget'), 'DOTNET_CLI_TELEMETRY_OPTOUT': '1',
        'DOTNET_SKIP_FIRST_TIME_EXPERIENCE': '1', 'DOTNET_GENERATE_ASPNET_CERTIFICATE': 'false',
        'DOTNET_ADD_GLOBAL_TOOLS_TO_PATH': 'false', 'DOTNET_NOLOGO': '1',
        'DOTNET_MULTILEVEL_LOOKUP': '0', 'DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE': 'true'
    })
    version = subprocess.run([str(dotnet), '--version'], check=True, capture_output=True, text=True, env=environment, timeout=20).stdout.strip()
    if version != VERSION:
        raise ValueError('Expected .NET SDK ' + VERSION + '; found ' + version)
    config = work / 'NuGet.Config'
    config.write_text('<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear /></packageSources></configuration>\n')
    token = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:12]
    compiled = work / ('compiled-' + token)
    intermediate = work / ('obj-' + token)
    subprocess.run([str(dotnet), 'build', str(SOURCE / 'HomeOnly.csproj'), '-c', 'Release',
                    '--configfile', str(config), '-o', str(compiled),
                    '-p:BaseIntermediateOutputPath=' + str(intermediate) + '/',
                    '-p:DebugType=None', '-p:DebugSymbols=false'], env=environment, check=True)
    make_bundle(compiled, output, version)
    print('Built private source and recovery tools:', output)
    print('No TV contacted. No signing files changed. Next run control.py prepare, then plan.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        raise SystemExit(str(error))
