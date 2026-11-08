"""Build a separate private Home-and-startup controller; no TV is contacted."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent
SHARED = ROOT / 'scripts/home-button'
spec = importlib.util.spec_from_file_location('verified_home_sdk', SHARED / 'build.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dotnet', type=Path)
    parser.add_argument('--output', type=Path, default=Path('.local/home-button/home-startup-built'))
    args = parser.parse_args()
    output = (ROOT / args.output).resolve() if not args.output.is_absolute() else args.output.resolve()
    if not output.is_relative_to(ROOT / '.local'):
        raise ValueError('Keep compiled helpers under ignored .local/.')
    if output.exists():
        raise ValueError('Output exists; choose a fresh --output path. Existing recovery tools are preserved.')
    work = ROOT / '.local/home-button-source-build'
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    dotnet = args.dotnet.expanduser().resolve() if args.dotnet else shared.sdk_for_host(work)
    env = dict(os.environ)
    env.update({'DOTNET_CLI_HOME': str(work / 'cli'), 'XDG_DATA_HOME': str(work / 'data'),
                'NUGET_PACKAGES': str(work / 'nuget'), 'DOTNET_CLI_TELEMETRY_OPTOUT': '1',
                'DOTNET_SKIP_FIRST_TIME_EXPERIENCE': '1', 'DOTNET_GENERATE_ASPNET_CERTIFICATE': 'false',
                'DOTNET_ADD_GLOBAL_TOOLS_TO_PATH': 'false', 'DOTNET_NOLOGO': '1',
                'DOTNET_MULTILEVEL_LOOKUP': '0', 'DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE': 'true'})
    version = subprocess.check_output([str(dotnet), '--version'], env=env, text=True, timeout=20).strip()
    if version != shared.VERSION:
        raise ValueError('Expected verified SDK ' + shared.VERSION)
    config = work / 'NuGet.Config'
    config.write_text('<configuration><packageSources><clear /></packageSources></configuration>\n')
    token = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:12]
    compiled = work / ('startup-compiled-' + token)
    intermediate = work / ('startup-obj-' + token)
    subprocess.run([str(dotnet), 'build', str(SOURCE / 'HomeStartup.csproj'), '-c', 'Release',
                    '--configfile', str(config), '-o', str(compiled),
                    '-p:BaseIntermediateOutputPath=' + str(intermediate) + '/',
                    '-p:DebugType=None', '-p:DebugSymbols=false'], env=env, check=True)
    files = {'HomeStartup.dll': compiled / 'Query.dll',
             'control-runtimeconfig.json': compiled / 'Query.runtimeconfig.json',
             'query_transport.py': SHARED / 'query.py'}
    for name in ['control.py', 'NativeHome.cs', 'HomeStartup.cs', 'HomeStartupPolicy.cs',
                 'RequestFile.cs', 'HomeStartup.csproj', 'README.md', 'AeroTizen-LICENSE.txt']:
        files[name] = SOURCE / name
    output.mkdir(mode=0o700, parents=True)
    for name, source in files.items():
        shutil.copyfile(source, output / name)
        (output / name).chmod(0o400)
    build = {'schema': 1, 'scope': 'home-and-startup', 'transport_protocol': 3, 'sdk': version,
             'sources': {name: shared.digest(source) for name, source in files.items()}}
    (output / 'build.json').write_text(json.dumps(build, indent=2) + '\n')
    manifest = {'schema': 1, 'scope': 'home-and-startup',
                'files': {path.name: shared.digest(path) for path in output.iterdir() if path.is_file()}}
    (output / 'control-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for name in ['build.json', 'control-manifest.json']:
        (output / name).chmod(0o400)
    print('Built Home-and-startup tools:', output)
    print('No TV contacted. Next prepare a new external recovery folder and run plan.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
