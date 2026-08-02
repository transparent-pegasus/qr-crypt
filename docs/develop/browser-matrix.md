# Browser Verification Matrix

This table maps the target browser environments to the primary verification items.

**On-device verification is manual work performed outside this repository.** The Playwright runs in CI (chromium / webkit) provide approximate coverage only and do not substitute for on-device PWA installation, camera access, OS-specific key persistence, and the like. The initial value of each cell is `automated (e2e)` (planned to be covered by in-repo e2e tests), `manual-pending` (manual verification on real devices), or `not yet measured` for a quantitative device gate.

| Verification item | Android Chrome | iOS Safari | Windows Chrome | macOS Safari | Edge |
| --- | --- | --- | --- | --- | --- |
| PWA installation | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Offline launch | automated (e2e) | manual-pending | automated (e2e) | manual-pending | manual-pending |
| Key generation | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| Encryption | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| QR display | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| QR scanning | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Camera decoder WebAssembly instantiation **while offline** (zxing-wasm reader, precached same-origin): compiled before any camera starts — both scan surfaces keep their scan control disabled until the reader is ready, the wait is bounded at that gate, and a failed preparation offers a page reload rather than an in-page retry | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| User-selected QR compatibility preferences: sustained full transfers with the shipped default (switch off, 1,000B / 200ms minimum dwell) and compatible preference (switch on, 100B / 2,000ms minimum dwell, per-artifact effective density clamped upward when required), including poor light and refocus recovery | not yet measured | not yet measured | not yet measured | not yet measured | not yet measured |
| QR range-extension telemetry: actual decode cadence/duration, long tasks, sustained CPU/thermal behaviour, teardown latency, sender v40 render time, and post-downscale decoder dimensions | not yet measured | not yet measured | not yet measured | not yet measured | not yet measured |
| Non-extractable CryptoKey persistence in IndexedDB (generate → close tab → restore → decrypt) | automated (e2e) | manual-pending | automated (e2e) | automated (e2e) | manual-pending |
| Online relay: Web Locks availability (`navigator.locks`) — the clean-origin proof is taken under an origin-wide exclusive lock, so a browser without it is denied relay eligibility outright | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: camera scan → text (getUserMedia start on explicit action only) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: single-frame OCF2 `sym-message` capture (one AES QR) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: text → QR playback (verbatim OCF2 frame re-display for `pq-message` or `sym-message` after assembled-artifact validation) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: reject non-message OCF2 outer types and bare `OC?2` / retired v1 prefixes | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: clipboard copy/paste (incl. CRLF intermediaries) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: session teardown on `pagehide` / BFCache restore (`pageshow` persisted) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: camera stop on close / background / eligibility loss | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |

## Notes

* **iOS Safari**: Camera QR scanning requires Safari/iOS 16 or newer because older WebKit
  cannot authorize WebAssembly under the narrow `wasm-unsafe-eval` CSP source. IndexedDB
  persistence of non-extractable `CryptoKey`s (generate → close tab → restore → decrypt)
  is a mandatory manual on-device item. Success on `fake-indexeddb` is not treated as a
  sufficient condition.
* **First-session camera decoder (added 2026-07-29)**: the router only mounts once the
  device is offline-confirmed, so the camera reader never gets an online *runtime* fetch —
  its first runtime load must be satisfied from the precache the service worker populated
  while installing online. That requires the worker to control the page *before* the
  device goes offline, which since 2026-07-29 is what `workbox.clientsClaim` and the
  install screen's **Offline-use readiness: Ready** row guarantee. The manual case to run
  on device is therefore: one online load, **no reload**, wait for readiness Ready, go
  offline, then open the camera for the first time. Ephemeral private sessions (observed
  on Brave iOS Private tabs, where the worker registration appears not to survive the
  session) make every session that first session, so run the case there too. Both stay
  `manual-pending` until verified on device.
* **Reader-before-camera (added 2026-07-29)**: the first compile of the ~1 MB reader is
  slow on a phone and used to run while a 1080p capture was starting, which is how an
  already-permitted iPhone still reported
  `module=timed-out frames=1 attempts=0`. Preparation now finishes before any capture
  begins, so the on-device case to check is that the scan control is briefly disabled on a
  cold page and then works on the first tap — not that it fails and recovers after a
  reload. `manual-pending`.
