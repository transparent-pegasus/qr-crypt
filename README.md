# Qrypt

日本語版: [README.ja.md](README.ja.md)

Offline-encryption QR PWA. A Progressive Web App that encrypts plaintext on-device and displays/scans ciphertext and key material as QR codes. Message ciphertext is never persisted to app-managed IndexedDB/localStorage. PNG/SVG/ZIP downloads and clipboard copies explicitly initiated by the user may remain in the OS, browser, or sync targets, and are outside the scope of wipe/purge.

**What it does**: offline encryption with AES-256-GCM and the v2 post-quantum suites (ML-KEM / ML-DSA), key generation and management, QR display and scanning, and offline startup as a PWA.

**What it does not do**: transmit plaintext or private keys off the device, store keys in the cloud, use custom cryptographic algorithms, depend on CDNs at runtime, treat an offline indicator as proof of safety, or persist message ciphertext inside the app (maintainer requirement; session display and user-initiated export only).

## How Qrypt differs from other encryption apps

There are plenty of apps that merely "encrypt and decrypt strings". What Qrypt aims for is not novelty in cryptographic algorithms but **closing off, at the design stage, the very paths by which plaintext and keys leave the device**. Even with correct encryption, holes in key and plaintext handling, delivery paths, or the execution environment make the result insecure. Qrypt puts its focus exactly there.

* **Data-exfiltration paths eliminated from the runtime** — The app has no external networking as an application feature (no third-party or cross-origin clients). Permitted runtime requests are the same-origin `GET /reachability-sentinel.txt` probe that gates wipe-on-online, the recurring same-origin `HEAD /manifest.webmanifest?reach=…` display probe, and static/PWA asset fetch/revalidation — none carries user or frame data. It loads no external fonts, CDNs, analytics, error-reporting SDKs, or remote configuration. CSP (`connect-src 'self'` and more) blocks outbound traffic at the browser level as well. Where a typical "encryption web app" loads CDNs, fonts, and measurement tags — a latent exfiltration surface — Qrypt keeps requests same-origin and non-payload-bearing.
* **Offline-only crypto with a narrow online gate** — While online, encryption, decryption, key management, storage, and settings stay blocked. The online screen covers PWA installation and, on a logically clean origin whose sensitive-store scan completed without error, an optical relay that forwards exact canonical OCF2 strings whose untrusted outer header declares `pq-message` (no assembly, no decryption, no frame-derived app persistence, no frame-bearing network request; see [docs/threat-model.md](docs/threat-model.md) T19). wipe-on-online (default ON) fires only when network-confirmed (reachability sentinel body match) and attempts best-effort logical deletion of local data (physical erasure is not guaranteed). Residual risk is documented in the threat model (T18: probe false-negative window; T19: untrusted relay hop).
* **Air-gapped key exchange with no server in between** — Keys and public keys are exchanged as QR codes face-to-face; message ciphertext is also QR-framed and may additionally pass through a dedicated online relay as verbatim OCF2 text. There is no cloud key escrow and no account sync. Keys live only in the device's IndexedDB; the app itself never transmits or stores them externally, and the only way key material leaves the device is a deliberate, strongly-confirmed user export of a key QR (see threat model T3). Message ciphertext is never persisted to app-managed IndexedDB/localStorage — only transient on-screen display and user-initiated PNG/SVG/ZIP or clipboard export (the latter may remain in the OS, browser, or sync targets and are outside the scope of wipe/purge).
* **Authenticated encryption with strict failure behavior** — AEAD (AES-GCM) with AAD provides tamper detection; on authentication failure, no partial plaintext is ever shown. Internal decryption exceptions are normalized into fixed user-facing messages; key material and stack traces never reach the screen or logs. This rules out the "unauthenticated mode" and "partial output on failure" common in naive crypto apps.
* **No plaintext left behind** — Plaintext and decryption results are never persisted; they exist only in React memory. Auto-clear after successful encryption and auto-clear after the app moves to the background are enabled by default. Plaintext is never passed to the QR generation library; only post-encryption ciphertext is handled.
* **Standard algorithms only, no custom crypto** — Randomness comes from a CSPRNG (`crypto.getRandomValues`), cryptographic operations are built on Web Crypto, and IV reuse, fixed IVs, and ad-hoc key combination are forbidden. Crypto code is isolated in dedicated modules (`src/crypto/*`); UI pages invoke those modules' high-level operations and never touch Web Crypto primitives or key material directly.
* **Defense that extends to the delivery path (supply chain)** — Dependency lockfiles are committed, CI installs with a frozen lockfile, and registry vulnerability advisories and provenance are checked to keep dangerous packages out (for an incident actually detected and handled, see [docs/threat-model.md](docs/threat-model.md) §5.1). No configuration fetches crypto code from a CDN at runtime.
* **Verifiability and an honest threat model** — The source code, the QR protocol specification, and the threat model are public, and round-trips, tampering, wrong keys, IV uniqueness, and more are covered by tests. And **what is not defended is stated explicitly** (see "Security assumptions and disclaimers" below). Not overclaiming safety is itself a design policy.

