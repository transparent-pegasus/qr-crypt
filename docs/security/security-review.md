# Security Review Record (v2 Post-Quantum)

This document is the **factual record** for the release completion condition
"independent security review of the adopted libraries". This document is the
authoritative definition of that gate; completion is judged in the following
two categories. The current operational review scope is the maximum mainline,
i.e. ML-KEM-1024 and ML-DSA-87 (unsigned and signed). The four `WireSuite`
values are retained as a wire/codec contract, but balanced (768/65) is outside
the active policy and is rejected at the operational boundary as
`UNSUPPORTED_ALGORITHM`.

- **implementation-complete**: The state in which the in-repository
  implementation, tests, and documentation are complete. It can be reached with
  all of the following in-repository conditions satisfied while this document
  still records "independent third-party audit: not performed".
  - The maximum identity, Worker, encryption, decryption, storage, and
    OCP2/OCS2/OCF2 paths pass composition/integration/UI tests.
  - `tests/pq/maximum-policy-boundaries.test.ts`, the Worker integration tests,
    and the import negative tests reject the balanced/768 family with
    `UNSUPPORTED_ALGORITHM` before any cryptographic processing.
  - The settings negative/migration tests reject update injection of legacy
    algorithms and of balanced; legacy preferences are normalized on read to
    maximum while preserving `wipeOnOnline=false`.
  - `tests/pq/maximum-artifact-size.golden.test.ts` pins the canonical CBOR raw
    byte counts in the table below, the OCF2 frame counts across the internal
    100–1,000B chunk set, both exact display preference pairs and the
    per-artifact effective density clamps, real EC-Q generation for every
    displayable frame, the 1,529-character
    worst-metadata payload at the 1,000B ceiling, and boundary agreement with
    the env capacity guard.
  - The ML-KEM-1024 / ML-DSA-87 KATs and `aube run test` /
    `aube run typecheck` pass, and the `aube run bench:pq` maximum reference
    figures plus the README and
    protocol documents are updated.
- **release-approved**: Not reached until an independent third-party review of
  the selected versions and the whole application is recorded
  (**external blocker**). Until then, the UI, README, and CI consistently
  display experimental / not independently audited.

Self-investigation and self-authored documents (including this one) are no
substitute for independent review and do not close the blocker.

Measured maximum fixture (`maxPlaintext=120,000B`, `name="テスト"` — the literal
fixture string):

| artifact | canonical CBOR (bytes) | compatible-preference frames | default-preference frames |
|---|---:|---:|---:|
| unsigned empty / max | 1,887 / 121,894 | 19 / 122* | 2 / 122 |
| signed empty / max | 6,613 / 126,619 | 67 / 127* | 7 / 127 |
| OCI2 bundle | 4,402 | 45 | 5 |
| OCP2 KEM / OCS2 DSA | 1,733 / 2,755 | 18 / 28 | 2 / 3 |
| OCB2 reserved sizing fixture | 4,637 | 47 | 5 |

Plaintext ceilings are algorithm-specific. Both post-quantum paths accept at
most 120,000 UTF-8 bytes. The single-QR A256GCM path derives its smaller
pre-encryption ceiling from the v1 8,192-character payload ceiling and the
selected version 40 error-correction capacity: L 2,010B, M 1,543B, Q 1,042B,
or H 750B.

The single labelled compatibility switch selects an atomic preference pair.
Off is the shipped default, 1,000B with a 200ms minimum dwell; on is the
user-selected compatible preference, 100B with a 2,000ms minimum dwell. `*`
marks maximum fixtures whose per-artifact effective density is clamped to
1,000B so the artifact fits within 128 frames. That effective value is never
persisted. If the clamp is already 1,000B, the switch still changes only the
dwell from 200ms to 2,000ms. The clamp uses the 100B generated-density grid
and fails closed as `QR_TOO_LARGE` if the required value exceeds 1,000B.

The automatic reader-based selector was removed because the displaying device
cannot know whether the peer camera can read its screen. It had also shipped
an always-compatible bug: its usability predicate required reader-module
state to reach `usable`, which happened only after camera preparation
resolved, so the display path never observed that state.

