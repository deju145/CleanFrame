"""Build the reviewed AeroTizen HDMI 5 update locally; never contact the TV."""

import argparse
from pathlib import Path
import shutil
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

BASE = "94b4df2e27b158d1ac08cf2f5f9a73ddcc4e2646"
HERE = Path(__file__).resolve().parent


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads/AeroTizen-HDMI5-test")
    output = parser.parse_args().output.expanduser().resolve()
    for tool in ("git", "node", "npm"):
        if not shutil.which(tool):
            raise SystemExit("Missing build tool: " + tool)
    if output.exists():
        raise SystemExit("Output already exists; preserved without changes: " + str(output))
    source = output / "source"
    output.mkdir(parents=True)
    run("git", "clone", "--no-checkout", "https://github.com/helalaou/AeroTizen.git", str(source))
    run("git", "checkout", "--detach", BASE, cwd=source)
    run("git", "apply", "--check", str(HERE / "source.patch"), cwd=source)
    run("git", "apply", str(HERE / "source.patch"), cwd=source)
    run("npm", "ci", "--ignore-scripts", cwd=source)
    run("npm", "run", "build", cwd=source)
    widget = output / "AeroTizen-HDMI5-unsigned.wgt"
    runtime = source / "dist/launcher"
    with ZipFile(widget, "w", ZIP_DEFLATED) as archive:
        for file in sorted(runtime.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(runtime).as_posix())
    for relative in ("tools/configure-hdmi5.py", "cli/src/aerotizen/__init__.py", "cli/src/aerotizen/sdb.py"):
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, destination)
    print("Built:", widget)
    print("No TV contacted. No signing profiles, certificates, or native settings changed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit("Build stopped: " + str(error)) from None
