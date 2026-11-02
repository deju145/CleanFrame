# BBC iPlayer through Vetro: TV-only integration

The owner confirmed BBC iPlayer opens from Vetro but returns to Samsung Home when launched through either public web launch API on their LS03F.

This version adds a single-purpose endpoint to Vetro's existing service: `POST /cleanframe/bbciplayer`. It accepts only TV-loopback callers with an absent or packaged-widget (`null`) origin, verifies iPlayer is installed, and uses Vetro's existing native launch action. It is not an arbitrary command API. CleanFrame calls that endpoint and waits for an acknowledgement.

There is no separate relay process, no Mac startup command, and no new boot service. After a reboot, the integration is available once Vetro's service is running and its root agent is connected. Startup may be slow and may require opening Vetro manually on this TV. A Mac is needed only for building, signing and initial installation.

## Prepare the custom Vetro package

The patch is pinned to the installed Vetro 0.3.5 source revision reported by this TV: `fb1cadc66ff52cd86358b751e17c1cfb225e0733`. It refuses a different revision or unrelated changes in Vetro's HTTP service source.

From the CleanFrame checkout:

```sh
mkdir -p .local
git clone https://github.com/andrearicci93/vetro.git .local/vetro-source
git -C .local/vetro-source checkout --detach fb1cadc66ff52cd86358b751e17c1cfb225e0733
node integrations/vetro/prepare.cjs .local/vetro-source .local/vetro-bbc-unsigned.wgt
```

The preparation script modifies only that local Vetro source checkout, keeps its original HTTP service source under its ignored .local directory, and collects the complete root-integrated Vetro package using its own builder. It does not contact the TV or use certificates. The output is unsigned and cannot yet be installed.

## Signing and installation constraint

The existing Vetro installation came from Apps2Samsung. An in-place update must use the same author certificate. Do not assume the separately created CleanFrame certificate matches it. Obtain the existing Apps2Samsung signing profile or use a supported installer flow that signs with its original author key. Preserve Vetro's configuration and a recovery copy of its working package before installation.

Do not uninstall Vetro merely to bypass an author-signature mismatch. A separate app identity would also need review of service IDs, self-protection logic, ports and competing root agents.

Once the custom Vetro package can be signed and installed in place, rebuild/install CleanFrame as usual. Keep Developer Mode Host PC IP at 127.0.0.1 for Vetro's TV-local root acquisition. Test the native iPlayer launch, then repeat after a full power cycle with the Mac off.

## Validation

The endpoint's fixed launch, acknowledgement, CORS handling, rejection of network callers, methods and disconnected-root response have focused tests. Physical TV launch and power-cycle behaviour still require confirmation.

The previous temporary standalone relay and Mac startup script have been removed. Do not use instructions from that earlier implementation.