The receiver allocation ceiling now equals the complete wire budget:
`MAX_ARTIFACT_BYTES_ABSOLUTE =
PROTOCOL_MAX_FRAMES × FRAME_CHUNK_MAX_BYTES = 128,000B`. With worst-case
metadata across every artifact type, a 1,000B chunk produces a
1,529-character OCF2 payload against the 1,663-character EC-Q version 40
capacity.

The frame cursor advances only after the exact rendered code has committed,
then waits the configured dwell. A maximum signed message has 127 frames, so
its dwell-only floor is 25.4 seconds with the default preference and 254
seconds with the compatible preference. The protocol-wide conservative budget
is 128 × 2,000ms = 256 seconds, which makes
`TRANSFER_TIMEOUT_MINUTES_MIN` 5 minutes; the assembly timeout default remains
10 minutes. These are not measured cycle times: actual cycles also include
every frame's render latency and must be measured separately.

**Long-text export, measured 2026-07-26** on the CI-class Linux desktop
(mobile-chromium Playwright project, `aube run test:e2e`), 120,000-byte signed
PQ fixture:

| step | measurement |
| --- | --- |
| encryption | 141 ms |
| split into frames | 247 ms |
| first frame render | 31 ms |
| complete 127-frame ZIP export | 7,085 ms |
| archive size | 9,633,007 B (≈9.6 MB) |
| artifact / frames | 126,619 B / 127 frames at 1,000B |

These are desktop numbers. **On-device figures for Android Chrome and iOS Safari
are not yet measured** — see `docs/develop/browser-matrix.md`. The ZIP path renders
frames serially, so its peak memory is bounded by roughly one 1024px raster
rather than by 127 of them, but its ~7s wall clock on desktop implies a
materially longer wait on a phone.

Boot readability remains append-only: density accepts every safe integer from
100 through 1,000B and interval accepts every safe integer from 150 through
3,000ms. The internal admitted sets are 100, 200, …, 1,000B and 200, 300, …,
1,000ms plus 2,000ms. The exact default and compatible pairs survive reads;
every other boot-readable historical combination, including a missing member,
is canonicalized to the default 1,000B/200ms pair before strict validation.
The append-only ranges and historical per-field normalizers remain, so no
stored preference can become unreadable and force a wipe. New preference
patches must provide one exact pair, while per-artifact effective clamps are
never persisted.

Visible dismissal is also an explicit UI contract. Ordinary modal and
fullscreen views put one close control at bottom right in normal flow, after
the content. Alert dialogs retain Cancel as their single dismissal and do not
gain an ×. The fingerprint confirmation is the documented exception: it has
no close control, blocks Escape and outside dismissal, and requires one of its
explicit save decisions because the security confirmation must not be
dismissible.

## 1. Facts About the Adopted Libraries (as of 2026-07-29)

### @noble/post-quantum 0.6.1 (exact pin; version ranges forbidden)

- Released: 2026-04-12. npm provenance ✓ (all nearby versions attested). **Re-verified 2026-07-29: 0.6.1 is the latest; no advisories in the repo / GHSA / OSV**
- Dependencies: noble family only (@noble/ciphers / @noble/curves / @noble/hashes ~2.2.0)
- Implements: FIPS 203 (ML-KEM) / FIPS 204 (ML-DSA) algorithms
- FIPS errata (§3 step 1, checked 2026-07-29): NIST lists prospective corrections only (FIPS 204 sheet updated 2026-02-27). No impact on the API or the size table
- **Not independently audited.** The audit status as of 0.6.1 is self-audit only (scope: everything)
- **Side channels: as a JS implementation, constant-time execution is not guaranteed.** In particular, for the ML-KEM decaps implicit-rejection path, constant-time behavior under JS/JIT is explicitly documented and not guaranteed
- APIs used by the active policy (verified against the actual 0.6.1 source):
  `ml_kem1024.keygen(seed64?)` / `.encapsulate(pk)` / `.decapsulate(ct, sk)`,
  `ml_dsa87.keygen(seed32?)` / `.sign(msg, sk, {context})` /
  `.verify(sig, msg, pk, {context})`. The library also contains 768/65
  implementations, but the active policy does not use them for cryptographic
  processing

### zxing-wasm 3.1.2 (exact pin; camera QR reading, reader-only build)

- Replaces `@zxing/browser` (removed). `@zxing/library` remains a **devDependency**
  only, used by unit and Playwright helpers to decode generated PNG pixels; it is not
  in the shipped bundle