None of this is a claim that "the algorithm is stronger". The differentiation rests on the view that **the operational model — offline crypto on devices that hold protected material, air-gapped key exchange, no user/frame-data-bearing network requests, honest about its limits — is what determines practical security when plaintext is handled in the real world**. A dedicated clean-origin relay device is not a key/plaintext-bearing endpoint; it may stay online only to forward outer-header-declared `pq-message` OCF2 strings. Always consult the next section for the limitations.

## Security assumptions and disclaimers

The only guarantee this app makes is that the application does not intentionally transmit plaintext or private keys off the device.

The following are outside the scope of defense and are stated explicitly in the in-app "About security" screen:

* Compromise of the OS, browser, or firmware
* Keyloggers, screen recording, screenshots
* Malware that captures camera frames
* Supply-chain compromise at first PWA fetch or reinstallation
* Physical theft of the device
* The user's own accidental sharing of a secret QR
* Loss of keys through browser data deletion

**An offline indicator is not proof of safety.** The "offline" indicator is never treated as proof of safety; it is only auxiliary information showing the current network state.

Plaintext is auto-cleared after successful encryption by default. Auto-clear after the app moves to the background is also enabled by default, and the only configurable choice is ON/OFF. The delay uses the fixed value `VITE_AUTO_CLEAR_SECONDS=300` (about 5 minutes).

**The online state is for fresh PWA installation plus a narrow clean-origin optical relay.** While online, encryption, decryption, key management, storage, and settings stay blocked. The install screen may also offer an optical relay that forwards exact canonical OCF2 strings whose untrusted outer header declares `pq-message` — only when a sensitive-store scan has completed without error and the origin holds no key rows, PQ identity rows, or Vault key. The relay does not assemble or verify the artifact, total hash, inner type, AEAD, or signature; it writes no frame-derived value to app-managed storage or CacheStorage and makes no frame-bearing network request. Explicit clipboard copy/paste may persist or sync outside the app; displayed QR images can be captured by the browser or OS. If the app transitions to online during use, plaintext, decryption results, and result payloads are cleared immediately.

**wipe-on-online** (setting default ON) does not fire on the display-level online heuristic; it fires only when network-confirmed (the body of `/reachability-sentinel.txt` matches). It does not fire on the install-gate path (which holds no sensitive data). The runtime wording is "attempts best-effort logical deletion of local data; physical erasure is not guaranteed" (LevelDB is append-only; SSDs use wear leveling). Even a full device format does not guarantee erasure on flash/SSD media; when assurance matters, use a media-appropriate sanitization procedure (e.g. NIST SP 800-88) or destroy the media. Details: [docs/boot-and-reset-v2.md](docs/boot-and-reset-v2.md).

## Post-quantum cryptography (v2, experimental)

