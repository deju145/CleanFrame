# Optional HDMI 5 IP Control

Some Frame Pro TVs expose HDMI 1–4 through `VIDEOSOURCE` but omit the socket
on the panel itself. On the reported QE65LS03FWUXXU, Tizen 9.0 / firmware
1301.0, all-provider discovery returns only HDMI 1–4, and `getSource()` throws
`UnknownError: Unknown source type` while Samsung Home displays HDMI 5.
Do not manufacture a source object: `tvwindow.setSource()` requires a genuine
native record and cannot select this unreported source.

The owner confirmed a separate route: authenticated local HTTPS IP Control on
port 1516 reports `getTVStates.inputSource = HDMI5`, and
`inputSourceControl` with `inputSource: HDMI5` switches to the PS5. The owner's
custom AeroTizen tile also completed the native viewer handoff successfully.
This CleanFrame port has offline/browser coverage; its service and physical
viewer handoff require a separate installation check.

## Runtime

The existing PS5 dock shortcut, Sources control and Settings → Samsung → Inputs
share the same adapter. After configuration, the HDMI 5 row uses the IP Control
service and shows IP Control or Active. A successful command opens Samsung's
`org.tizen.tv-viewer`. Other ports keep their native source records and the
existing cancellation-aware path. Without configuration, a genuine native HDMI 5
still works normally; an unreported source stays labelled Not reported by TV.

The new `<package>.IpControl` service starts on demand when CleanFrame reads
inputs. It has no boot registration, automatic restart, polling, Home watcher,
root operations or dependency on the AeroTizen launcher. Its HTTP listener is
IPv4 loopback only, port 47791. The widget's browser access entry permits only
that loopback origin. HTTPS runs in the service, with a certificate exception
limited to the configured private IPv4 TV and Samsung's self-signed IP Control
endpoint. Global TLS validation is not disabled.

The service exposes only current-source reads and HDMI 5 selection. It serializes
IP Control requests and bounds them to eight seconds without automatic command
retries. Browser cancellation suppresses a late viewer launch; it cannot undo a
selection already received by the TV. The native fallback retains its previous
eight-second deadline; an IP selection has a bounded twelve-second window for
the command and viewer response. A read may get one short startup grace retry.

The token is copied once into package-private mode-0600 storage. It is never in
the widget, browser preferences, status replies or source. Setup/remove require
the SDB-only control header with no browser Origin. Ordinary web origins cannot
read or select through the service. The existing HbbTV launch remains a local
public app-control handoff and does not use this network service.

## Build and install using the existing paired bridge

Keep the owner's existing `.local/signing.json`, SDK certificate profile and
application identity. Packaging derives the service identity from the selected
package and rejects a foreign service or enabled boot/restart setting. The app
identity is retained; no author certificates or Home assignments are created.

```sh
cd ~/Downloads/CleanFrame
npm run check
npm run check:tools
npm run package
```

Only continue after packaging succeeds. The following commands use the existing
trusted AeroTizen Python source and the isolated Python environment created for
the owner's SDK diagnostic. They keep Developer Mode at localhost and let
AeroTizen select and authenticate its existing paired bridge; do not run the
old direct SDB reconnect sequence or change Host PC IP for these commands.
Replace `TV_IP` with the TV's private address. Adapt the local paths if needed.

```sh
"$HOME/Downloads/AeroTizen-HDMI5-test/.sdk-check/bin/python3" scripts/ip-control.py install --host TV_IP --aerotizen-source "$HOME/Downloads/AeroTizen-HDMI5-test/source/cli/src"
"$HOME/Downloads/AeroTizen-HDMI5-test/.sdk-check/bin/python3" scripts/ip-control.py launch --host TV_IP --aerotizen-source "$HOME/Downloads/AeroTizen-HDMI5-test/source/cli/src"
```

The install action validates the existing signed widget before upload and sends
those exact bytes. It does not sign through AeroTizen or substitute its author
certificate. It announces the install/launch and verifies command responses;
the owner must confirm CleanFrame is visible. Neither action remaps Home.

On the TV, open CleanFrame's Sources or Settings → Samsung → Inputs once to
start the service. Then provision the already-tested local IP Control token:

```sh
"$HOME/Downloads/AeroTizen-HDMI5-test/.sdk-check/bin/python3" scripts/ip-control.py setup --host TV_IP --aerotizen-source "$HOME/Downloads/AeroTizen-HDMI5-test/source/cli/src"
"$HOME/Downloads/AeroTizen-HDMI5-test/.sdk-check/bin/python3" scripts/ip-control.py status --host TV_IP --aerotizen-source "$HOME/Downloads/AeroTizen-HDMI5-test/source/cli/src"
```

The default token file is
`~/.config/cleanframe-hdmi-diagnostics/ip-control-token.json`. Pass
`--token-file /private/path.json` to select another existing file. It must be
owned by the Mac user with mode 600 or 400; symlinks are refused. No new pairing
prompt is issued. The existing AeroTizen IP Control configuration is not changed.
Do not share token files or the AeroTizen root receipt.

Leave and reopen the input chooser. HDMI 5 should show IP Control or Active.
Test the PS5 dock shortcut and the Inputs row from another source, confirm the
PS5 picture, then confirm normal native HDMI inputs still work. HDMI 5 control
does not require root at runtime; the paired root bridge here is only the
owner's existing installation/setup transport.

To disable only CleanFrame's optional route:

```sh
"$HOME/Downloads/AeroTizen-HDMI5-test/.sdk-check/bin/python3" scripts/ip-control.py disable --host TV_IP --aerotizen-source "$HOME/Downloads/AeroTizen-HDMI5-test/source/cli/src"
```

The Mac's original token and AeroTizen's own configuration are retained. Reopen
Inputs to refresh. If the TV's LAN address changes, repeat setup with the new
address. Setup does not renew expired/revoked IP Control tokens.

## Tests and scope

Adapter tests cover both native and IP paths, active state, failure without a
second selection, cancellation, timeouts and absence of browser token reads.
Service tests cover private persistence, token redaction, origin restrictions,
fixed commands, overlapping calls and disable. Tool tests verify app/service
identity overlays, retained signatures, private token handling and rejection
before uploading an identity-mismatched widget. Browser checks exercise the real
PS5 dock target and Inputs row through a mocked local service and native viewer.
None of these checks contacts a physical TV.

Protocol reference:
[Samsung IP Control implementation](https://github.com/TheFab21/ha-samsungtv-smart/blob/master/IP_Control_Protocol_Reference.md).
