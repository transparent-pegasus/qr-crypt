# Security Review Record (v2 Post-Quantum)

This document is the **factual record** for the release completion condition
"independent security review of the adopted libraries". Completion is judged in
the following two categories. The current operational review scope is the
single active post-quantum suite `ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM`
(signing mandatory) plus the symmetric suite `HKDF-SHA256+A256GCM`
(`sym-message` / `symmetric-key`). Removed vocabulary (unsigned suites,
ML-KEM-768 / ML-DSA-65 / `balanced`, v1 prefixes, RSA) is absent from active
domain unions, writes, and cryptographic and wire dispatch — there is no
retained four-suite wire/codec contract. Boot alone keeps a read-only
`RSA-HYBRID` preference exception so an old stored value cannot make
`wipeOnOnline=false` unreadable; repository normalization replaces it with
`A256GCM`, and no RSA operation remains.

- **implementation-complete**: The state in which the in-repository
  implementation, tests, and documentation are complete. It can be reached with
  all of the following in-repository conditions satisfied while this document
  still records "independent third-party audit: not performed".
  - The maximum identity, Worker, encryption, decryption, storage,
    OCI2/OCF2, and OCA2/OCK2 paths pass composition/integration/UI tests.
  - Negative tests reject removed vocabulary (v1 prefixes, the retired single-key
    `OCP2` / `OCS2` prefixes, unsigned suite strings, 768/65, `balanced`) before
    any cryptographic processing.
  - Boot can read the retired `RSA-HYBRID` algorithm solely to preserve an old
    `wipeOnOnline=false`, after which the repository returns the active
    `A256GCM` default. Removed `defaultPqProfile` and `requireSignature` fields
    are ignored and omitted rather than restored.
  - `tests/pq/maximum-artifact-size.golden.test.ts` pins the canonical CBOR raw
    byte counts in the table below, the OCF2 frame counts across the internal
    100–1,000B chunk set, both exact display preference pairs and the
    per-artifact effective density clamps, real EC-Q generation for every
    displayable frame, the 1,529-character
    worst-metadata payload at the 1,000B ceiling, and boundary agreement with
    the env capacity guard. `tests/pq/sym-envelope.golden.test.ts` pins the
    sym-message overhead (131 B) and plaintext ceiling (853 B).
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
| signed empty / max | 6,570 / 126,576 | 66 / 127* | 7 / 127 |
| OCI2 bundle | 4,402 | 45 | 5 |
| OCB2 reserved sizing fixture | 4,637 | 47 | 5 |
| sym-message at plaintext ceiling | 1,000 (exactly one frame) | 1 | 1 |

Plaintext ceilings are algorithm-specific; owners live in `src/lib/limits.ts`
and the suite size tables beside them. The post-quantum path accepts at most
120,000 UTF-8 bytes. The single-frame symmetric path
(`sym-message` / `OCA2`) is capped at `MAX_SYM_PLAINTEXT_BYTES` = 853
(`FRAME_CHUNK_MAX_BYTES` − `SYM_MESSAGE_OVERHEAD_BYTES` − `AES_GCM_TAG_BYTES`).

Verified 2026-07-30: the labelled compatibility-switch contract (exact pairs,
atomic write, per-artifact clamp, dwell-not-cadence) matches
[qr-protocol-v2.md](../spec/qr-protocol-v2.md) §6. The automatic reader-based
selector was removed; that same section owns the display contract.

Receiver allocation ceiling, 1,529-vs-1,663 frame fit, and related wire budgets:
[qr-protocol-v2.md](../spec/qr-protocol-v2.md) §6.

Verified 2026-07-30: assembly timeout floor and default match
[qr-protocol-v2.md](../spec/qr-protocol-v2.md) §6 (dwell-only floors are not
measured cycle times).

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
| artifact / frames | 126,576 B / 127 frames at 1,000B |

The artifact byte count is corrected to the current fixture; the timings and
archive size above were not re-measured.