v2 is **experimental**. We distinguish `implementation-complete` — the implementation, tests, and documentation are all present in the repository — from `release-approved` — reached only after an independent third party has reviewed the pinned versions and the app as a whole and the review has been recorded ([docs/security-review.md](docs/security-review.md)). Because the project is not independently audited, `release-approved` has not been reached, and the UI, README, and CI keep the experimental / not-independently-audited labeling. Qrypt adopts implementations of the FIPS 203/204 algorithms; it does not claim to be "FIPS certified" or "perfectly secure".

### Available suites

| Suite | Contents | Notes |
| --- | --- | --- |
| AES-256-GCM | Symmetric encryption only | Existing path |
| ML-KEM-1024 + HKDF-SHA256 + AES-256-GCM | Post-quantum KEM hybrid | **Default** (`MLKEM1024_A256GCM`) |
| The above + ML-DSA-87 signature | sign-then-encrypt | Signed messages |

The current active policy is **maximum** (1024/87) only. The wire contract keeps 4 suites
(768/65 and 1024/87, each with and without signatures), but balanced
(768/65) has been demoted to reserved types and suite codes and is rejected at the
operational boundary with `UNSUPPORTED_ALGORITHM`.

### PQ benchmark reference values

Values from a single run of `aube bench:pq` on 2026-07-25 (Vitest 4.1.10, Linux x86_64,
Intel Core i7-10870H). `hz` is operations per second;
mean is the average milliseconds per operation.

| Operation | node hz | node mean (ms) | ui (jsdom) hz | ui (jsdom) mean (ms) |
| --- | ---: | ---: | ---: | ---: |
| ML-KEM-1024 keygen | 939.51 | 1.0644 | 1,028.91 | 0.9719 |
| ML-KEM-1024 encapsulate | 845.64 | 1.1825 | 937.59 | 1.0666 |
| ML-KEM-1024 decapsulate | 635.18 | 1.5744 | 744.56 | 1.3431 |
| ML-DSA-87 sign | 76.6329 | 13.0492 | 82.7556 | 12.0838 |
| ML-DSA-87 verify | 238.58 | 4.1914 | 265.85 | 3.7615 |

These are reference values from a development machine; they are not a substitute for
measurements in real browsers or on low-end devices, nor for the `release-approved` determination.

### Multi-QR (OCF2)

Large payloads are split into `OCF2` frames for display and scanning.

* Display: automatic cycling (with a default interval; pause / previous / next / speed adjustment available)
* Scanning: any order, duplicates ignored. Missing frames are shown explicitly in the UI. Frames mixed in from a different transfer yield `FRAME_MISMATCH`
* Export: all frame PNGs at once, and a store-only ZIP (uncompressed; no added dependency)

Details: [docs/qr-protocol-v2.md](docs/qr-protocol-v2.md).

### Seed vault

Post-quantum identities never persist expanded private keys; only the **seeds** (KEM 64B / DSA 32B) are stored, encrypted by the Vault (a non-extractable AES-256-GCM `CryptoKey`). On use, the flow is: decrypt → re-expand via keygen → operate → destroy the buffers.

## Tech stack

* React / React DOM / React Router
* Vite / TypeScript / Tailwind CSS v4
* shadcn/ui (Radix UI) + sonner
* Web Crypto API / IndexedDB (idb)
* Zod / cbor-x / qrcode / @zxing/browser and @zxing/library
* vite-plugin-pwa / workbox-window
* Vitest / Testing Library / Playwright (@playwright/test)
* Aube (package manager) / mise (pinned tool versions)
* Cloudflare Pages / GitHub Actions

## Required tools

Tool versions are pinned in `mise.toml`.

* node `26.5.0`
* aube `1.32.0`

```bash
mise install
```

## Initial setup

```bash
git clone <repository-url>
cd qrypt
mise install
aube ci          # or, first time only, aube install
```

## Development