* **Offline launch / camera scanning**: partial automation via chromium e2e is planned. Real devices on Android / Windows, as well as Safari / Edge, are manual.
* **Online relay (camera / display / clipboard / BFCache)**: chromium e2e may cover synthetic paths; real-device rows above stay `manual-pending` until measured. Clipboard sync targets and OS QR capture are outside app control.
* **Edge**: manual on-device row. Screen-reader verification is also manual.
* **macOS Safari / iOS Safari**: the core items (launch, AES encryption/decryption, key persistence across reload) are expected to be automated via Playwright webkit. PWA installation, camera, and iOS-specific persistence remain manual-pending.

## v2 Post-Quantum On-Device Measurements (release gate)

On-device measurement sheet for the sole active post-quantum profile
(**maximum**: ML-KEM-1024 / ML-DSA-87). All release-gate measurements must be
taken on that profile (plus the single-frame symmetric path where listed).
Values are entered manually. Cells that have not been measured are explicitly
marked **not yet measured**.

**On-device measurements are a mandatory condition for `release-approved`.** Any measurement during which a timeout / crash / OOM / UI freeze occurs counts as a fail. `aube bench:pq` on Node is a reference value only and does not substitute for this table. The minimum release-gate targets are **Android Chrome** and **iOS Safari** (desktop results are recorded alongside).

Recorded fields (common to every environment): Device / OS / Browser version / Build hash (`VITE_BUILD_SHA` or equivalent).

Promotion beyond `dev` for the widened QR range is additionally conditional
on sustained full-transfer passes with both user-selected preferences on both
release-gate platforms. The preference pairs, clamp, and dwell semantics are
owned by [qr-protocol-v2.md](../spec/qr-protocol-v2.md) §6.

Each preference must include poor-light operation and recovery after focus is
lost and reacquired. Configured dwell is a minimum visible time, not a measured
cadence (§6). Record the actual full cycle separately from the configured dwell,
along with actual start-to-start decode cadence, p95 decode duration and long
tasks, sustained CPU and thermal behaviour, scanner teardown latency, version 40
QR render completion time on the sending device, and the exact post-downscale
`ImageData` dimensions seen by the decoder.

The decoder now caps the post-downscale camera frame at a 1,280-pixel long
edge. Source-camera resolution must not be substituted for the recorded
decoder dimensions: at the retired 960-pixel cap, a 1,920×1,080 source became
960×540, and a version 40 symbol occupying 80% of the short edge resolved to
only about 432/177 ≈ 2.44 pixels per module, below the practical floor of 3.
Decoder resolution, not camera resolution, determines pixels per module.

Every value cell in the QR range-extension tables is **not yet measured**.

### Android Chrome (release gate)

| Item | Value |
| --- | --- |
| Device | not yet measured |
| OS | not yet measured |
| Browser version | not yet measured |
| Build hash | not yet measured |
| keygen time | not yet measured |
| Encaps time | not yet measured |
| Decaps time | not yet measured |
| Signing time | not yet measured |
| Verification time | not yet measured |
| Seed re-expansion time | not yet measured |
| Peak memory | not yet measured |
| Worker load check after offline reload | not yet measured |

#### QR range-extension scanner/sender gate

| Measurement | Default preference (switch off): 1,000B / 200ms minimum dwell | Compatible preference (switch on): 100B / 2,000ms minimum dwell (per-artifact effective density clamped if required) |
| --- | --- | --- |
| Sustained full-transfer completion | not yet measured | not yet measured |
| Poor-light sustained transfer | not yet measured | not yet measured |
| Refocus recovery | not yet measured | not yet measured |
| Actual full-cycle time (render commit + dwell for every frame) | not yet measured | not yet measured |
| Actual start-to-start decode cadence | not yet measured | not yet measured |
| p95 decode duration | not yet measured | not yet measured |
| Long tasks | not yet measured | not yet measured |
| Sustained CPU behaviour | not yet measured | not yet measured |
| Sustained thermal behaviour | not yet measured | not yet measured |
| Scanner teardown latency | not yet measured | not yet measured |
| Sender-side version 40 render completion time | not yet measured | not yet measured |
| Post-downscale decoder `ImageData` dimensions | not yet measured | not yet measured |

