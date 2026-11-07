# AeroTizen HDMI 5 test build

This separate branch distributes a reviewed source patch and local builder for
AeroTizen. It does not change CleanFrame. It contains no widget, certificates,
pairing tokens, or owner-specific device address.

The patch is pinned to AeroTizen launcher 2.7.0, commit
`94b4df2e27b158d1ac08cf2f5f9a73ddcc4e2646`. The builder downloads that source,
checks and applies the patch, installs pinned npm dependencies and builds an
unsigned widget locally. Node 20.19+ within 20.x, or 22.12+ is required, as well
as Python 3, Git and npm. No .NET SDK is needed for this launcher build.

## Download and build on the Mac

```sh
git clone --single-branch --branch aerotizen-hdmi5-test https://github.com/deju145/CleanFrame.git "$HOME/Downloads/AeroTizen-HDMI5-source-tools"
python3 "$HOME/Downloads/AeroTizen-HDMI5-source-tools/integrations/aerotizen-hdmi5/build.py"
```

Output: `~/Downloads/AeroTizen-HDMI5-test/`. The builder stops rather than
overwriting an existing output directory. `--output /another/new/folder` selects
a different destination. A failed build may leave its output directory; preserve
that directory and choose a fresh destination for a later attempt.

## Installation and setup

Stop any active `inspect launcher` command with Ctrl+C. In the folder containing
the existing AeroTizen CLI binary, run:

```sh
./aerotizen --tv TV_IP install "$HOME/Downloads/AeroTizen-HDMI5-test/AeroTizen-HDMI5-unsigned.wgt"
```

Replace `TV_IP` with the TV's address. Use the existing CLI and its saved signing
profile. Do not uninstall the app or regenerate certificates. If no signing
profile is found, inspect the profile location before proceeding.

Open AeroTizen on the TV, then provision the token over SDB:

```sh
python3 "$HOME/Downloads/AeroTizen-HDMI5-test/tools/configure-hdmi5.py" --tv TV_IP
python3 "$HOME/Downloads/AeroTizen-HDMI5-test/tools/configure-hdmi5.py" --tv TV_IP --check
```

The helper reads the already-tested local token file at
`~/.config/cleanframe-hdmi-diagnostics/ip-control-token.json`. The token is sent
over SDB to the TV's loopback service and saved in package-private storage. It
is never printed or embedded in the widget. Use `--token-file /path/to/file.json`
to select another existing token file.

Return to Home to refresh Inputs. Select PlayStation 5 / HDMI 5 once and confirm
the picture. The background service sends `inputSourceControl(HDMI5)` over local
HTTPS and the launcher hands off to Samsung's native TV viewer. The active input
is read with `getTVStates`; HDMI 5 does not use Tizen's incomplete VIDEOSOURCE
inventory. Existing app/service identities and native Home settings are retained.

To remove only this opt-in configuration:

```sh
python3 "$HOME/Downloads/AeroTizen-HDMI5-test/tools/configure-hdmi5.py" --tv TV_IP --disable
```

The owner's Mac-to-TV IP Control switch is confirmed. Build, formatting, lint,
type checks, 306 Node tests and the compiled browser flow passed. Service-to-TV
HTTPS and native viewer handoff still require the physical installation test.

The patch includes service and browser tests and a detailed design/validation
note in `docs/hdmi5-test-build.md` in the resulting AeroTizen source. Source
addresses in that note and tests are illustrative and must be replaced when
running commands. AeroTizen's MIT license is retained alongside this patch.