These are desktop numbers. **On-device figures for Android Chrome and iOS Safari
are not yet measured** — see `docs/develop/browser-matrix.md`. The ZIP path renders
frames serially, so its peak memory is bounded by roughly one 1024px raster
rather than by 127 of them, but its ~7s wall clock on desktop implies a
materially longer wait on a phone.

Numeric generated-display boot readability is append-only; non-exact
historical pairs canonicalize to the default 1,000B/200ms pair before strict
validation. The read-only `RSA-HYBRID` boot exception independently protects
the stored wipe flag and normalizes to `A256GCM`. Detail:
[boot-and-reset-v2.md](../spec/boot-and-reset-v2.md) §2.

Visible dismissal follows [threat-model.md](threat-model.md) (fingerprint
confirmation is the documented non-dismissible exception).

## 1. Facts About the Adopted Libraries (as of 2026-08-02)

### @noble/post-quantum 0.6.1 (exact pin; version ranges forbidden)

- Released: 2026-04-12. npm provenance ✓ (all nearby versions attested). **Re-verified 2026-08-02: 0.6.1 is the latest; no advisories in the repo / GHSA / OSV**
- Dependencies: noble family only (@noble/ciphers / @noble/curves / @noble/hashes ~2.2.0)
- Implements: FIPS 203 (ML-KEM) / FIPS 204 (ML-DSA) algorithms
- FIPS errata (§3 step 1, checked 2026-08-02): the current NIST FIPS 203
  and FIPS 204 workbooks list prospective corrections that introduce no new
  technical requirements (the FIPS 204 workbook was updated 2026-07-31). None
  affects the active API or size table
- **Not independently audited.** The audit status as of 0.6.1 is self-audit only (scope: everything)
- **Side channels: as a JS implementation, constant-time execution is not guaranteed.** In particular, for the ML-KEM decaps implicit-rejection path, constant-time behavior under JS/JIT is explicitly documented and not guaranteed
- APIs used by the active policy (verified against the actual 0.6.1 source):
  `ml_kem1024.keygen(seed64?)` / `.encapsulate(pk)` / `.decapsulate(ct, sk)`,
  `ml_dsa87.keygen(seed32?)` / `.sign(msg, sk, {context})` /
  `.verify(sig, msg, pk, {context})`. The library may also ship 768/65
  entry points; the application never calls them after the single-active
  vocabulary purge

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
- **Not independently audited**; no advisories at the pinned version as of 2026-08-02
- Consequence for CSP: live `script-src` / `'wasm-unsafe-eval'` facts are owned
  by [threat-model.md](threat-model.md) §2
- Attacker-controlled camera pixels now reach a C++/Emscripten parser. See
  `docs/security/threat-model.md` T5 for the resulting denial-of-service residual
- Phone-side cost (decode latency, peak memory, long tasks, teardown responsiveness)
  is **not yet measured**; see `docs/develop/browser-matrix.md`

### Supply Chain

