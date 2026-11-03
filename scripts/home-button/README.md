# Read-only Home query

The separate settings writer and its read-only plan are documented in
[HOME-ONLY.md](HOME-ONLY.md). They do not alter this getter-only assembly.

This separate diagnostic targets the ARMv7 Tizen 9 capability profile. It does
not extend the firmware guards of `scripts/native-home/Control.cs`, and does
not contain apply, restore, boot or app-launch functionality.

`Query.cs` reads the native main operation through the existing bundle/AUL
query contract, four string preferences, one integer preference, firmware,
OS release and boot ID. It refuses arguments, non-ARM32 processes and any UID
other than SDK UID 901. A null or failed getter is recorded as unavailable;
an empty string remains an empty string. Neither is replaced with a default.
The bundle operation setter only fills the temporary query bundle. No native
Home assignment setter or vconf setter is imported.

Build with a verified local .NET SDK and keep all output under ignored
`.local/`. The portable net6.0 helper requires a compatible TV runtime.
The runner stages its two payload files and a temporary shell using SDB,
verifies their SHA-256 on both hosts, and invokes the published SDK package-name
command workaround. A one-time rename claims the staged script. Output uses a
bounded reverse TCP connection to the Mac, accepting only the requested TV IP.
The shell refuses root, checks the helper hashes, runs dotnet and attempts to
remove only this query's uniquely named temporary files. Cleanup status and
exit status must both be present and successful before output is accepted.
Failed staging or an interrupted connection can leave the reported temporary
paths behind. There is no automatic retry or security-policy change.

The private bundle contains `query.py`, `Query.dll`, `Query.runtimeconfig.json`
and `manifest.json`. Extract it into the owner's ignored `.local/home-button/`
directory and run `query.py --host TV_IP --sdb PATH_TO_EXISTING_SDB` there.
The runner reuses a connected serial; it never restarts SDB or edits signing
configuration. Do not use the older native helper's apply command.

Every accepted query creates a new timestamped diagnostic snapshot. Existing
files are never overwritten. This snapshot is a review candidate, **not an
approved recovery baseline**: unavailable/empty settings, getter type fidelity,
device/firmware binding and the exact Home-only recovery path need review
before any native write can be proposed. Startup and Art Mode must remain in
scope when reviewing a future Home-only implementation.

Run the offline checks with `python3 -B scripts/home-button/test_query.py`.
Passing these tests does not establish compatibility on a physical TV.