- npm provenance ✓. Upstream is ZXing-C++ compiled to WebAssembly via Emscripten;
  the packaged reader binary is built from zxing-cpp commit
  `179be6ac9c1b2a75ff0017a237c6546fea3c7d12`
- Shipped artifact: `zxing-wasm/reader/zxing_reader.wasm`, 1,065,866 bytes,
  SHA-256 `0e8d688d71932ebb6b8b33f700d43d3cb997f59ed9cab3c05102d7f10288a392`
  (recomputed from `node_modules` on 2026-07-26). Vite emits it as a hashed
  same-origin asset and Workbox precaches it; the library's default CDN fetch is
  overridden by a module-scope `locateFile`. **No CDN, no runtime network request**
- Release evidence now includes an archive-internal `SHA256SUMS.files` covering
  every other ZIP member, fixed clean-checkout rebuild-and-compare instructions,
  and a CI gate that compares two production builds' sorted file sets and
  per-file hashes in one runner
- **The published binary still has not been independently reproduced from
  source.** The CI gate establishes same-environment determinism only;
  environment-independent reproducibility remains unverified. Cosign attests
  provenance (which workflow built from which commit), not source-to-binary
  correspondence. An attacker controlling the CI environment can still publish
  a correctly signed backdoor, which only an independent rebuild comparison can
  detect. Trust also continues to include the lockfile pin, npm provenance
  attestation, and recorded zxing-wasm SHA-256 rather than a zxing-wasm
  from-source rebuild
- **Not independently audited**; no advisories at the pinned version as of 2026-07-29
- Consequence for CSP: `WebAssembly.instantiate` is refused under a bare
  `script-src 'self'`, so `public/_headers` now ships
  `script-src 'self' 'wasm-unsafe-eval'`. That grants origin-wide permission to
  compile arbitrary WebAssembly for any script that already executes. It is
  materially narrower than `'unsafe-eval'`, which is **not** enabled and which would
  additionally permit JavaScript string evaluation
- Attacker-controlled camera pixels now reach a C++/Emscripten parser. See
  `docs/security/threat-model.md` T5 for the resulting denial-of-service residual
- Phone-side cost (decode latency, peak memory, long tasks, teardown responsiveness)
  is **not yet measured**; see `docs/develop/browser-matrix.md`

### Supply Chain

- Locked in `aube-lock.yaml` (must be committed). For the v1-era supply-chain
  decisions and the 2026-07-24 re-verification, see `docs/security/threat-model.md` §5.1
- ZIP output is an in-house store-only implementation with no added dependency (`fflate` was rejected for lacking provenance)
- **RESOLVED (dev chain, re-verified 2026-07-29)**: `sharp` — `GHSA-f88m-g3jw-g9cj`
  (CVE-2026-33327 / CVE-2026-33328 / CVE-2026-35590 / CVE-2026-35591,
  GHSA published 2026-07-21; affected versions below 0.35.0). Former path:
  `wrangler@4.113.0` → `miniflare@4.20260721.0` → `sharp@0.34.5` exact-pin.
  Fixed by bumping wrangler to 4.114.0 (`miniflare@4.20260722.0` →
  `sharp@0.35.2`).
- **RESOLVED (runtime dep, 2026-07-25)**: `react-router` —
  `GHSA-qwww-vcr4-c8h2` (published 2026-07-24, high): RSC Mode CSRF bypass;
  vulnerable `>=7.12.0 <8.3.0`. The vulnerable path (React Server Components
  mode with server-executed actions) was never used by this client-only PWA,
  and the dependency was upgraded to `react-router@8.3.0` exact (the
  `react-router-dom` wrapper, which ends at 7.x, was replaced by
  `react-router` directly).
- **RESOLVED (dev chain, 2026-07-25)**: `brace-expansion` —
  `GHSA-mh99-v99m-4gvg` (high): DoS via unbounded expansion; vulnerable
  `<=5.0.7`. Paths: `workbox-build` → `glob` → `minimatch` →
  `brace-expansion@5.0.7` and `workbox-build` → … → `minimatch@5` →
  `brace-expansion@2.1.2` (build tooling only; inputs are repo-controlled glob
  patterns). No fixed 2.x release exists, so both major lines are forced to
  `5.0.8` via `aube.overrides`; `aube run build:prod` and the full test suite were
  re-verified after the override. `aube audit` currently exits 0.
