# /encrypt — Encryption page (default page)

> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](../README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../../src/) and [Tests](../../tests/); for its contracts, see the [QR protocol specification](../../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../../docs/spec/boot-and-reset-v2.md).

This is a page-specific design record based on MASTER.md as it stood at the time. Decryption uses the separate `/decrypt` route (`decrypt.md`).

## Structure (top to bottom, strictly following spec §7.1)

1. App name (h1, in the header)
2. Network status badge (right side of the header)
3. Encryption method selector — `Select`. Display names follow spec §7.3: "Symmetric key — AES-256-GCM" and "Public key — RSA-OAEP-3072 + AES-256-GCM." Hide B when `enableRsa=false`
4. Key selector — `Select`. Filter by method (A = symmetric key / B = public key or the public part of a key pair). If there are 0 candidates, show an empty-state link: "Create a key on the keys page." Show the key name + the first group of its fingerprint
5. Plaintext input — `Textarea` (min-h 120px, multiline). Below it, show "Character count / UTF-8 byte count (mono, aria-live=polite)" and the 4096B limit. When exceeded: use the destructive color + icon + explanation for the byte count, and disable the encryption button
6. Byte count and estimated QR size — format: "Estimated payload: about N characters / EC=Q limit 1663." If it is unlikely to fit, show a warning icon + text
7. Encryption button — primary, full width, 44px. Disabled when: no key selected, plaintext empty, byte limit exceeded, or processing (spinner + "Encrypting…")
8. Encryption result — only on success. Payload string (mono, break-all, max-h 96px with scrolling, copy)
9. Ciphertext QR — QR display panel (fixed white background). On generation failure, show the reason (e.g. size limit exceeded) with `role="alert"`
10. QR name input — `Input`. Automatic suggestion: `Ciphertext-YYYYMMDD-HHmmss` (English translation of the historical Japanese name template). Validate 1–80 characters
11. Action row — Save (in-app) / PNG / SVG / Copy. On successful save, show a toast + a link to saved items. For a duplicate (same payloadSha256), show a confirmation dialog: "A QR with the same content is already saved"
12. Details — `Collapsible` labelled "Details": algorithm, key ID, creation date/time, IV (hex), ciphertext size, and AAD contents

## Plaintext handling (spec §7.2)

- Do not automatically save or restore plaintext (state only). Always show the "Clear plaintext" button (enabled only when input exists)
- After successful encryption: if "Automatically clear plaintext after encryption" (ON by default) is ON, clear it + show a toast; if OFF, retain it
- When "Automatically clear after moving to the background" is enabled (ON by default), clear plaintext, decryption results, and the result payload approximately 5 minutes after visibilitychange hidden; the delay is fixed by env (show "Automatically cleared" on return)
- Clear immediately on the `oc:clear-transient` event ("Clear all plaintext" on the settings page)
