# CleanFrame v0.7.0 fork integration

This branch integrates upstream v0.7.0 (`845f332d083502fab39be49869052966103b564a`) with the fork’s Sources, monochrome icons and subsequent BBC experiments. The current BBC implementation is the paired Samsung remote test below. Physical TV success is not established.

## Current behaviour

- Sources is a Home utility opening upstream’s discovered input picker. Settings → Samsung → Inputs remains available. Back returns to the entry point.
- Sources and LIVE TV/PS5 shortcuts use upstream cancellation, disconnected-source discovery and TV-viewer handoff. LIVE TV targets HDMI 4 and PS5 HDMI 5; absent ports never select another input.
- UK app and source monochrome marks, saved arrangements and exclusive utility focus remain. The matching saved five-app UK dock gains input shortcuts once; later user edits stay saved.
- BBC uses Samsung’s remote WebSocket on port 8001. It waits for channel authorization, stores a returned token inside CleanFrame, requests the remote app list and sends one launch command for the identified BBC entry. Type 2 uses DEEP_LINK; other types use NATIVE_LAUNCH. No fallback command is guessed for missing or ambiguous entries.
- A 35-second deadline covers authorization and discovery; the UI busy guard allows 40 seconds so it cannot release midway through authorization. Denial, errors, Back or another app launch close the pending socket and prevent late submissions. Denial clears only a matching saved token. No retry occurs automatically.
- Tokens are scoped to the configured origin and stored only in app localStorage. Token-bearing URLs and incoming payloads are not copied to error messages or diagnostics. Port 8001 uses plain WebSocket; no TLS checks are disabled.
- No Vetro, root agent, bridge or Mac runtime is used. The old Vetro preparation tooling is historical and is not bundled in the widget.
- Existing signing identity, certificates, source identity guards, installation floor and native Home/startup assignment are unchanged. SDB tooling reuses an exact existing online device instead of reconnecting it.

## Fixed local target

Ignored `.local/samsung-api.json` may contain only `{"host":"YOUR_TV_IPV4_ADDRESS"}`. Local packaging validates one IPv4 and substitutes it in the generated device adapter and exact HTTP/WebSocket access origins on port 8001 before signing. There is no wildcard or added SystemInfo privilege. DNS names, URLs, explicit ports, multicast and loopback settings are rejected. Changing the TV IP requires updating the file and rebuilding.

The configuration file is never bundled, but the selected endpoint necessarily appears in a personal widget. Keep personal packages private. Public export ignores local settings. With no setting the localhost source template remains; use the configured TV LAN address for this experiment.

## Evidence and limits

The owner confirmed iPlayer opens from Samsung Home and from a Mac POST to the TV application API. Generic native Vetro launch returned to Samsung Home. Both localhost and configured-LAN HTTP calls from the signed widget returned 401 Unauthorized with no exposed authentication challenge. Mac POSTs with file and null Origin headers still launched successfully. That did not establish which authorization rule rejected widget requests.

The owner then confirmed a port-8001 WebSocket handshake from the Mac returned HTTP 101. This proves upgrade support only; it does not establish authorization, app discovery or launch from the packaged widget. This revision tests those steps directly inside CleanFrame.

## Validation

Offline checks cover authorization gating, token reuse/rotation/origin isolation, denial cleanup, exact app selection, malformed/ambiguous app lists, transport/protocol errors, storage failure, cancellation and late events. Browser checks mock the Samsung WebSocket boundary and never contact a TV. Tooling tests preserve exact origin scope, source and identity through a synthetic SDK signing flow.

Validation results: lint/resources, 22 adapter checks plus three historical Vetro checks, 19 tooling tests, 456 browser checks, public-source audit, public export and the fixed-origin unsigned pairing widget passed. Browser validation used system Chromium 154 with public fonts. No TV or real certificates were accessed.

## Install and physical test

Keep existing `.local/signing.json`, certificates and `.local/samsung-api.json`. Pull this branch and run `npm run check`, `npm run package`. Reactivate SDB with kill-server/connect/devices, install, and launch only after installation succeeds. Select BBC iPlayer. If Samsung displays a connection request named CleanFrame, choose Allow. Then verify visible iPlayer startup, another launch with saved authorization, and a cold start with Vetro unopened and the Mac off. Record an error’s stage if it fails. No Home/startup writes are part of this test.
