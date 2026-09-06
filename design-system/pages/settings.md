# /settings — Settings page

> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](../README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../../src/) and [Tests](../../tests/); for its contracts, see the [QR protocol specification](../../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../../docs/spec/boot-and-reset-v2.md).

This is a page-specific design record based on MASTER.md as it stood at the time. Separate sections with Cards and use h2 headings. The recorded layout places all items from spec §28 in the following 5 sections.

## 1. Defaults

- Default encryption method (Select: A256GCM / RSA hybrid, the latter only when enableRsa is enabled)
- Default QR error correction level (Select: L/M/Q/H + explanation, "Higher levels are more resilient when scanning, but hold less data")

## 2. Plaintext handling

- Automatically clear plaintext after encryption (Switch, ON by default)
- Automatically clear after moving to the background (Switch, ON by default). The delay is fixed by env `VITE_AUTO_CLEAR_SECONDS=300`; the explanation says "after approximately 5 minutes"
- "Clear all plaintext" button (secondary) → fire `oc:clear-transient` + show a toast

## 3. Display

- Theme (Select: System / Light / Dark) → `localStorage['oc-theme']`

## 4. App information (PWA)

- PWA installation status (standalone detection: Installed / Viewing in browser)
- Offline readiness (SW offlineReady: Ready / Preparing) — **make no safety claim**
- Policy note: "The policy is not to update the app. Using a new version requires reinstallation after the device has been completely formatted."
- Version (`__APP_VERSION__`) / build (first 7 characters of `env.buildSha`, mono)
- Number of stored keys / number of saved QRs

## 5. Data deletion (destructive zone: destructive-colored heading and border, TriangleAlert)

The exact-match phrase below is glossed as "delete all," an English translation of the historical Japanese phrase. The historical input token was Japanese, not this English gloss.

| Action | Confirmation strength |
|---|---|
| Clear all saved QRs | Normal AlertDialog |
| Clear all keys | **Strongest: exact-match entry of the historical phrase meaning "delete all"** (spec §28) + "You will no longer be able to decrypt any ciphertext" |
| Reset all local data (delete IndexedDB + oc-* entries from localStorage) | **Strongest: exact-match entry of the historical phrase meaning "delete all"** |

Example confirmation dialog (English translation of the historical Japanese, with the typed phrase shown as an English gloss): "To delete, enter 'delete all'." Disable the action button until the input matches the historical Japanese phrase exactly. After execution, show a toast + reset the counts.

## 6. About security (Collapsible, open by default)

Include the complete disclaimer list from spec §2:

- The app's guarantee extends only to the application not intentionally transmitting plaintext or secret keys externally.
- Outside the scope of protection: compromised OS, browser, or firmware / keyloggers, screen recordings, or screenshots / malware that captures camera frames / supply-chain compromise during the initial PWA download or reinstallation / physical theft of the device / users accidentally sharing secret QRs / key loss through deletion of browser data
- The offline indicator is supplementary information about the current network state, not proof of safety.

## Feature detection

List availability of Web Crypto / IndexedDB / camera / Service Worker (unavailable items use a warning icon + "This feature is unavailable: …"). Also place the detailed UNSUPPORTED_BROWSER explanation here.