```bash
aube dev         # dev server
aube typecheck   # TypeScript checks
aube lint        # ESLint
aube bench:pq    # post-quantum bench (reference values; not a substitute for on-device measurement)
```

## Testing

```bash
aube test              # unit / integration / ui (Vitest)
aube test:pq-vectors   # post-quantum known-answer tests (KAT)
aube test:pq           # post-quantum integration
aube test:qr-multipart # multi-QR (OCF2) assembly and splitting
```

E2E:

```bash
aube exec playwright install chromium
aube test:e2e
```

On CI, `aube exec playwright install --with-deps chromium` is used. The validate job also runs `test:pq-vectors` / `test:pq` / `test:qr-multipart`.

## Build

```bash
aube build:prod
```

`--mode prod` loads `.env.prod`.

## Environment variables

| File | Role |
| --- | --- |
| `.env.example` | Tracked in Git. Template and non-secret defaults |
| `.env.prod` | May be tracked in Git. Non-secret production settings |
| `.env.local` | Not tracked in Git. Per-developer non-secret settings |

Important:

* `.env.local` is optional. Without it, the defaults in `.env.example` / `.env.prod` pass all gates (`aube ci` through `aube test:e2e`)
* `VITE_*` values are embedded in the built client code, so **they must never contain secrets**
* Do not put encryption keys, private keys, Cloudflare API tokens, or decryption material in `.env`
* Do not use feature flags as access control or secret protection
* `VITE_ENABLE_ECDH` / `VITE_ENABLE_PRIVATE_KEY_EXPORT` are **reserved flags** (no UI or module branches are implemented; they are not shown as options)

## Deployment (Cloudflare Pages, Direct Upload)

This is not run in parallel with GitHub's Cloudflare Git Integration. GitHub Actions uploads `dist` via Wrangler (Direct Upload).

### Prerequisites

1. Create the Pages project on the Cloudflare side:

   ```bash
   wrangler pages project create <name>
   ```

2. Register the GitHub Repository Secrets (an API token with the minimum permissions required for Pages deploys):
   * `CLOUDFLARE_ACCOUNT_ID`
   * `CLOUDFLARE_API_TOKEN`
3. Register the GitHub Repository Variable:
   * `CLOUDFLARE_PAGES_PROJECT`

### CI flow

* `pull_request` / `push` to `main` runs validation via `.github/workflows/cloudflare-pages.yml`
* A `push` to `main` deploys to Cloudflare Pages after validation succeeds
* An independent `e2e` job also runs, but it **does not block deployment**

### `public/_headers` / `public/_redirects`

* `_redirects`: SPA routing (`/* /index.html 200`)
* `_headers`: security headers such as CSP, plus `Cache-Control: no-cache` for the SW / manifest (see the managed-deviations table below)

## Installing on an offline device

1. Open the app URL on an **online** device
2. **Install it as a PWA** following the browser's instructions
3. On the online install screen, confirm **"Offline readiness: ready"**
4. Switch to airplane mode (or disconnect from the network)
5. Use all features on the normal screens shown once the device is offline

The installed app's metadata (PWA manifest name/description) is fixed in English, while the in-app UI language is switchable between English and Japanese.

**This app has no update mechanism.** To use a new version, sanitize the device (a full format alone does not guarantee erasure on flash/SSD media — see the wipe note above) and perform a fresh offline installation. Never bring a device that holds or has held keys, PQ identities, a Vault key, or plaintext-bearing session state back online without sanitizing it first. A dedicated clean-origin relay device is the exception: it should ideally never have held Qrypt keys and stays online only for the optical relay below.

### Using the online optical relay

When two offline devices cannot show QR codes to each other, a third **online** device can carry frame strings through any messenger:

