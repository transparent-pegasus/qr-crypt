# Native relay privacy information

[日本語](../locales/ja/privacy/native-relay.md)

Reviewed 2026-11-04. This notice describes the dedicated Windows relay under
development. It does not describe the offline encryption PWA or establish that a
native app has been released. Distribution status is recorded in the
[distribution guide](../develop/native-relay-distribution.md).

**Never install or use the relay on a device that holds, or has ever held, QR Crypt
keys, identities or plaintext. This includes a device with a browser where the
offline QR Crypt app is installed. Use a separate online device.** The camera sees
everything in its view, not only the QR code. This app has not been independently
audited.

## Information the app handles

The relay converts QR message frames to text, text back to QR frames, or a single
message frame to a QR image. It checks supported message formats but does not
generate or store keys, encrypt, decrypt or authenticate messages. Exchange keys
face to face, outside the relay.

When you start scanning, the app processes camera images to find QR codes. Those
images can include people, documents and screens around the code. Text you type
or paste enters the app before format validation, so accidentally entered personal
information or secrets can also be processed. Do not enter them.

Accepted ciphertext still exposes message kind, stable shared-key or recipient-key
identifiers, message size and frame count. Shared-key messages also expose the
sender-reported creation time. Repeated identifiers can link transfers; encryption
does not hide this information.

## Storage and copying

Camera processing, entered text, collected frames and generated QR images use the
current session's memory. The app does not intentionally save them to its
persistent storage. Its only app-managed persistent setting is the language
preference (`oc-lang`), written on initial display as well as when changed. The
theme follows the operating system.

An explicit copy action writes text or a PNG to the system clipboard. The app does
not read the clipboard through a clipboard-read API; ordinary typing and pasting
provide input. Clipboard contents, history, synchronization and copies in a
messenger remain outside the app's control after copying.

Closing the relay session, its time limit, leaving the page or the page becoming
hidden ends the session, stops its camera tracks and releases app-held content.
This is ordinary memory cleanup, not guaranteed erasure. The OS, WebView runtime,
keyboard or input method, screenshots, swap and crash reporting may retain copies
or other records. Closing or uninstalling the app does not establish that these
copies have been erased. WebView profiles and caches are separate from the app's
language setting.

## Network and third parties

The reviewed relay code has no user account, analytics service or backend for
sending message content. Its code and QR reader are bundled with it. You choose
the messenger or other app into which you copy output; that service's handling,
storage and synchronization apply to those copies.

This does not promise that the device, OS, WebView or Store never communicates or
collects information. Their maintenance, diagnostics and distribution behavior are
outside this app's control. A compromised device, runtime or app update can observe
input and camera images and copy data. Store updates are allowed only on the
separate relay device; the offline device must stay offline.

## Your controls and questions

Camera use begins only after your explicit action and reader preparation. You can
close the session or revoke camera access in the operating system. Copy only the
intended output, keep unrelated people and sensitive material out of camera view,
and manage clipboard history and synchronization in the OS and receiving apps.
These actions do not guarantee deletion of existing copies.

For general, non-sensitive questions, use the
[project's public issue tracker](https://github.com/transparent-pegasus/qr-crypt/issues).
Do not post personal information, camera images, input text, keys or message
ciphertext there. Report vulnerabilities through the private route in
[SECURITY.md](../../SECURITY.md); that route is for security reports, not a general
confidential privacy inbox. A dedicated private privacy contact has not yet been
published.

The [host contract](../spec/native-relay.md) records the implementation boundaries
and remaining package, platform and release checks.
