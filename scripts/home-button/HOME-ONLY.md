# Home-only experiment and recovery

This new helper is separate from the reference native Home helper and the
getter-only Query assembly. The original query and its firmware guard are
not modified. No boot option, root route, watcher, background service,
signing operation or security-policy change is included.

## Resolved proposal

`prepare` reads the owner's existing signing identity without changing it,
validates the original query's typed values, verifies the exact model through
the TV API and checks the exact installed application ID through SDB. It copies
the helper, sources, original query bytes and recovery profile into a new
`home-only/` directory outside the checkout. It refuses to overwrite that
directory or accept empty/unavailable original settings. Source query bytes
are preserved exactly and bound by SHA-256. Device ID/model checks are made
on every subsequent action; the TV helper additionally checks the complete
firmware and OS release strings, ARM32 and SDK UID 901. Root is refused.

The read-only `plan` resolves the getter/setter exports without calling settings
setters. It requires agreement between the AUL Home getter already tested by
the query and the native operation getter, an installed launcher package,
and an exact match with the saved original settings. No stale-state exception
is made for derived startup settings. Its receipt shows Before and Desired.

Only two intended values change on `apply`: the native main Home operation
and `db/appfw/home_appid`, both to the resolved CleanFrame app ID. Startup app,
boot backup, first-screen value and autostart must finish with their exact saved
values. Because native Home assignment can have derived startup side effects,
the helper may need to write saved values back to those preferences. It never
independently enables autostart, chooses an Art destination, or patches files.

Every setter is followed by a readback, followed by full-snapshot verification.
The helper takes an exclusive native writer lock before mutation. The small
lock file stays under the SDK temporary directory to avoid concurrent callers
locking different file inodes; the staged payloads and shell are cleaned up.

An apply error attempts exact-original rollback, including when a setter
mutates state then returns an error. Rollback success is claimed only after
exact readback. `restore` handles original, applied or partially applied Home
assignments; it refuses unrelated owners, unrelated setting changes, or a
changed autostart value requiring further review. Failed restore is reported
without reapplying the custom Home state. `inspect` performs no writes and is
available to diagnose drift or an interrupted operation.

## Concrete command forms

Build the private bundle from checked-out source, without contacting the TV:

```sh
python3 scripts/home-button/build.py
```

The builder downloads the official Microsoft SDK 6.0.428 for the Mac's
architecture into ignored `.local/`, verifies the pinned archive SHA-512 before
extracting/executing it, disables external NuGet sources and builds a portable
helper using its included framework references. It leaves the system SDK,
signing configuration and certificates alone. All helper sources, compiled
outputs, provenance and licenses go into `.local/home-button/home-only-built/`.
An existing bundle is never overwritten; a rebuild can specify a new private
`--output`. The explicit `--dotnet` option supports an existing verified SDK
6.0.428. The builder does not call SDB or contact a TV.

Use the resulting bundle's `control.py` for preparation. Do not execute the
source-tree control script directly, because it has not yet been bundled with
its hashed payloads and template files.

Run all actions from the external recovery directory. The example `<...>`
values must be replaced with the reviewed owner-specific values. Preparation
and planning are read-only with respect to native settings.

```sh
python3 control.py prepare --snapshot ORIGINAL_QUERY_JSON --recovery EXTERNAL_BACKUP_DIR --expected-model EXACT_MODEL --project CLEANFRAME_CHECKOUT
python3 EXTERNAL_BACKUP_DIR/home-only/control.py plan
python3 EXTERNAL_BACKUP_DIR/home-only/control.py inspect
```

The following native write actions require explicit approval after the plan
and recovery commands have been reviewed. Merely running preparation or plan
does not authorize either command:

```sh
python3 EXTERNAL_BACKUP_DIR/home-only/control.py apply --confirm-target RESOLVED_APP_ID
python3 EXTERNAL_BACKUP_DIR/home-only/control.py restore
```

The wrapper requires a successful plan before apply and an exact target
confirmation. Each run re-stages its own hashed payloads, so restore does not
depend on keeping TV temporary helper files. It uses the tested query transport
with strictly checked display-message substitutions; it does not describe a
write action as read-only. Requests travel in a separately hashed and staged
`Request.json`, passed explicitly as the helper's command-line argument.
The TV's dotnet host can ignore custom runtime-configuration properties, so
protocol 2 never relies on those properties for its action or request. Both
the native helper and receipt verifier require protocol 2. The query and
settings-writer assemblies remain separate files in the bundle.
The immutable original query is never replaced by an applied-state receipt.

## What still requires the owner

Before native writes, verify the read-only plan on the actual TV, the external
recovery folder and the explicit Samsung Home escape. After an approved apply,
test physical Home from streaming apps and from Samsung Home, then restore,
read back all originals and verify physical Home opens Samsung Home. Reapply
only after successful rollback and the owner's instruction. Art Mode/wake and
full power-on remain separate physical observations; preserved configuration
alone is not evidence that those behaviours work unchanged.

Restore uses the same SDB execution path as apply; there is no independently
verified fallback if that path becomes unavailable. Native setter readback or
rollback can fail, and a lost callback does not prove the TV was unchanged.
After an uncertain action, preserve receipts and inspect current state rather
than retrying apply automatically. Restore after firmware changes is refused.

## Verification

`PolicyTests.cs` exercises Home-only planning, exactly two normal Home writes,
derived startup/first-screen side effects, stale baselines, setter mutation
before failure, failed readback, failed rollback, partial restore, unrelated
owners, repeated restore, inspection and failed-restore behaviour on fake
platforms. Python tests exercise original-type validation, immutable recovery
files, signing-file preservation, request/receipt generation and apply gates.
These offline checks are not a physical-device compatibility claim.

The side-effect preservation approach was informed by the MIT-licensed
AeroTizen native Home policy at commit
`79ba9198d63002fbfa5ad620a6abfedebd33cdc5`; its license is included in the
private bundle. AeroTizen's watcher and boot-control implementation are not
installed or used by this helper.
