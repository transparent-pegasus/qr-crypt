# /decrypt — Decryption page

> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](../README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../../src/) and [Tests](../../tests/); for its contracts, see the [QR protocol specification](../../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../../docs/spec/boot-and-reset-v2.md).

This is a page-specific design record based on MASTER.md as it stood at the time. Encryption uses the separate `/encrypt` route (`encrypt.md`).

## Structure

- Input: "Scan ciphertext QR" button (`QrScannerModal`, targeting ciphertext, both single and multiframe) + a Textarea for pasting a payload
- Paste: show a type confirmation row (method and recipient key ID) and **do not decrypt automatically**. Execute with the "Decrypt" button
- Scan: when the scanner closes, decrypt the payload it has read directly. Pointing the camera is itself an explicit instruction, so no confirmation step is inserted
- Resolve the decryption key from the payload's key ID. There is no selection UI. If no corresponding key exists, show `KEY_NOT_FOUND` and disable the button
- On multiframe completion, extract the assembled bytes, then call `discard()` on `MultipartScanSession` so no copy remains in the assembler
- Resolve the signing key through an exact storage index lookup (`findBundleBySigningKeyId`). Do not use a list cache or "most recently imported wins." Treat revoked rows as unknown
- Decryption result modal contract:
  - `first-seen`: show plaintext in the modal (selectable text). **Memory only; do not save**
  - `already-received`: show a labelled destructive replay alert and withhold plaintext until an explicit "Show anyway" action
  - `MESSAGE_ID_REUSED`: error text only. **Do not open** the result modal
  - Valid signature and `fingerprint-confirmed`: use the success color for the signature row and show identity verification as successful too
  - Valid signature but unconfirmed identity: use a neutral color for the signature row. Above the plaintext, show a destructive identity-unconfirmed alert (title and body from `decrypt.result.identityUnconfirmed.*`, followed by the identityCheck text)
  - On PQ success, show the time reported by the sending device (`decrypt.result.senderCreatedAt`). Do not treat it as evidence of freshness
  - Give each security Alert title an id and associate it via `aria-labelledby`. Multiple alerts must be distinguishable by name
- If the signing key is unknown, do not open the modal; show only a `SIGNING_KEY_NOT_FOUND` alert and a link to `/keys` (no partial plaintext display)

## Plaintext handling

- Do not automatically save or restore decryption results (state only)
- Session receipts (`src/features/receipt-cache.ts`) are a session-memory structure separate from plaintext. A bounded Map tracks authenticated messages, disappears at the end of the document's lifetime, and does not survive reload. Do not write it to IndexedDB / localStorage / CacheStorage
- When "Automatically clear after moving to the background" is enabled (ON by default), clear the ciphertext input and decryption result and discard the scan session approximately 5 minutes after visibilitychange hidden; the delay is fixed by env
- Clear immediately on the `oc:clear-transient` event ("Clear all plaintext" on the settings page). Receipts are also cleared with `clearReceipts()` through the wipe / transient-clear paths
- Also discard `MultipartScanSession` when the page unmounts. With separate routes, unmounting is routine
