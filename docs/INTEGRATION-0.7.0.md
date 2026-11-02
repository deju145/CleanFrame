# CleanFrame v0.7.0 fork integration

This branch combines upstream release `v0.7.0` (`845f332d083502fab39be49869052966103b564a`) with the fork's TV-only Vetro work (`40944d4ea49065b8b92b9b86374580f490c84367`). It has not been installed on the owner's TV.

## Reconciled behaviour

- Sources remains in the Home utility menu. It opens upstream's input picker, with a Home return target; Settings → Samsung → Inputs retains its Samsung return target.
- The picker and LIVE TV/PS5 dock shortcuts use upstream discovery, cancellation and viewer handoff. Disconnected ports are retained for sleeping devices. The older fullscreen overlay and remote-key interception are removed.
- LIVE TV targets HDMI 4, PS5 HDMI 5. A missing port never selects another input. A matching saved five-app UK dock gets these shortcuts once; later user edits remain saved.
- The streaming services and input shortcuts retain their bundled monochrome marks and provenance. The app loses its visible dock highlight when a utility has focus, while retaining its remembered position.
- BBC iPlayer calls the fixed endpoint in the custom Vetro service. No standalone bridge or Mac startup command is used. The custom Vetro build and its connected root agent are required. The failed root-free manifest experiment on main is not carried into this branch.
- Upstream packaging safeguards, Tizen 5.0 installation minimum, native-helper guards, source identity and local signing overlay are preserved. No certificate, app identity, Home/startup assignment or installed TV package has been changed by preparing this branch.

## Validation

Using Node 24 and system Chromium 154 with public fonts:

- `npm run check`: lint, manifest/resource validation, 16 adapter checks and 3 Vetro endpoint checks passed.
- `npm run check:tools`: 15 tests passed.
- `npm run check:browser`: 450 checks passed, including both entry points for Inputs, the four utility controls, saved UK dock migration, monochrome rendering and the mocked Vetro endpoint.
- `npm run check:performance`: 40 checks passed. Five frame-budget observations were recorded under browser CPU throttling; this is not a physical TV benchmark.
- `npm run check:public` and `npm run export:public`: passed. No credentials or private fonts were used.

The browser helper accepts optional `CLEANFRAME_CHROMIUM_EXECUTABLE` for an installed Chromium when the default Playwright download is unavailable. The pinned Playwright browser download was blocked by the cloud network policy during this review.

## Review on the installation Mac

Keep the existing ignored `.local/signing.json`, certificates, SDK-generated identity and any recovery snapshots. Do not delete `.local` or regenerate keys to switch branches.

```sh
git fetch origin
git switch integration-v0.7.0
npm ci
npm run check
npm run dev:public
```

Preview uses public fonts; it cannot launch TV apps. Packaging and device installation are separate next steps. Keep the original author certificate for each installed app. The custom Vetro update must use the Apps2Samsung signing identity already associated with Vetro. Do not uninstall the working Vetro installation merely to bypass a signing mismatch.

After installation, check source selection, picture/sound, remote response, iPlayer's visible launch and startup after a full power cycle with the Mac off. Vetro may need to be opened manually and allowed time to reconnect its root agent. None of those physical outcomes are established by these browser tests. Native Home/startup reassignment remains outside this integration.