- Locked in `aube-lock.yaml` (must be committed). For the v1-era supply-chain
  decisions and the current re-check table, see `docs/security/threat-model.md` §5.1
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
- Supply-chain pins re-verified clean on 2026-07-29: `eslint-config-prettier@10.1.8` and the rollup OMT `aube.overrides` entry. `react-hook-form@7.82.0` was also pinned here until 2026-07-30, when it was removed from the dependency graph entirely: it was never imported by the application, so the pin guarded nothing.

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
- **Closed 2026-08-03 — `INSTALL.txt` source derivation:** the release workflow
  no longer inlines that text. `docs/develop/install-route-a/INSTALL.template.txt`
  is the single versioned copy, rendered by `scripts/generate-install-txt.mjs`,
  whose only caller-supplied input is the independently authenticated source
  commit; the release version comes from `package.json` and the Cosign version
  from the release workflow, both inside the authenticated checkout, so no value
  from the archive under inspection feeds back into the comparison. Route A §5
  step 4 is now a byte comparison instead of an instruction-level reading, and
  the whole archive — payload, `INSTALL.txt`, and the regenerated manifest — is
  byte-compared. The archive copy carries the same operational contract as this
  repository's document: pre-extraction container validation before anything is
  written to disk, and the manifest reconstruction plus full-root comparison.
  A `.gitattributes` LF pin keeps two clean checkouts of one commit rendering
  identical bytes, so the mandatory diff cannot fail on an honest release.
  Contract pinned by `tests/unit/generate-install-txt.test.ts`.
  This narrows F-01 only; source-to-binary correspondence still depends on the
  independent rebuild being performed (§1, zxing-wasm entry).

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
  Nothing frame- or assembled-artifact-derived is persisted: the §1 / T11 / T19 /
  clean-origin boot-gate invariant is unchanged. Receipt identity and verdict
  rules: [threat-model.md](threat-model.md) §5.
- **Deferred / open security-design decision — persistent cross-session replay
  detection:** implementing it requires relaxing the
  no-frame-or-artifact-derived-persistence invariant, device-keyed opaque tags
  instead of a public ciphertext hash, `receivedMessages` ownership in
  `readBootDecision` (`src/app/boot/boot-controller.ts`), and matching changes
  to `docs/spec/boot-and-reset-v2.md` (§2 sensitive-store scan, ~48–57). Not
  implemented here.
- **Also deferred:** conversation IDs, monotonic sequence numbers, hash chains,
  and adding an inner message ID to `sym-message` (all wire-format changes).

### F-03 — Imported-bundle key-ID shadowing

Closed under unique indexes and `KEY_ID_CONFLICT` / `DUPLICATE_KEY` refusal; see
[threat-model.md](threat-model.md) T22. **Deferred:** hiding an unverified
signer's plaintext behind an explicit action, and binding the sender public key
into the signing target.

## 1.2 Findings NSR-01 / NSR-02 / NSR-04 (2026-08-03)

Two advanced-adversary reviews of the same tree, one in-repository and one
external, reconciled against the code before anything was implemented. They do
not close the external `release-approved` blocker, and neither review was
independent of this repository in the sense §4 requires.

Two claims in the external review were **not** reproducible and were rejected
rather than acted on: it cited a production revision that does not exist in this
repository, and it stated that the symmetric encrypt path already re-resolved
its key from storage at action time, which contradicted both the code and the
T14 residual as they stood at the time.

### NSR-01 — Stale key lifecycle state at encryption

- **Found:** the post-quantum branch took whole recipient and sender objects
  from the encryption page's cached list, so `encryptPq`'s revocation, trust,
  and status checks ran against a snapshot. A bundle revoked, or an identity
  rotated or deleted, in another tab after selection stayed invisible, and one
  further message could be encrypted to it.
- **Shipped:** the request carries ids on both branches and `encryptMessage`
  resolves them, so those rejections apply to what storage holds at press time.
  Pinned by the stale-record tests in `tests/ui/encrypt-page.test.tsx`.
- **Residual, unchanged:** a lifecycle write landing between that lookup and the
  cipher call. See [threat-model.md](threat-model.md) T14.

### NSR-02 — Version-tag action references in secret-bearing workflows

- **Found:** `github-release.yml` pinned every external action to a commit while
  the CI and promotion workflows used major-version tags — including the job
  that hands the Cloudflare API token, account id, and workflow token to
  `wrangler-action`.
- **Shipped:** every external `uses:` in every workflow is a full commit,
  checkouts no longer persist credentials, and
  `tests/unit/workflow-action-pins.test.ts` fails the suite on a new unpinned
  action. `mise-action` reuses the commit `github-release.yml` already pins.
- **Residual:** pinning stops silent tag movement. It does not secure a
  compromised runner, the GitHub control plane, or a malicious pinned revision.