- Supply-chain pins re-verified clean on 2026-07-29: `react-hook-form@7.82.0`, `eslint-config-prettier@10.1.8`

## 1.1 Findings F-01 / F-02 / F-03 (2026-07-28)

Self-review findings closed or deferred on branch `feat/receipt-and-key-id-guard`.
They do not close the external `release-approved` blocker.

### F-01 — Route A install procedure completeness

- **Found:** the README carried a partial Route A procedure while the archive's
  `INSTALL.txt` was the only self-contained copy that reaches the offline device;
  mandatory independent rebuild-and-compare was easy to understate.
- **Shipped:** `docs/develop/install-route-a/README.md` holds the complete Route A
  procedure, including pre-extraction container validation and an independent
  comparison that accounts for every archive member; both READMEs keep a summary
  plus a link. High-assurance use must use Route A only.
- **Open — `INSTALL.txt` source derivation:** the release workflow still generates
  `INSTALL.txt` from an inline heredoc rather than from versioned source. An
  independent verifier therefore cannot byte-reproduce that member today. Until
  the release pipeline derives it from a versioned template, its instructions
  must be compared against the independently authenticated
  `docs/develop/install-route-a/README.md`, with any added, omitted, or changed
  requirement treated as tampering. Moving the generator into versioned source
  is outside this branch.

### F-02 — Replayed / re-presented ciphertext

- **Found:** a recipient had no in-app signal that the same ciphertext had already
  been accepted, and nothing refused a reused authenticated message ID carrying
  different ciphertext.
- **Shipped:** decryption returns the authenticated `messageId` and `createdAt`.
  `src/features/receipt-cache.ts` keeps one module-local receipt map in each
  loaded app window's JavaScript realm (bounded at `MAX_SESSION_RECEIPTS`,
  oldest-first eviction). A matching ciphertext hash is flagged behind an
  explicit reveal; an authenticated message ID seen with different ciphertext
  is refused as `MESSAGE_ID_REUSED`. The map is not shared with other tabs or
  windows. Reload/restart resets it; `clearReceipts` also runs from the wipe
  coordinator's buffer-drop step and the boot controller's transient-clear path.
  Nothing frame-derived is persisted: the §1 / T11 / T19 / clean-origin boot-gate
  invariant is unchanged. Unsigned PQ receipt identity is recipient KEM key ID
  plus authenticated `messageId`, with ciphertext hash compared for the verdict.
  Only v1 AES lacks a message ID and uses recipient key ID plus ciphertext hash as
  its identity. Neither case authenticates a sender; `createdAt` remains
  sender-asserted.
- **Deferred / open security-design decision — persistent cross-session replay
  detection:** implementing it requires relaxing the no-frame-derived-persistence
  invariant, device-keyed opaque tags instead of a public ciphertext hash,
  `receivedMessages` ownership in `readBootDecision`
  (`src/app/boot/boot-controller.ts`), and matching changes to
  `docs/spec/boot-and-reset-v2.md` (§2 sensitive-store scan, ~48–57). Not
  implemented here.
- **Also deferred:** conversation IDs, monotonic sequence numbers, hash chains,
  and adding a message ID to the AES v1 format (all wire-format changes).

### F-03 — Imported-bundle key-ID shadowing

- **Found:** an attacker-supplied public bundle asserting a stored `signing.keyId`
  could displace the legitimate record because resolution took the newest import;
  a confirmed record could be shadowed by a later unverified import.
- **Shipped:** unique indexes on `signing.keyId` and `kem.keyId`; `saveBundle`
  refuses a re-import with equal KEM/signing algorithms and equal public-key bytes
  with `DUPLICATE_KEY`, and refuses any other key-ID collision with
  `KEY_ID_CONFLICT` (including partial collisions). If either indexed match is
  revoked, every re-import reports `KEY_ID_CONFLICT`, including equal key
  material; the error explains that a disabled bundle may hold the reservation.
  Signing-key resolution is an exact index lookup that treats revoked as unknown;
  the decrypt page resolves the sender from storage and separates signature
  validity from identity (success colour only when `fingerprint-confirmed`;
  unverified sender gets a destructive identity alert above the plaintext).
  Revoke confirmation copy states that disabling hides the row, permanently
  reserves both signing and KEM key IDs in this installation, cannot be undone or
  deleted from the key screen afterwards, and can be cleared only by a full local
  wipe. Deletion frees the IDs only when chosen before disabling.