1. **Sender offline device** — encrypts as usual and displays the animated OCF2 frames.
2. **Sender-side online relay** — on a clean origin (post-decision, no key/identity/Vault rows), uses **Scan → text**, collects every frame, then copies the `\n`-joined blob. That clipboard copy can persist or sync outside the app and outside any wipe.
3. **Recipient-side online relay** — pastes the blob into **Text → QR** and plays the same frame strings for the recipient's camera. There are no app-provided file-download controls in the relay UI.
4. **Recipient offline device** — scans and completes the transfer; only this offline endpoint performs authoritative assembly and cryptographic validation (AEAD, and signature when present).

The relay forwards exact canonical OCF2 strings whose untrusted outer header declares `pq-message`. It does not assemble, decrypt, re-encrypt, or touch key material. Public-key and identity exchange stays a face-to-face workflow — the outer-header filter is not an enforcement guarantee that only ciphertext is carried. Prefer a relay device that has never held Qrypt keys.

### Breaking changes in the v2 update (caution)

* Existing **OCM1-RSA** ciphertexts are unrecoverable. Non-extractable RSA private keys cannot be rescued (no decryption compatibility is retained).
* The saved-QR feature has been removed. Ciphertext and key QR codes are not persisted inside the app, and there is no `qrArtifacts` store in IndexedDB. QR codes are handled only via on-screen display and user-initiated export.

## Pre-release checklist

Before any production-grade release or `release-approved` determination, confirm the following every time ([docs/security-review.md](docs/security-review.md) §3):

1. Check the latest FIPS 203 / FIPS 204 errata (the relevant NIST CSRC pages)
2. Check the changelog, known vulnerabilities, and advisories for `@noble/post-quantum`
3. Confirm the KATs (`aube test:pq-vectors`) are all green
4. Confirm the bundle contains no external network references (covered by an e2e test)
5. Review the `aube-lock.yaml` diff (provenance maintained)

Blockers as of 2026-07-25 ([docs/security-review.md](docs/security-review.md) §1):
`@noble/post-quantum` 0.6.1 is not independently audited. All known dependency
advisories are resolved (`sharp@0.35.2`, `react-router@8.3.0`,
`brace-expansion@5.0.8` via override — see the security review §1), and
`aube audit` succeeds. Regardless,
`release-approved` will not be granted until the v2 on-device measurements in
[docs/browser-matrix.md](docs/browser-matrix.md) (at least
Android Chrome and iOS Safari) and an independent audit record are in place.

## Documentation

* [docs/qr-protocol.md](docs/qr-protocol.md) — QR protocol specification (v1)
* [docs/qr-protocol-v2.md](docs/qr-protocol-v2.md) — QR protocol specification (v2, post-quantum)
* [docs/threat-model.md](docs/threat-model.md) — Threat model
* [docs/security-review.md](docs/security-review.md) — Security review record (v2, audit classification)
* [docs/boot-and-reset-v2.md](docs/boot-and-reset-v2.md) — Boot / wipe-on-online contract
* [docs/browser-matrix.md](docs/browser-matrix.md) — Browser verification matrix (includes v2 on-device measurement columns)
* [design-system/](design-system/) — Design system derived from ui-ux-pro-max

## Managed deviations from the specification