### NSR-04 — Relay cleanliness going stale during a session

- **Found:** the clean-origin proof held its exclusive lock only while it ran,
  so a key written in another tab after publication left the origin relaying
  while it was no longer clean — the residual race T19 recorded.
- **Shipped:** a relay session holds the same lock for its lifetime
  (`acquireRelayLease`, released in the relay's single teardown path); a writer
  already inside the lock denies the session rather than queueing behind it.
  Proved from a second browser context in `tests/e2e/online-relay.spec.ts`,
  including a teardown that never touches the UI.
- **Residual:** write paths that take no lock at all — imported public bundles,
  deletes, renames, usage stamps — are outside the lease. None is counted by the
  clean-origin proof.

### Recorded, not implemented

- Independent third-party audit, independent reproduction of the release from
  source, and an authenticated rebuild toolchain remain the open external
  blockers (§1, §4). No repository change closes them.
- The T21 covert-egress floor (277 bits in the smallest legitimate symmetric
  transfer) is an architectural residual; reducing it further is a wire-format
  change and was not attempted here.
- The widened-QR promotion condition was recorded as unmet in
  `docs/develop/browser-matrix.md` rather than silently satisfied.

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
     `GET /reachability-sentinel.txt?n=…` (destructive probe; the same
     response also yields the deployment-header verdict, so no additional
     request is made for it). No other
     runtime requests. Every allowed request must carry no query key beyond
     the two named above — checking method and path alone would let an allowed
     static GET carry a payload field in its query.
   - **Negative matrix after capture / copy / paste / playback / rejection /
     close / `pagehide` / timeout:** a unique relay payload marker and a
     marker from each sender-controlled `sym-message` / `pq-message` field plus
     the refused `OCK2` / public-key artifact bytes are absent from request URLs
     including query names and values, request header names and values, request
     bodies, every IndexedDB database's schema names — database, object-store
     and index names and key paths — as well as its keys/values, CacheStorage
     metadata/bodies (static shell permitted), localStorage (only `{oc-theme,
     oc-lang, oc-offline-ack-pending, oc-online-tab}`), console,
     `window.onerror` / unhandled rejections, visible error text,
     `document.title`, `location.href`, and history state. **One marker set
     covers every sink**; a request oracle that searches fewer markers than the
     storage oracle is the hole this line exists to close. The byte-aware
     storage oracle's self-test plants both a typed-array value marker and a
     marker that appears only in an object-store name, and requires exactly
     those two matches.
   - **Window-realm receipts must never appear in IndexedDB, localStorage, or
     CacheStorage.** Receipts are intentional module-memory residue in one loaded
     app window only (`src/features/receipt-cache.ts`), not shared with other tabs
     or windows. Reload, transient clear, wipe, or oldest-first bounded eviction
     removes detection coverage. A change that persists them fails this gate: it
     would store a frame- or assembled-artifact-derived value, break the
     clean-origin boot gate's "no frame- or artifact-derived residue" premise,
     and contradict `docs/security/threat-model.md` §1 / T11 / T19.
   - Errors use fixed i18n / `AppError` mappings — never interpolate raw
     input, frame metadata, `transferId`, hashes, or `caught.message`.
5. Review the `aube-lock.yaml` diff (provenance maintained)

## 4. Items to Record Here When the Independent Review Completes (Template)

- Reviewing party (basis of independence) / review period
- Target commit hash, build hash, `@noble/post-quantum` version, and transitive lock
- Scope (the maximum-mainline libraries, the protocol design in
  docs/spec/qr-protocol-v2.md, the application implementation, and the
  single-active suite / `sym-message` / `symmetric-key` wire contract,
  including the `hkdfSalt` wire-field removal and IV-bound fixed-salt HKDF)
- List of findings, fix commits, and re-verification results
- FIPS errata check result

**Current status: none of the above is recorded (no independent third-party audit has been performed). release-approved has NOT been reached.**
