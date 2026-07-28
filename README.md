# QR Crypt

日本語版: [README.ja.md](README.ja.md)

## Overview

> Any device that has ever been online may already be compromised. Key exchange,
> encryption, and decryption must therefore happen on a device that stays fully offline.

Once a device has been set up as the offline device, it never goes back online. To retire
it, run a media-appropriate sanitization procedure (for example NIST SP 800-88) or destroy
the medium — see the disclaimer below for why the app's own wipe is not enough.

QR Crypt is a Progressive Web App you install on a device you then keep permanently
offline. You type a message; the app encrypts it on that device and shows the ciphertext on
screen as a QR code. Your everyday online phone scans that code, turns it into a text
string, and sends it through any ordinary messenger. The recipient does the same in
reverse. Only the two offline devices ever see the real message — though anyone watching
the messenger can still see how large it is and how many pieces it came in.

**What it does**: encryption and decryption on the offline device (AES-256-GCM, or the
post-quantum ML-KEM / ML-DSA suites), key generation and management, QR display and
scanning, and offline startup as a PWA.

**What it does not do**: transmit plaintext or private keys off the device, store keys in
the cloud, use custom cryptographic algorithms, depend on CDNs at runtime, treat an
offline indicator as proof of safety, or keep message ciphertext inside the app. Files you
export yourself (PNG, or a ZIP of the frames) and anything you copy to the clipboard are outside the
app's control and outside the scope of its wipe.

### How it differs from other encryption apps

One thing: it is operated fully offline. That splits into two habits the app enforces.

* **Key exchange happens offline.** Keys and public keys are exchanged face to face as QR
  codes. There is no server in between, no cloud key escrow, no account sync. Keys live
  only in the offline device's IndexedDB.
* **Data moves between the offline and online devices as QR codes.** Nothing crosses that
  gap but light: a QR code on one screen, a camera on the other.

The algorithms themselves are the standard ones. The claim is about where they are run.

## Requirements

* **Two devices per person.** One that stays permanently offline and runs QR Crypt, and
  one ordinary online device used only to carry the scrambled text.
* **Browser.** Android Chrome and iOS Safari are the primary targets; camera QR scanning
  requires Safari/iOS 16 or newer. Windows Chrome, macOS Safari, and Edge are recorded as
  reference environments
  ([docs/develop/browser-matrix.md](docs/develop/browser-matrix.md)). Without Web Crypto or
  IndexedDB the app stops at a start-up screen and no feature is available.
* **Origin.** The app must be served over `https://`, or locally over
  `http://127.0.0.1`. Opening `index.html` from a `file://` path does not work, and plain
  HTTP over a LAN address does not either — the camera and the service worker are not
  available in those contexts.
* **WebAssembly.** Camera QR scanning uses a WebAssembly decoder, and there is no
  JavaScript fallback:
  * Where WebAssembly is disabled or blocked, the camera still opens, but the first decode
    fails with a QR-reader-blocked message. On iPhone, the message directs the user to
    Safari 16 or newer. Nothing can be scanned.
  * Where WebAssembly runs without JIT compilation (some hardened or lockdown
    configurations), decoding is expected to be much slower. How much slower has not been
    measured on real devices ([docs/develop/browser-matrix.md](docs/develop/browser-matrix.md)).
  * QR display does not follow the local decoder signal: the displaying device cannot know
    what the peer camera can read. One labelled compatibility switch lets you choose.
    Off is the shipped default (1,000 B every 200 ms); on is the compatible preference
    (100 B every 2,000 ms). If an artifact cannot fit at 100 B, its effective density is
    clamped upward for that artifact only and is not saved. At the 1,000 B clamp, the
    switch still keeps the longer 2,000 ms dwell.
  * The only remaining input path is then typing or pasting the payload text by hand, and
    that field accepts a complete payload string — not the individual QR frames. A
    post-quantum message is split across many frames, and post-quantum public keys and
    identities are always carried as frames too, so without a working camera neither
    post-quantum messages nor post-quantum key exchange are practical. AES-256 keys and
    messages remain single payload strings.

## Usage

### Install route A: signed ZIP

This is the default route. It keeps the offline device from ever contacting the live app
origin. Independent verification of the signed ZIP — Cosign policy values from a separate
channel, checksum check, and an independent rebuild-and-compare — is required before
installation. The complete procedure is in
[docs/develop/install-route-a.md](docs/develop/install-route-a.md). The archive's
`INSTALL.txt` is the self-contained copy that reaches the offline device.

That exact host and port are a security and storage boundary. If another page is later
served on the same host:port, it has same-origin access to the stored keys and Vault key;
if the port is changed after installation, QR Crypt becomes a different origin and cannot
reach its stored data.

### Install route B: direct-origin PWA

1. On the device you will keep offline, open the app URL in a browser.
2. Install it with the browser's **Install** / **Add to Home Screen** action.
3. Wait until the install screen reports **Offline-use readiness: Ready**.
4. Disconnect that device from every network and leave it that way.
5. Use the app from the normal screens that appear once the device is offline.

Route B provides no integrity check that the receiving user can perform. An attacker who
controls the origin, TLS, or CDN can serve an altered bundle to just one targeted device;
the recipient cannot detect it, and the Service Worker persists it. The device also keeps
that live origin: if it reconnects, a reachability probe goes to the same origin, and
because wipe fires only after the sentinel confirms reachability, that beacon necessarily
leaves before wipe. By contrast, route A's origin is `127.0.0.1`; after its dedicated
server is stopped and its reserved port is not reused, there is no peer for the probe to
contact. High-assurance use must use Route A only.