### iOS Safari 16+ (release gate)

| Item | Value |
| --- | --- |
| Device | not yet measured |
| OS | not yet measured |
| Browser version | not yet measured |
| Build hash | not yet measured |
| keygen time | not yet measured |
| Encaps time | not yet measured |
| Decaps time | not yet measured |
| Signing time | not yet measured |
| Verification time | not yet measured |
| Seed re-expansion time | not yet measured |
| Peak memory | not yet measured |
| Worker load check after offline reload | not yet measured |

#### QR range-extension scanner/sender gate

| Measurement | Default preference (switch off): 1,000B / 200ms minimum dwell | Compatible preference (switch on): 100B / 2,000ms minimum dwell (per-artifact effective density clamped if required) |
| --- | --- | --- |
| Sustained full-transfer completion | not yet measured | not yet measured |
| Poor-light sustained transfer | not yet measured | not yet measured |
| Refocus recovery | not yet measured | not yet measured |
| Actual full-cycle time (render commit + dwell for every frame) | not yet measured | not yet measured |
| Actual start-to-start decode cadence | not yet measured | not yet measured |
| p95 decode duration | not yet measured | not yet measured |
| Long tasks | not yet measured | not yet measured |
| Sustained CPU behaviour | not yet measured | not yet measured |
| Sustained thermal behaviour | not yet measured | not yet measured |
| Scanner teardown latency | not yet measured | not yet measured |
| Sender-side version 40 render completion time | not yet measured | not yet measured |
| Post-downscale decoder `ImageData` dimensions | not yet measured | not yet measured |

### Desktop (reference, recorded alongside)

Windows Chrome / macOS Safari / Edge, etc. Not a mandatory release-gate target, but the same items are recorded.

| Item | Windows Chrome | macOS Safari | Edge |
| --- | --- | --- | --- |
| Device | not yet measured | not yet measured | not yet measured |
| OS | not yet measured | not yet measured | not yet measured |
| Browser version | not yet measured | not yet measured | not yet measured |
| Build hash | not yet measured | not yet measured | not yet measured |
| keygen time | not yet measured | not yet measured | not yet measured |
| Encaps time | not yet measured | not yet measured | not yet measured |
| Decaps time | not yet measured | not yet measured | not yet measured |
| Signing time | not yet measured | not yet measured | not yet measured |
| Verification time | not yet measured | not yet measured | not yet measured |
| Seed re-expansion time | not yet measured | not yet measured | not yet measured |
| Peak memory | not yet measured | not yet measured | not yet measured |
| QR frame render completion time | not yet measured | not yet measured | not yet measured |
| QR scan completion time | not yet measured | not yet measured | not yet measured |
| Worker load check after offline reload | not yet measured | not yet measured | not yet measured |

### Node reference bench (development machine, not a release gate)

Values from a single run of `aube bench:pq` on 2026-08-02 (Vitest 4.1.10, Linux x86_64,
Intel Core i7-10870H). `hz` is operations per second; mean is the average milliseconds per
operation.

| Operation | node hz | node mean (ms) | ui (jsdom) hz | ui (jsdom) mean (ms) |
| --- | ---: | ---: | ---: | ---: |
| ML-KEM-1024 keygen | 1,112.27 | 0.8991 | 1,101.78 | 0.9076 |
| ML-KEM-1024 encapsulate | 939.30 | 1.0646 | 901.83 | 1.1089 |
| ML-KEM-1024 decapsulate | 762.52 | 1.3114 | 695.69 | 1.4374 |
| ML-DSA-87 sign | 89.0465 | 11.2301 | 84.4185 | 11.8458 |
| ML-DSA-87 verify | 290.79 | 3.4389 | 268.44 | 3.7252 |

These are reference values from a development machine. They do not substitute for the
on-device measurements above, nor for the `release-approved` determination.
