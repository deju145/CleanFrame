# BBC iPlayer through Vetro (test integration)

BBC iPlayer returned to Samsung Home on this LS03F when started using either public web-app launch API. The owner confirmed that Vetro launches the same installed app successfully. This integration forwards only `DqEoaplKlw.bbchybrid` to Vetro's `POST /apps/launch`, which uses its connected root agent and native app launcher.

CleanFrame connects to a small relay bound to `127.0.0.1:28199` on the TV. The relay supplies packaged-widget CORS responses and waits for Vetro's launch acknowledgement. No native shell command or arbitrary application ID can be supplied through the relay. No Mac needs to remain running after setup.

## Installation and testing

Build, sign and install CleanFrame as usual while Developer Mode Host PC IP points to the installation Mac. Preserve the existing certificate and application identity.

Then set the TV's Developer Mode Host PC IP back to `127.0.0.1`, restart, open Vetro if necessary, and wait for its root agent to connect. From the repository on the Mac, run:

```sh
python3 scripts/start-bbc-bridge.py --host YOUR_TV_IP
```

The script checks Vetro's status, discovers its actual Node executable through its current process, and stages a relay under `/run/cleanframe-bbc-bridge`. It starts that runtime with the relay, then verifies the relay's health from the TV. It does not alter Vetro's installed files, Home routing, security policy, or boot configuration.

Open CleanFrame manually on the TV and choose BBC iPlayer. A launch acknowledgement is command evidence; confirm the visible iPlayer screen yourself.

If Vetro uses a different port, add `--vetro-port PORT`. The CleanFrame-to-relay port remains 28199. If that port belongs to another service, do not kill it; report the startup error.

## Reboots and removal

This relay is temporary and does not install an autostart service. After a full TV reboot, wait for Vetro to reconnect its root agent, then rerun the setup command. Otherwise CleanFrame reports that the BBC bridge is unreachable. A TV reboot stops the relay and clears its files under /run.

Other app launch paths and root-free HDMI shortcuts are unchanged. BBC launch compatibility without Vetro/root is not established.
