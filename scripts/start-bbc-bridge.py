"""Start the temporary BBC relay through an already-connected Vetro root agent."""
import argparse
import base64
import ipaddress
import json
from pathlib import Path
import shlex
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--host", required=True)
parser.add_argument("--vetro-port", type=int, default=8099)
args = parser.parse_args()
ipaddress.IPv4Address(args.host)
if not 1024 <= args.vetro_port <= 65535:
    raise SystemExit("Invalid Vetro port.")
base = f"http://{args.host}:{args.vetro_port}"

def request(path, data=None):
    req = urllib.request.Request(base + path, data=data,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)

def execute(command):
    result = request("/exec", json.dumps({"cmd": command}).encode())
    if result.get("exit_code") != 0 or result.get("timed_out"):
        raise RuntimeError(result.get("error") or result.get("stderr") or result.get("output") or "Vetro command failed")
    return result.get("output", "").strip()

try:
    status = request("/status")
    if not status.get("agent", {}).get("connected"):
        raise RuntimeError("Vetro root agent is not connected. Set Developer Mode Host PC IP to 127.0.0.1, restart, and wait up to 90 seconds.")
    pid = status.get("self", {}).get("pid")
    if not isinstance(pid, int) or pid < 1:
        raise RuntimeError("Vetro did not report its runtime PID.")
    runtime = execute(f"/bin/readlink -f /proc/{pid}/exe")
    if not runtime.startswith("/") or "\n" in runtime or runtime.endswith(" (deleted)"):
        raise RuntimeError("Cannot identify a usable Vetro Node runtime.")
    encoded = base64.b64encode(Path(__file__).with_name("vetro-bbc-bridge.cjs").read_bytes()).decode()
    folder = "/run/cleanframe-bbc-bridge"
    script = folder + "/bridge.cjs"
    execute(f"mkdir -p {folder} && printf %s {shlex.quote(encoded)} | base64 -d > {script}")
    node = shlex.quote(runtime)
    execute(f"nohup {node} {script} {args.vetro_port} >{folder}/bridge.log 2>&1 </dev/null &")
    health = json.loads(execute(f"{node} {script} --check"))
    if health.get("bridge") != "cleanframe-bbc-v1":
        raise RuntimeError("Bridge identity check failed.")
    print("BBC launch bridge is ready on the TV. Open CleanFrame and test BBC iPlayer.")
    print("The bridge is temporary; rerun this script after a TV reboot.")
except Exception as error:
    raise SystemExit(str(error)) from None