### Sending a message through an online device

The two offline devices do not have to be in the same room. A third, online device carries
the QR frames as text through any messenger. Use an online device that has never held QR
Crypt keys.

1. **Sender's offline device** — encrypt as usual and display the QR frames.
2. **Sender's online device** — open the **Relay** page, use **Scan → text**, collect every
   frame, and copy the joined text. That clipboard copy can persist or sync outside the
   app, and outside any wipe.
3. **Recipient's online device** — open the **Relay** page, paste the text into
   **Text → QR**, and play the frames back for the recipient's camera.
4. **Recipient's offline device** — scan the frames. Only this device assembles the
   message and verifies it cryptographically.

Public keys and identities are still exchanged face to face. The relay forwards canonical
QR frame strings whose **untrusted** outer header declares a message; it does not assemble
them, does not verify the inner type, and decrypts nothing. It never interprets the bytes
it carries — but it also cannot tell what they are: an artifact relabelled as a message,
including one carrying key material, passes the filter and is rejected only after the
offline device assembles it. The offline endpoint is the only place where an artifact is
authenticated ([docs/security/threat-model.md](docs/security/threat-model.md) T19).

## Encryption

| Mode | When to use it |
| --- | --- |
| **AES-256-GCM** (default) | Everyday messages. One QR code, and a key you hand over in person. |
| **ML-KEM-1024** (with HKDF-SHA256 + AES-256-GCM) | Messages that must stay private for decades. Built to resist a future quantum computer; heavier, so the message becomes a sequence of QR codes. |
| **ML-KEM-1024 + ML-DSA-87** | The same, with a signature so the recipient can verify who sent it. |

For post-quantum identities, the rotation cadence is the granularity of forward secrecy.
Rotation retains superseded generations for decryption, so every envelope addressed to an
older generation remains decryptable until you explicitly discard that generation.

The post-quantum suites are **experimental** and **not independently audited**. QR Crypt
adopts implementations of the FIPS 203 / FIPS 204 algorithms; that does not confer FIPS 140
validation or an independent security assessment. Current status and blockers:
[docs/security/security-review.md](docs/security/security-review.md).

## Documentation

* [docs/spec/qr-protocol.md](docs/spec/qr-protocol.md) — QR protocol specification (v1)
* [docs/spec/qr-protocol-v2.md](docs/spec/qr-protocol-v2.md) — QR protocol specification (v2, post-quantum), including the user-selected display preference and per-artifact density clamps
* [docs/spec/boot-and-reset-v2.md](docs/spec/boot-and-reset-v2.md) — Boot / wipe-on-online contract
* [docs/security/threat-model.md](docs/security/threat-model.md) — Threat model
* [docs/security/security-review.md](docs/security/security-review.md) — Security review record (v2, audit classification)
* [docs/develop/development.md](docs/develop/development.md) — Tech stack, setup, commands, environment variables
* [docs/develop/deployment.md](docs/develop/deployment.md) — Cloudflare Pages deployment and CI flow
* [docs/develop/install-route-a.md](docs/develop/install-route-a.md) — Complete Route A signed-ZIP install procedure
* [docs/develop/browser-matrix.md](docs/develop/browser-matrix.md) — Browser verification matrix and reference measurements
* [docs/develop/deviations.md](docs/develop/deviations.md) — Managed deviations from the specification
* [SECURITY.md](SECURITY.md) — Reporting a vulnerability
* [design-system/](design-system/) — Design system derived from ui-ux-pro-max
* [LICENSE](LICENSE) — Apache License 2.0, under which this project is distributed
* [design-system/PROVENANCE.md](design-system/PROVENANCE.md) — Provenance of the archival design-system exports, which include MIT-licensed generator output

## Security assumptions and disclaimers

The only guarantee this app makes is that the application does not intentionally transmit
plaintext or private keys off the device.

The following are outside the scope of defense, and are stated in the in-app "About
security" screen as well:

* Compromise of the OS, browser, or firmware
* Keyloggers, screen recording, screenshots
* Malware that captures camera frames
* Supply-chain compromise at first PWA fetch or reinstallation
* Physical theft of the device
* The user's own accidental sharing of a secret QR
* Loss of keys through browser data deletion

**An offline indicator is not proof of safety.** It only reports the current network
state.

**Going online is for installation and for the relay page — nothing else.** While online,
encryption, decryption, key management, and settings stay blocked. If the app
goes online while in use, plaintext and decryption results are cleared immediately.

**wipe-on-online** (default ON) fires only when a network is confirmed, and then attempts
best-effort *logical* deletion of local data — physical erasure is not guaranteed (LevelDB
is append-only; SSDs use wear leveling). Even a full device format does not guarantee
erasure on flash media. When assurance matters, use a media-appropriate sanitization
procedure (for example NIST SP 800-88), or destroy the media. Details:
[docs/spec/boot-and-reset-v2.md](docs/spec/boot-and-reset-v2.md).

**There is no update mechanism.** To use a new version, sanitize the device and install
fresh. Never bring a device that holds or has held keys, identities, or plaintext-bearing
state back online without sanitizing it first.

This project is distributed under the Apache License 2.0 ([LICENSE](LICENSE)).