| Deviation | Reason / basis |
| --- | --- |
| `toast` → `sonner` | The shadcn v3 registry has no `toast` (removed), so the official successor `sonner` is used |
| No shadcn CLI; manual vendoring | The CLI generates an npm-style lockfile, so it is not used. Components are placed manually into `src/components/ui/` from the official registry JSON |
| `radix-ui` umbrella package not adopted | Only `radix-ui@1.6.4` lacked provenance, so the scoped `@radix-ui/react-*` packages are used. Supply-chain incident details: [docs/threat-model.md](docs/threat-model.md) §5.1 |
| `typescript@6` pin | Major version 6 is pinned explicitly (`"typescript": "6"` in `package.json`) |
| `playwright` → `@playwright/test` | The actual test runner is `@playwright/test`. Browsers are installed via `aube exec playwright install chromium` (CI uses `--with-deps`) |
| Test-support dev deps (`fake-indexeddb` / `pngjs` / `@types/pngjs` / `@testing-library/jest-dom`, etc.) and Tailwind / Radix packages | Outside the originally recommended dependency list but required by the stack (e.g. PNG round-trip decoding with `pngjs`) |
| Additional shadcn components `checkbox` / `radio-group` / `collapsible` | Needed for strong confirmation, scan-target selection, and collapsible detail views |
| `Cache-Control: no-cache` added to `_headers` for `/sw.js`, `/registerSW.js`, and `/manifest.webmanifest` | Keeps the SW / manifest fresh. A managed addition to the deployment headers |
| Independent `e2e` job added to CI | `validate-and-deploy` is unchanged; e2e does not block deployment |
| `@zxing/library` added | For DOM-independent unit tests. `@zxing/browser` is used in the UI layer only |
| `VITE_ENABLE_ECDH` / `VITE_ENABLE_PRIVATE_KEY_EXPORT` reserved only | The env vars remain, but there are no UI or module branches |
| Supply-chain pins and overrides (`react-hook-form@7.82.0` / `eslint-config-prettier@10.1.8` / rollup OMT via `aube.overrides`) | Responses to advisories and a trust downgrade during initial setup. Full list: [docs/threat-model.md](docs/threat-model.md) §5.1 |
| Withdrawal of the originally planned in-app update notification | Maintainer decision: no in-app update mechanism; after installation, devices that hold or have held protected material run offline permanently. New versions require a full device format followed by a fresh offline installation |
| Withdrawal of the original keep-plaintext-after-encryption default | Maintainer decision: "auto-clear plaintext after encryption" is now default ON. Background auto-clear is also default ON, and the delay uses the fixed env value (300 seconds) |
| Withdrawal of normal online use (relay exception) | Maintainer decision: online encryption/decryption/key-management/storage/settings stay blocked. Fresh PWA installation remains the primary online purpose; a fail-closed clean-origin optical relay may forward exact canonical OCF2 strings whose untrusted outer header declares `pq-message` (threat model T19). On the offline→online transition, in-memory transient data is cleared immediately |
| ML-KEM-512 / ML-DSA-44 not implemented | Not supported, including for interoperability testing. The active policy covers only maximum (1024/87); balanced (768/65) exists as reserved types and suite codes only |
| balanced demoted, maximum mainlined | A deliberate, maintainer-approved deviation (2026-07-23) from the originally recommended initial suite range. Only maximum (1024/87) is operated; recognized balanced (768/65) input is rejected with `UNSUPPORTED_ALGORITHM` |
| `pq-kem-public-key` / `pq-dsa-public-key` added to `QrFrameV2.artifactType` | An extension beyond the three originally specified values (for single-public-key frames) |
| Error codes `RESET_FAILED`, `SIGNATURE_INVALID`, `SIGNING_KEY_NOT_FOUND`, `FRAME_MISMATCH`, `WORKER_UNAVAILABLE` added | `RESET_FAILED` was finalized from the provisional name `WIPE_FAILED` under the honest-naming policy for best-effort logical deletion. The others cover signature verification failure, missing signing key, frame mismatch, and Worker unavailability |
| RSA-OAEP hybrid removed; `VITE_ENABLE_RSA=false` | The RSA path removal is complete — a reversal of the RSA hybrid path in the initial specification |
| `VITE_DEFAULT_ALGORITHM=A256GCM` (default changed to symmetric AES-256-GCM) | Maintainer requirement, 2026-07-24. Post-quantum modes remain selectable |
| No in-app QR storage | Maintainer requirement, 2026-07-24. Both ciphertext and key QR codes are limited to on-screen display, PNG/SVG/ZIP export, and clipboard; the saved-QR feature and the `qrArtifacts` store are removed |

## License

Apache License 2.0 — see [LICENSE](LICENSE). The archival `design-system/` exports include MIT-licensed generator output; see [design-system/PROVENANCE.md](design-system/PROVENANCE.md).
