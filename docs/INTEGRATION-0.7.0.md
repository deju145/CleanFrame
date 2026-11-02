# CleanFrame v0.7.0 fork integration

This branch combines upstream release `v0.7.0` (`845f332d083502fab39be49869052966103b564a`) with the fork's TV-only Vetro work (`40944d4ea49065b8b92b9b86374580f490c84367`). The original integration was installed on the owner’s TV; the direct Samsung API revision below still needs its own physical TV test.

## Reconciled behaviour

- Sources remains in the Home utility menu. It opens upstream's input picker, with a Home return target; Settings → Samsung → Inputs retains its Samsung return target.
- The picker and LIVE TV/PS5 dock shortcuts use upstream discovery, cancellation and viewer handoff. Disconnected ports are retained for sleeping devices. The older fullscreen overlay and remote-key interception are removed.
- LIVE TV targets HDMI 4, PS5 HDMI 5. A missing port never selects another input. A matching saved five-app UK dock gets these shortcuts once; later user edits remain saved.
- The streaming services and input shortcuts retain their bundled monochrome marks and provenance. The app loses its visible dock highlight when a utility has focus, while retaining its remembered position.
- BBC iPlayer now sends an empty POST directly to `http://127.0.0.1:8001/api/v2/applications/DqEoaplKlw.bbchybrid`. The manifest grants access only to that local origin plus the internet privilege. No Vetro request, root agent, relay or Mac service is used. An optional ignored local packaging setting selects one fixed TV IPv4 for both the generated manifest and runtime. There is one launch attempt, no automatic fallback. HTTP success means submission was accepted, not proof of visible startup.
- Owner evidence: the same endpoint at the TV’s LAN address opened iPlayer from Python on the Mac. Generic native Vetro launch returned to Samsung Home. The localhost widget received HTTP 401. Mac POSTs with both file and null Origin headers still opened iPlayer. The fixed LAN-address widget and cold-start behaviour remain unverified.
- Upstream packaging safeguards, Tizen 5.0 installation minimum, native-helper guards, source identity and local signing overlay are preserved. No certificate, app identity, Home/startup assignment or installed TV package has been changed by preparing this branch.

## Previous integration validation

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

Preview uses public fonts; it cannot launch TV apps. Packaging and device installation are separate next steps. Keep the original author certificate for each installed app. Vetro does not need updating for this test. Leave its installation and signing identity unchanged.

After installation, check source selection, picture/sound, remote response, iPlayer's visible launch and startup after a full power cycle with the Mac off. Test BBC with Vetro closed; if it works, repeat after a cold start without opening Vetro. None of those physical outcomes are established by these browser tests. Native Home/startup reassignment remains outside this integration.

## Direct Samsung API revision

Offline checks cover the fixed empty POST, empty 2xx acknowledgements, HTTP rejection, network and policy errors, timeouts, callback completion and no relay/native fallback. Browser tests mock Samsung HTTP responses; they do not establish packaged TV access. The legacy Vetro preparation files remain historical tooling only and are not bundled in the widget. Local signing configuration and SDK identities are unchanged.

Revision validation: lint and widget/resource validation passed; 18 adapter checks and the three historical Vetro endpoint checks passed. Full browser run: 451 passing checks, one hidden-wallpaper retry timeout; that section passed alone on rerun (three checks including run integrity). Public-source audit and unsigned public-font widget export passed. The exported manifest and device adapter contain port 8001 and no port 8099; Vetro tooling is not bundled. No physical TV, signing certificate or local identity was accessed by these checks.

## Fixed LAN-address test

The dynamic-address proposal was not published. This revision adds no wildcard origin and no SystemInfo privilege. Create ignored `.local/samsung-api.json` containing only `{"host":"YOUR_TV_IPV4_ADDRESS"}`. `npm run package` validates the IPv4 and substitutes exactly one origin in the generated manifest and device adapter before signing. Source files, signing settings and identity remain unchanged. DNS names, URLs, ports, wildcards, loopback and multicast addresses are rejected. If the TV address changes, update the local setting and rebuild. With no setting, packaging retains the earlier localhost template; on this TV that returned 401.

Public exports do not read the local setting. The configuration file itself is never bundled. The SDK-signed widget necessarily contains its selected endpoint; keep personal builds private. The Mac is needed for packaging and installation only.

Fixed-address revision validation: lint/resources, 18 adapter checks, 18 tooling tests and 23 focused browser checks passed. The tooling tests verify the generated exact origin, unchanged privilege scope and identity, source immutability, invalid-host rejection, public-export isolation and the synthetic SDK signing path. A fixed-origin unsigned test widget, public-source audit and public unsigned export also passed. No TV or real certificates were accessed.
