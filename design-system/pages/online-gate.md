# OnlineGate — Online setup and ciphertext QR relay

> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](../README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../../src/) and [Tests](../../tests/); for its contracts, see the [QR protocol specification](../../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../../docs/spec/boot-and-reset-v2.md).

This historical design record mixes later revisions with rules for the retired OCM1 format.

A fullscreen gate placed after feature detection and before the normal router. While online, never show `/encrypt`, `/decrypt`, `/keys`, or `/settings`; show PWA setup information and, only when the key, PQ identity, and Vault key stores have all been read successfully and confirmed to contain 0 rows (fail closed on read failure), a ciphertext QR relay handling 1 canonical OCM1 message or a complete set of OCF2 frames. The online shell still performs its fixed localStorage writes (`oc-theme` / `oc-lang` / ack markers / last-opened tab `oc-online-tab`), so this does not mean "storage is empty." The operational rule that a device holding keys must not go online remains unchanged.

## Display content

- Show language selection, the app icon, app name, and network status badge (Online) on both the Top and Relay pages.
- Top page:
  - PWA installation status (Installed / Not installed)
  - "Install PWA" button when `beforeinstallprompt` has been captured
  - Instructions for "Add to Home Screen" in the share menu on iOS Safari
  - Service Worker offlineReady (Ready / Preparing)
  - Main guidance: "Switch to offline mode (airplane mode) to use encryption, decryption, key management, and settings" (do not describe an offline indicator as proof of safety)
- Relay page:
  - "Ciphertext QR relay" card, available only after boot has completed its wipe decision. Accept 1 canonical OCM1 message or a complete set of canonical OCF2 frames whose untrusted outer headers declare `pq-message`
  - "QR → Text" (the English label was `QR → Text`): the button opens a dialog; acquire the camera only after a further explicit action. OCM1 capture completes in 1 scan; OCF2 collects the complete set
  - "Text → QR": paste 1 OCM1 string or a complete set of newline-delimited OCF2 frames. Play OCF2 with the existing animated QR display; show OCM1 as a single QR
  - "QR → QR": use the same camera acquisition path as "QR → Text." If the first accepted frame declares `frameCount > 1`, discard the capture, stop the camera, and direct the user to "QR → Text." Only when complete in 1 frame, redraw that canonical string as a QR image with `renderQrDataUrl` and offer "Copy QR image." Do not add a download action (`relay.playback.noDownloadControls` remains true)
  - Arrange the 3 buttons in one `sm:grid-cols-3` row with only the arrow labels. Immediately below, provide a hint in both languages explaining the requirements for "QR → QR" (the messaging app must support pasting images, and the message must fit in 1 QR)
  - Give the dialog itself top and bottom safe-area padding
  - Use 44 px controls, `focus-visible:ring-2`, and lucide icons + text
- Only when relay eligible, show 2 icon-only items, "Top" and "Relay," in the shared bottom shell. To keep navigation visible while the selected Relay tab's eligibility is temporarily pending, use `navVisible` = `relayEligible || tab === "relay"`. Add `pb-content-safe` to the body while fixed navigation is visible.
- Treat the bottom controls as page navigation using `<nav>` + individual `<button aria-current="page">` elements, like the offline navigation; do not use `role="tablist"`.
- Save the selected tab to localStorage `oc-online-tab` (only 2 values: `top` / `relay`) only when navigation is pressed, and open that tab on the next launch. Missing or unknown values mean `top`. This avoids making an online-only device select Relay on every launch; do not write on a device where navigation has never been pressed. Deleting all `oc-*` entries removes it, so wipe / full reset returns to Top.
- Restore a saved `relay` value only after relay eligibility is confirmed. While ineligible / pending, do not restore it: `tab` stays `top`, so neither navigation nor its write path appears (do not weaken the existing `navVisible` rule by restoring across that boundary).

## State transitions and protections

- Show the relay only when `network-confirmed/eligible` and the display state is also online. Do not show it while the decision is pending, during `wiping` or `partial-failure`, when keys remain because of a maintenance token or `wipeOnOnline:false`, or when storage cannot be read completely.
- Do not reset the selected `tab` when eligibility changes. Fail closed by showing only the Top panel through `activeTab = relayEligible ? tab : "top"`; switch the Top and Relay wrappers with the `hidden` attribute.
- Keep the `OnlineRelay` component instance mounted while either Top or Relay is displayed; do not conditionally unmount it when eligibility is false. This preserves `visibilitychange` / `pagehide` / `pageshow` monitoring and session-end handler registration. Even if an eligibility refresh inside `openDialog` synchronously emits pending, the pending-open generation survives so the dialog can open after the decision completes.
- Check `keys`, `pqIdentities`, Vault key metadata, and preferences in the same readonly boot transaction; treat any open/store/count/get/transaction failure as `indeterminate` and fail closed.
- online→offline: synchronously call the relay's imperative `endSession` before closing the gate. Do not show normal pages until the existing acknowledgement conditions are met.
- offline→online: hide normal pages immediately and simultaneously fire TransientClear to clear plaintext, decryption results, and the result payload.
- Recheck the empty state immediately before opening the relay and on `visibilitychange` to visible. There is no cross-tab exclusive lease, so a stale-policy race remains if another tab creates keys immediately after the check.
- Keep the camera-startup AbortController and acquired `QrScanHandle.stop()` separately; terminate both on close, unmount, hidden, pagehide, BFCache pageshow, loss of visibility/eligibility, local/peer wipe, timeout, and terminal error. Do not automatically reacquire the camera on BFCache return.
- If Web Crypto or IndexedDB is unavailable, show `UNSUPPORTED_BROWSER` before OnlineGate.
- An offline indicator is an operational condition for enabling features; do not present it as proof of safety.

## Describing the relay boundary

- Accept only "canonical OCF2 frames whose untrusted outer headers declare `pq-message`" or "1 canonical OCM1 message whose full-envelope decode and canonical re-encode match the input byte-for-byte." The OCM1 check establishes only structural canonicality. The relay does not reassemble OCF2 or verify the whole hash, AEAD, signatures, senders, authenticity, or safety. It decrypts nothing. Rejecting top-level key-artifact prefixes and disallowed OCF2 outer types cannot guarantee that accepted opaque bytes contain no key material. Treat the receiving offline endpoint as the authority, and recommend in-person key exchange as an operational practice.
- Retain OCF2 frame strings verbatim even after validation; only sort them by ascending index and join them with LF. Do not reassemble, resplit, or provide density control. Redisplay OCM1 as a single QR after the canonicality check, without animation controls.
- Copy is an intentional export to the clipboard; show a warning that the data may persist or sync outside the app. This applies both to text copy and to PNG `ClipboardItem` export in "QR → QR"; provide dedicated warning text for the latter too. QR displays cannot prevent long-press saving, printing, screenshots, or screen recording.
- The enforceable UI constraint is "no app-provided file download controls." Do not intentionally write frame-derived or OCM1-derived values to app-managed IndexedDB/localStorage/CacheStorage/URL/history/log or relay-payload-bearing network requests. The shell has separate fixed storage/network behavior.
