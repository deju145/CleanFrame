# CleanFrame v0.7.0 fork integration

This branch integrates upstream v0.7.0 (`845f332d083502fab39be49869052966103b564a`) with the fork’s Sources, monochrome icons and metadata-based HbbTV handoff. The current HbbTV revision awaits a physical test on the owner’s TV.

## Current behaviour

- Sources is a Home utility opening upstream’s discovered input picker. Settings → Samsung → Inputs remains available. Back returns to the entry point.
- Sources and LIVE TV/PS5 shortcuts use upstream cancellation, disconnected-source discovery and TV-viewer handoff. LIVE TV targets HDMI 4 and PS5 HDMI 5; absent ports never select another input.
- UK app and source monochrome marks, saved arrangements and exclusive utility focus remain. The matching saved five-app UK dock gains input shortcuts once; later user edits stay saved.
- Before launching an installed app, read its `http://samsung.com/tv/metadata/hbbtv.link` metadata. A nonempty string selects the default app-control operation targeting `org.tizen.hbbtv`, with `tizenid=[selected app ID]`, `hbbtv=[installed URL]`, and `deeplink=[true]` data.
- Metadata that is missing, unavailable, denied, empty or malformed preserves the ordinary Tizen launch. A failed HbbTV handoff does not trigger another launch attempt. The callback deadline remains eight seconds; late callbacks cannot complete twice.
- This follows [AeroTizen PR #1](https://github.com/helalaou/AeroTizen/pull/1), commit `e65a5311b032b5af3a6bc0a6e89155770eb29552`. The author reports BBC iPlayer tested on a 2024 Frame with Tizen 9. That is evidence for the approach, not proof for this owner’s TV. The MIT notice is bundled and credited in THIRD_PARTY_NOTICES.md.
- No HTTP/WebSocket launch, pairing, Vetro, root agent, background service, certificate handling or Mac runtime is used. Old network access entries and the internet privilege are removed. No wildcard or SystemInfo privilege is added.
- Existing certificates, identity overlay, installation floor and native Home/startup assignment remain unchanged. SDB tooling reuses an exact existing online device instead of reconnecting it.

Validation results: lint/resources, 19 adapter checks plus three historical Vetro checks, 17 tooling tests, 454 full browser checks, public-source audit, public export and the unsigned HbbTV widget passed. Browser tests used system Chromium 154 with public fonts. The generated widget contains no network access entries, internet privilege or network-launch code and retains the AeroTizen MIT notice. No TV or real signing credentials were accessed.

## Retired experiments

Generic public/native BBC wrapper launches returned to Samsung Home. Mac HTTP requests could launch BBC, while widget REST calls returned 401. The paired WebSocket test upgraded but received `ms.channel.timeOut` without an approval prompt; secure port 8002 failed certificate validation. Those paths are removed from the runtime, and TLS checks were never disabled.

The old `.local/samsung-api.json` file may remain but is ignored by packaging, even if malformed. The network overlay module is retired. No owner configuration, certificate or saved token is deleted. Historical Vetro preparation tools remain unbundled; they are not part of this test.

## Validation and physical test

Offline tests check the exact HbbTV target, operation and all three payload fields, installed-metadata URL selection, generic wrappers, ordinary-app fallback, rejection and synchronous errors, no second attempt, late callbacks, and no networking. Packaging checks preserve identity and ignore old network settings. Browser tests mock the public Tizen boundary; they do not launch real TV apps.

Pull this branch and run `npm run check`, then `npm run package`. Reactivate SDB using kill-server/connect/devices, install, and launch only after installation succeeds. Select BBC iPlayer without opening Vetro or approving a remote-control connection. Confirm visible startup, normal Back behaviour, and later cold-start operation with the Mac off. Native Home/startup changes and AeroTizen’s watcher are outside this revision.
