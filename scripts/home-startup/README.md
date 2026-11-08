# Explicit Home and startup controller

This is a separate owner-authorized operation from the Home-only experiment.
It does not change or reuse an existing Home-only recovery profile. Compiled
helpers and exact original values stay in ignored `.local/` and a fresh external
recovery folder. Never use the reference-machine native Home helper on another TV.

## Scope

The reviewed desired state assigns the resolved installed CleanFrame identity to:

- the native main Home operation;
- `db/appfw/home_appid`;
- `db/appfw/startup_appid`;
- `db/appfw/booting_appid_backup`.

Smart Hub autostart is explicitly enabled (`1`). `db/first_screen/type` finishes
with its exact saved value, including if the native Home setter has a side effect
on it. Other apps' registration rows, root-helper startup flags, app identities,
signing profiles, certificates and application data are outside this controller.
It makes no SQLite writes and adds no watcher, root provider or boot service.

When the saved original Home belongs to AeroTizen (`DclHome001.Home`), plan and
apply require the existing loopback AeroTizen service to report a persistent
`native` routing mode. This is a read-only check: the controller does not change
AeroTizen's watcher. Keeping it disabled prevents it from reclaiming Home after
CleanFrame takes over. Do not use AeroTizen `home restore` as an intermediate step;
that command re-enables AeroTizen's watcher while its launcher remains installed.

## Guards and recovery

The baseline is the owner's unchanged read-only query snapshot, preserved byte
for byte and SHA-256 bound. Preparation resolves the target from existing local
signing settings, checks the exact TV model/device identity and requires the exact
installed target app. Every action checks the saved device identity. The native
program additionally requires SDK UID 901 (refuses root), ARM32, exact firmware
and OS strings, native getter agreement, complete typed values and required exports.
Plan and apply also require the native app-context library to report that the
installed CleanFrame app is eligible for startup; a missing/negative check stops
before settings writes.

Plan has no native setting writes. Apply requires an exact match with the original
state, a successful scoped plan, exact target confirmation and explicit
`--confirm-scope home-and-startup`. It takes the same native writer lock as the
Home-only helper. Every setter is followed by readback and a complete final-state
check. A failed apply attempts exact-original rollback and reports whether that
rollback was verified. A failed restore is never converted into success.

The new controller requires explicit request-file protocol **3** and a
`home-and-startup` scope in the request, recovery profile, plan and receipt. It
cannot accept an old Home-only protocol-2 request or plan. The getter transport
is shared, but all settings writer source and payload files are separate.

`restore` returns Home, both startup values, first-screen value and autostart to
the exact originals in this recovery folder. It refuses unrelated Home/settings
changes and does not depend on previously staged TV files. Keep AeroTizen
installed if the recovery baseline points to it. Its root helper is a separate
package and is not removed or modified by these operations.

## Build and prepare

```sh
python3 scripts/home-startup/build.py
```

The builder reuses the verified SDK 6.0.428 downloader/cache from
`scripts/home-button/build.py`, keeps the system SDK alone, clears NuGet feeds,
and builds offline with that SDK's framework references. The default output is
`.local/home-button/home-startup-built`. It never overwrites an output directory;
`--output .local/ANOTHER_NEW_FOLDER` can select a fresh one. `--dotnet PATH`
selects an existing SDK 6.0.428. No TV is contacted by building.

Use the **built bundle's** controller, never the unbundled source script:

```sh
python3 .local/home-button/home-startup-built/control.py prepare \
  --snapshot ORIGINAL_QUERY_JSON \
  --recovery NEW_EXTERNAL_RECOVERY_DIRECTORY \
  --expected-model EXACT_MODEL \
  --project CLEANFRAME_CHECKOUT

python3 NEW_EXTERNAL_RECOVERY_DIRECTORY/home-startup/control.py plan
```

Native write commands, to be run only after reviewing the full plan and recovery:

```sh
python3 NEW_EXTERNAL_RECOVERY_DIRECTORY/home-startup/control.py apply \
  --confirm-target RESOLVED_APP_ID --confirm-scope home-and-startup

python3 NEW_EXTERNAL_RECOVERY_DIRECTORY/home-startup/control.py restore
```

Plan/inspect/apply/restore use the normal connected SDB serial saved during
preparation. Keep Developer Mode pointed to the Mac for this workflow; do not
switch it to localhost while the paired bridge is unavailable. No SDB server
restarts or Developer Mode edits are made automatically. Preserve every run
receipt, especially on an interrupted or failed operation.

After successful readback, verify the physical Home button and a full power-on
startup separately. Desktop policy tests cannot establish either TV behaviour.

## Offline validation

`PolicyTests.csproj` uses a fake platform, never a native TV library. It covers
zero-write plans, all four IDs, autostart enable/restore, first-screen side
effects, partial failure and exact rollback, rollback failure, drift rejection,
exact original restore and rejection of old/unscoped requests.

The Python controller tests cover scope/profile/plan separation and refusal before
device staging. Existing Home-only source, private bundles and recovery snapshots
remain unchanged.