- **Deferred:** hiding an unverified signer's plaintext behind an explicit action,
  and binding the sender public key into the signing target.

## 2. Prohibited Claims (UI / README / CI)

None of the following may be used in UI, README, or CI displays.

- "FIPS certified" (implementing FIPS 203/204 algorithms is distinct from FIPS 140 certification)
- "completely secure" (a safety declaration without independent audit)
- "secure erase" / "complete deletion" (see docs/spec/boot-and-reset-v2.md)

The security screen must state explicitly:
noble is not independently audited; JS side-channel resistance is not
guaranteed; JS memory erasure has limits
(zeroize is incomplete due to GC, internal copies, and optimizations).

## 3. Per-Release Verification Checklist

1. Check the latest FIPS 203 / FIPS 204 errata (on the relevant NIST CSRC pages)
2. Check the `@noble/post-quantum` changelog, known vulnerabilities, and advisories
3. Confirm the KATs (`aube run test:pq-vectors`) are all green
4. Confirm the bundle makes no external network references **and** that
   same-origin traffic stays on the no-payload allowlist. Same-origin alone
   is not sufficient: a regression that POSTed relay text to this origin
   would still be same-origin. e2e (`tests/e2e/security.spec.ts` and
   `tests/e2e/online-relay.spec.ts`) must assert:
   - **Allowlist (methods, paths, and query keys):** static/PWA resources;
     recurring `HEAD /manifest.webmanifest?reach=…` (display probe); boot
     `GET /reachability-sentinel.txt?n=…` (destructive probe). No other
     runtime requests. Every allowed request must carry no query key beyond
     the two named above — checking method and path alone would let an allowed
     static GET carry a payload field in its query.
   - **Negative matrix after capture / copy / paste / playback / rejection /
     close / `pagehide` / timeout:** a unique relay payload marker and a
     marker from each sender-controlled OCM1 field plus the refused OCK1 key
     bytes are absent from request URLs including query names and values,
     request header names and values, request bodies, every IndexedDB
     database's schema names — database, object-store and index names and key
     paths — as well as its keys/values, CacheStorage metadata/bodies (static
     shell permitted), localStorage (only `{oc-theme, oc-lang,
     oc-offline-ack-pending, oc-online-tab}`), console, `window.onerror` /
     unhandled rejections, visible error text, `document.title`,
     `location.href`, and history state. **One marker set covers every sink**;
     a request oracle that searches fewer markers than the storage oracle is
     the hole this line exists to close. The byte-aware storage oracle's
     self-test plants both a typed-array value marker and a marker that appears
     only in an object-store name, and requires exactly those two matches.
   - **Window-realm receipts must never appear in IndexedDB, localStorage, or
     CacheStorage.** Receipts are intentional module-memory residue in one loaded
     app window only (`src/features/receipt-cache.ts`), not shared with other tabs
     or windows. Reload, transient clear, wipe, or oldest-first bounded eviction
     removes detection coverage. A change that persists them fails this gate: it
     would store a frame- or OCM1-derived value, break the clean-origin boot
     gate's "no frame- or OCM1-derived residue" premise, and contradict
     `docs/security/threat-model.md` §1 / T11 / T19.
   - Errors use fixed i18n / `AppError` mappings — never interpolate raw
     input, frame metadata, `transferId`, hashes, or `caught.message`.
5. Review the `aube-lock.yaml` diff (provenance maintained)

## 4. Items to Record Here When the Independent Review Completes (Template)

- Reviewing party (basis of independence) / review period
- Target commit hash, build hash, `@noble/post-quantum` version, and transitive lock
- Scope (the maximum-mainline libraries, the protocol design in
  docs/spec/qr-protocol-v2.md, the application implementation, and the retained
  4-suite wire/codec contract)
- List of findings, fix commits, and re-verification results
- FIPS errata check result

**Current status: none of the above is recorded (no independent third-party audit has been performed). release-approved has NOT been reached.**
