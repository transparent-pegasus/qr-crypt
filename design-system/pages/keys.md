# /keys — Key list page

> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](../README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../../src/) and [Tests](../../tests/); for its contracts, see the [QR protocol specification](../../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../../docs/spec/boot-and-reset-v2.md).

This is a page-specific design record based on MASTER.md as it stood at the time. The key list corresponds to the former `/saved` page. Do not show a page heading or subtitle. Place creation and import UI in the `KeyAddDialog` modal (`src/components/key-add-dialog.tsx`), rather than in the page body.

## List controls

- `Tabs`: My keys / Others' keys
- Place 2 equally sized actions directly below the tabs. Keep them outside `TabsList` (`role="tablist"`) and visually separate (do not enclose them in a border that makes them look like one element). Both use `Button variant="outline"`, 44px, icon + label:
  - Plus — Create key → open `KeyAddDialog` in create mode
  - ScanLine — Scan key QR → open the same modal in import mode
- Immediately after creation, switch to the key detail view inside the same modal (do not transition to a separate dialog)

## Create mode (`KeyAddDialog` create)

- Creation forms such as "Generate symmetric key" / "Generate key pair" (key name Input + primary generation button). After generation, switch to the detail view + show a toast
- **Symmetric key QR**: "Show QR" immediately displays QrDisplay (white surface, fullscreen available). Include only the explanation "Contains a secret key that can be used for encryption and decryption"; do not add a warning Alert, confirmation checkbox, or gates for display, copy, or download.
- QR screen actions: below the QR, place 2 buttons in one row, Copy then Download. There are no in-app save, named-save, or SVG actions (Saved-QR / `qrArtifacts`). For a single image, omit the action row and show a left-aligned, icon-only fullscreen button; in fullscreen, show only a right-aligned close button.
- Public-key pair: RSA-3072 generation takes several seconds → spinner inside the button + "Generating… (this takes a few seconds)"; prevent duplicate execution. Public key QRs need no warning; use an explanation with the same structure as for symmetric key QRs: "Contains public key material used for encryption and signature verification." Do not provide QR display or export UI for private keys (`enablePrivateKeyExport=false` fixed)
- Duplicates: if a matching fingerprint exists during generation/import, show DUPLICATE_KEY text + the existing key name, and do not save. For PQ public bundle imports, reject a reimport with matching KEM/signature algorithms and both public-key byte sequences as `DUPLICATE_KEY`; reject other key-ID collisions (including partial collisions and collisions with revoked rows) as `KEY_ID_CONFLICT`. However, if either matching row is revoked, always use `KEY_ID_CONFLICT` even for identical key material: the disabled bundle hidden from the list reserves those IDs

## Import mode (`KeyAddDialog` import)

1. Select the scan target first (vertical RadioGroup, 44px): "Scan symmetric key" / "Scan public key" (spec §16; ciphertext scanning is on `/decrypt`)
2. "Start camera" button → QrScannerDialog (request camera permission at this point)
3. Successful scan → confirmation card: type / method / fingerprint (4×4 mono, with a comparison prompt, "Confirm that the fingerprint matches the one on the other person's screen," + **the full SHA-256 hex alongside it, copyable**. Explain that the shortened display is a quick check) / creation date/time + key name input (suggestions such as `Symmetric-key-import`, an English translation of the historical Japanese name)
   - Prefix does not match the selected target type → rejection text (e.g. "This is a public key QR. Change the scan target")
   - Saving a symmetric key requires extra confirmation (checkbox: "I trust the channel used to share this key")
   - Duplicate fingerprint → DUPLICATE_KEY (show the existing key name; saving is unavailable)
   - PQ bundle: reimport with matching KEM/signature algorithms and both public-key byte sequences → DUPLICATE_KEY; either key ID collides with an existing row (including revoked rows) → KEY_ID_CONFLICT (saving is unavailable). If a matching row is revoked, use KEY_ID_CONFLICT even for identical key material
4. Failure: show CAMERA_PERMISSION_DENIED / CAMERA_NOT_AVAILABLE with explanatory text + a remedy (e.g. grant permission in the settings app)

## List row actions

- Row actions (DropdownMenu / details): Show QR / Rename / Revoke (public bundle) / Delete
- Revoke (public bundle): the confirmation text must state that revocation hides the row and permanently reserves both the signing key ID and KEM key ID in this installation; it cannot be undone, and the row cannot subsequently be deleted from this screen. Only clearing all local data releases the reservation. If both IDs need to be released, choose Delete before revoking
- Delete: AlertDialog (normal confirmation) + explanation, "You will no longer be able to decrypt with this key." Key pairs containing a private key require **strong confirmation**
- Always show the "Highly sensitive" sensitivity badge for symmetric keys

## Shared QrScannerDialog rules

- Call getUserMedia only when opened. Always stop the stream when closed (whether success, cancellation, or error)
- Lock immediately on a successful scan (prevent repeated firing); do not play beeps or other sounds, and do not save scanned images
- Frame guide + "Align the QR code within the frame"; announce status with `aria-live`
