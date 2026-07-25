# Browser Verification Matrix

This table maps the target browser environments to the primary verification items.

**On-device verification is manual work performed outside this repository.** The Playwright runs in CI (chromium / webkit) provide approximate coverage only and do not substitute for on-device PWA installation, camera access, OS-specific key persistence, and the like. The initial value of each cell is either `automated (e2e)` (planned to be covered by in-repo e2e tests) or `manual-pending` (manual verification on real devices).

| Verification item | Android Chrome | iOS Safari | Windows Chrome | macOS Safari | Edge |
| --- | --- | --- | --- | --- | --- |
| PWA installation | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Offline launch | automated (e2e) | manual-pending | automated (e2e) | manual-pending | manual-pending |
| Key generation | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| Encryption | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| QR display | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| QR scanning | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Camera decoder WebAssembly instantiation on first use **while offline** (zxing-wasm reader, precached same-origin) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Camera decode latency at 100B and 200B frame densities | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Camera decode peak memory and long-task behaviour (p95 decode below a 50ms long task) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Scanner teardown responsiveness with a decode in flight (close / background / wipe) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Non-extractable CryptoKey persistence in IndexedDB (generate → close tab → restore → decrypt) | automated (e2e) | manual-pending | automated (e2e) | automated (e2e) | manual-pending |
| Online relay: camera scan → text (getUserMedia start on explicit action only) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: text → QR playback (verbatim OCF2 re-display) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: clipboard copy/paste (incl. CRLF intermediaries) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: session teardown on `pagehide` / BFCache restore (`pageshow` persisted) | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| Online relay: camera stop on close / background / eligibility loss | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |

## Notes

* **iOS Safari**: IndexedDB persistence of non-extractable `CryptoKey`s (generate → close tab → restore → decrypt) is a mandatory manual on-device item. Success on `fake-indexeddb` is not treated as a sufficient condition.
* **Offline launch / camera scanning**: partial automation via chromium e2e is planned. Real devices on Android / Windows, as well as Safari / Edge, are manual.
* **Online relay (camera / display / clipboard / BFCache)**: chromium e2e may cover synthetic paths; real-device rows above stay `manual-pending` until measured. Clipboard sync targets and OS QR capture are outside app control.
* **Edge**: manual on-device row. Screen-reader verification is also manual.
* **macOS Safari / iOS Safari**: the core items (launch, AES encryption/decryption, key persistence across reload) are expected to be automated via Playwright webkit. PWA installation, camera, and iOS-specific persistence remain manual-pending.

## v2 Post-Quantum On-Device Measurements (release gate)

On-device measurement sheet. This sheet was originally drawn up for the balanced profile (ML-KEM-768 / ML-DSA-65); the active policy is now the **maximum** profile (ML-KEM-1024 / ML-DSA-87), and all release-gate measurements must be taken on the maximum profile. Values are entered manually. Cells that have not been measured are explicitly marked **not yet measured**.

**On-device measurements are a mandatory condition for `release-approved`.** Any measurement during which a timeout / crash / OOM / UI freeze occurs counts as a fail. `aube bench:pq` on Node is a reference value only and does not substitute for this table. The minimum release-gate targets are **Android Chrome** and **iOS Safari** (desktop results are recorded alongside).

Recorded fields (common to every environment): Device / OS / Browser version / Build hash (`VITE_BUILD_SHA` or equivalent).

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
| QR frame render completion time | not yet measured |
| QR scan completion time | not yet measured |
| Worker load check after offline reload | not yet measured |

### iOS Safari (release gate)

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
| QR frame render completion time | not yet measured |
| QR scan completion time | not yet measured |
| Worker load check after offline reload | not yet measured |

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
