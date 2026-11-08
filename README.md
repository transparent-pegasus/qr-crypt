# QR Crypt

日本語版: [README.ja.md](README.ja.md)

> Any device that has ever been online may already be compromised. Key exchange,
> encryption, and decryption must therefore happen on a device that stays fully offline.

QR Crypt is a Progressive Web App for a device you keep offline for good. You type a
message; the app encrypts it there and shows the ciphertext as a QR code. Your everyday
online phone scans the code and sends it as text through any messenger. The recipient
reverses the steps and decrypts on their own offline device.

## How it works

- **The offline device does the work.** It generates and manages keys, encrypts, and
  decrypts, with no CDN at runtime. Once set up, it never goes back online. To retire it,
  sanitize or destroy its storage: the app's own wipe is not enough (see
  [Security](#security)).
- **Keys travel face to face.** Keys and public keys are exchanged in person as QR codes:
  no server, cloud key escrow, or account sync. Within app-managed persistent storage,
  key records live only in the offline device's IndexedDB. A shared AES key travels as an
  exportable `OCK2` secret-key QR.
- **Fingerprints confirm identities.** Before you confirm an imported or saved identity,
  compare all 64 hex digits of its identity fingerprint with the intended person over an
  independent channel. Shared-key import checks all 64 key-fingerprint digits the same
  way. An acknowledgement proves neither the comparison nor a trusted channel
  ([threat model](docs/security/threat-model.md) T6).
- **Only light crosses the gap.** On the QR path, data moves between the offline and
  online devices as a QR code on one screen and a camera on the other. The app keeps no
  message ciphertext. Exported files (PNG, or a ZIP of frames) on removable media and
  clipboard text are separate paths: they fall outside this claim, the app's control,
  and its wipe.
- **Observers still see metadata.** Anyone watching a transfer sees the message type, the
  stable shared-key or recipient-key identifier, the size, and the frame count.
  Shared-key messages also show the sender-reported creation time. Repeated key
  identifiers link transfers.
- **Standard algorithms only.** AES-256-GCM, or the post-quantum ML-KEM-1024 / ML-DSA-87
  suite. The claim is about where they run.

## Getting started

### Route A: signed ZIP (default)

Route A keeps the offline device from ever contacting the live app origin. Before you
install, verify the signed ZIP independently: Cosign policy values from a separate
channel, the checksums, and an independent rebuild-and-compare. Follow the
[complete procedure](docs/develop/install-route-a/README.md). The archive's `INSTALL.txt`
is its self-contained copy that reaches the offline device.

### Route B: direct-origin PWA

1. On the device you will keep offline, open the app URL in a browser.
2. Install it with the browser's **Install** / **Add to Home Screen** action.
3. Wait until the install screen reports **Offline-use readiness: Ready**.
4. Disconnect the device from every network, and keep it that way.
5. Use the app from the normal screens, which appear once the device is offline.

Route B offers no integrity check you can perform (§1 of the
[Route A procedure](docs/develop/install-route-a/README.md) explains the risk). A Route B
device also keeps the live origin: after any reconnection, its reachability probe reaches
that origin before wipe can fire. Once Route A's install server stops and its reserved
port stays unused, its `127.0.0.1` origin has no peer to answer. High-assurance use must
use Route A only.

## Relay

The two offline devices need not share a room. A third, online device carries the
message text through any messenger. Use an online device that has never held QR Crypt
keys. Carrying only ciphertext is the intended workflow, not something the relay can
verify.

1. **Sender's offline device:** encrypt. AES shows one OCF2 frame; a post-quantum message
   shows a frame sequence.
2. **Sender's online device:** on the **Relay** page, use **QR → Text** to collect every
   frame, then copy the text into a messenger.
3. **Recipient's online device:** on the **Relay** page, paste the text into
   **Text → QR** and play the frames back.
4. **Recipient's offline device:** scan the frames. Only this device authenticates the
   assembled message (AEAD, plus ML-DSA for post-quantum messages).

For a single-frame message, **QR → QR** on the sender's online device replaces steps 2
and 3. It re-renders the frame as a QR image for a messenger that accepts images, and the
recipient scans it straight from the chat screen. It validates the frame exactly like
**QR → Text**, decrypts or authenticates nothing, and refuses multi-frame (post-quantum)
transfers.

Copied text and images can persist or sync outside the app, and outside any wipe. The
relay accepts only validated OCF2 `pq-message` and `sym-message` frames, never keys.
Allowlist and residuals: [threat model](docs/security/threat-model.md) T19 / T21.

## Requirements

- **Two devices per person:** one kept offline for good, one online for the relay.
- **Browser:** Android Chrome and iOS Safari are the primary targets; camera scanning
  needs Safari/iOS 16 or newer. Windows Chrome, macOS Safari, and Edge are reference
  environments ([browser matrix](docs/develop/browser-matrix.md)). Without Web Crypto or
  IndexedDB, the app stops at its start-up screen. The relay also needs the Web Locks
  API; a browser without it cannot relay.
- **Origin:** `https://`, or `http://127.0.0.1` locally. A `file://` path or plain HTTP on
  a LAN address does not work: the camera and the service worker are unavailable there.
- **WebAssembly:** camera scanning uses a WebAssembly decoder with no JavaScript fallback.
  If WebAssembly is blocked, the app disables scanning before any camera access and shows
  a blocked-reader message; on iPhone it points to Safari 16 or newer. Without JIT (some
  hardened or lockdown modes), decoding is expected to be much slower; how much is
  unmeasured on real devices.
- **Without camera scanning:** you can only type or paste a complete payload string, not
  single frames. Post-quantum messages, public keys, and identities always travel as
  frames, so they are impractical without a camera. AES keys and messages stay single
  strings.
- **Display:** QR display ignores the local decoder, because the sender cannot know what
  the peer camera reads. A labelled compatibility switch shows smaller frames for longer.
  Values and per-artifact clamps: [QR protocol](docs/spec/qr-protocol-v2.md) §6.

## Encryption

| Mode | Use it for |
| --- | --- |
| **Shared key** (default; AES-256-GCM, HKDF per message) | One-to-one messages, with a secret you shared in person. Each message is exactly one QR code. Keys rotate; superseded generations still decrypt. |
| **Public key** (ML-KEM-1024 + ML-DSA-87 + AES-256-GCM) | Many senders to one recipient, or no sender holding a secret that decrypts. ML-KEM sets the message secret from the recipient's public key; ML-DSA confirms the sender. Signatures and key data make each message a sequence of QR codes. |

For post-quantum identities and shared keys, rotation cadence sets the granularity of
forward secrecy. Superseded generations stay for decryption, so envelopes addressed to
them stay decryptable until you discard that generation.

An exact authenticated envelope seen earlier in this session is flagged before its
contents show. A post-quantum message ID that returns with different ciphertext is
refused. The check is session-scoped and resets on reload
([threat model](docs/security/threat-model.md) §5).

The single post-quantum suite is **experimental** and **not independently audited**. It
implements the FIPS 203 / FIPS 204 algorithms; that is not FIPS 140 validation or an
independent security assessment. Status and blockers:
[security review](docs/security/security-review.md).

## Security

The only guarantee: the app does not intentionally send plaintext or private keys off the
device.

Out of scope, as the in-app **About security** screen also states:

- Compromise of the OS, browser, or firmware
- Keyloggers, screen recording, screenshots
- Malware that captures camera frames
- Supply-chain compromise at first PWA fetch or reinstallation
- Physical theft of the device
- Your own accidental sharing of a secret QR
- Loss of keys through browser data deletion

**An offline indicator is not proof of safety.** It only reports the current network
state.

**Go online only to install or to use the Relay page.** While online, encryption,
decryption, key management, and settings stay blocked. If the app goes online during use,
it clears plaintext and decryption results at once.

**wipe-on-online** (default ON) fires only when a network is confirmed. It attempts
best-effort *logical* deletion of local data; physical erasure is not guaranteed (LevelDB
is append-only; SSDs use wear leveling). Even a full device format does not guarantee
erasure on flash media. When assurance matters, use a media-appropriate sanitization
procedure (for example NIST SP 800-88), or destroy the media. Details:
[boot and reset](docs/spec/boot-and-reset-v2.md).

**No in-app upgrade.** If the installed origin becomes reachable, the browser's
service-worker lifecycle can fetch and activate replacement code. Permanent offline
operation is a deployment requirement, not a browser guarantee
([threat model](docs/security/threat-model.md) §5). To use a new version, sanitize the
device and install fresh. Never bring a device that holds or has held keys, identities,
or plaintext-bearing state back online without sanitizing it first.

## Documentation

- **Specs:** [QR protocol](docs/spec/qr-protocol-v2.md) ·
  [Boot and wipe-on-online](docs/spec/boot-and-reset-v2.md) ·
  [Spec deviations](docs/develop/deviations.md)
- **Security:** [Threat model](docs/security/threat-model.md) ·
  [Physical and operational threats](docs/security/environment-threat-catalog.md)
  ([日本語](docs/locales/ja/security/environment-threat-catalog.md)) ·
  [Security review](docs/security/security-review.md) ·
  [Reporting a vulnerability](SECURITY.md)
- **Install and develop:** [Route A install](docs/develop/install-route-a/README.md)
  ([日本語](docs/locales/ja/develop/install-route-a/README.md)) ·
  [Browser matrix](docs/develop/browser-matrix.md) ·
  [Development setup](docs/develop/development.md) ·
  [Deployment and CI](docs/develop/deployment.md)
- **Archive:** [design-system](design-system/), historical design snapshots and their
  provenance; not a current specification.

## License

[Apache License 2.0](LICENSE). The archived design-system exports include MIT-licensed
generator output; see [PROVENANCE](design-system/PROVENANCE.md).
