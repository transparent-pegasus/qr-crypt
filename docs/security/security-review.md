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

Maximum fixture re-verified 2026-09-06 by
`tests/pq/maximum-artifact-size.golden.test.ts` (`maxPlaintext=120,000B`,
`name="テスト"` — the literal fixture string):

| artifact | canonical CBOR (bytes) | compatible-preference frames | default-preference frames |
|---|---:|---:|---:|
| signed empty / max | 6,570 / 126,576 | 33 / 127* | 7 / 127 |
| OCI2 bundle | 4,402 | 45 | 5 |
| OCB2 reserved sizing fixture | 4,637 | 47 | 5 |
| sym-message at plaintext ceiling | 1,000 (exactly one frame) | 1 | 1 |

The compatible preference clamps density to 200B for the empty signed
message (33 frames) and 1,000B for the maximum signed message (127 frames,
marked `*`); both retain the 2,000ms dwell. The byte counts are unchanged.
The symmetric row is verified by `tests/pq/sym-envelope.golden.test.ts`.

Plaintext ceilings are algorithm-specific; owners live in `src/lib/limits.ts`
and the suite size tables beside them. The post-quantum path accepts at most
120,000 UTF-8 bytes. The single-frame symmetric path
(`sym-message` / `OCA2`) is capped at `MAX_SYM_PLAINTEXT_BYTES` = 853
(`FRAME_CHUNK_MAX_BYTES` − `SYM_MESSAGE_OVERHEAD_BYTES` − `AES_GCM_TAG_BYTES`).
The same single-frame constraint is enforced when an OCF2 frame is decoded;
[qr-protocol-v2.md](../spec/qr-protocol-v2.md) §3.1 owns that invariant and
its generation/decode error split.

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

The artifact byte count is corrected to the current fixture. The timings and
archive size retain the 2026-07-26 measurement; no new retained measurement
attachment supersedes them in this change.

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

## 1. Facts About the Adopted Libraries

Library-specific checks carry their own review date. The Noble source, exact
published packages, advisories, and FIPS errata were assessed on 2026-09-07;
the selected pin and local validation below belong to that change. The zxing
facts remain dated 2026-08-02; its pin and device measurements did not change.

### @noble/post-quantum 0.7.1 (exact pin; version ranges forbidden)

- [Released 2026-08-27](https://github.com/paulmillr/noble-post-quantum/releases/tag/0.7.1).
  The [0.7.0→0.7.1 comparison](https://github.com/paulmillr/noble-post-quantum/compare/0.7.0...0.7.1)
  was assessed before selecting this exact version. The resulting lock changes
  only post-quantum `0.7.0` → `0.7.1` and ciphers/curves/hashes `2.3.0` →
  `2.4.0`; all unrelated pins, integrities, and overrides are preserved.
- All three Noble runtime requirements are now exact `2.4.0`, including
  curves' hashes requirement. All four packages require Node `>=20.19.0`,
  compatible with this repository's pinned Node `26.5.0`.
- **Not independently audited.** The selected
  [security statement](https://github.com/paulmillr/noble-post-quantum/blob/0.7.1/README.md#security)
  names a self-audit of **0.6.1 in April 2026**, not an independent audit of
  0.7.1. The release's auditor acknowledgement is not an audit report. Older
  audit statements in the transitive libraries do not establish exact-2.4.0,
  PQ, or whole-application coverage. Experimental status and the
  `release-approved` blocker remain.
- The 2026-09-07 assessment found no matching reviewed GitHub advisories or
  OSV entries for PQ 0.7.0/0.7.1 or ciphers/curves/hashes 2.3.0/2.4.0.
  `aube audit --json` on the upgraded lock exits 0 with no advisories and
  zero vulnerabilities in every severity across 778 dependencies. These are
  dated known-advisory checks, not evidence that vulnerabilities cannot exist.

**Active-source disposition.** The selected
[ML-KEM](https://github.com/paulmillr/noble-post-quantum/blob/0.7.1/src/ml-kem.ts),
[ML-DSA](https://github.com/paulmillr/noble-post-quantum/blob/0.7.1/src/ml-dsa.ts),
and [utilities](https://github.com/paulmillr/noble-post-quantum/blob/0.7.1/src/utils.ts)
retain the adapter's API and wire sizes:

| Active change | Application reachability and limit |
| --- | --- |
| ML-KEM key-generation cleanup | `try/finally` clears temporary K-PKE secret-key and public-key-hash buffers. The Worker supplies its own seeds and remains responsible for them; library-generated seed cleanup is not the normal application path. |
| ML-KEM encapsulation cleanup | The application omits optional randomness, so cleanup of the generated 32-byte `m` and randomness half of `kr` applies. `m` is the shared-secret preimage, not application plaintext. The returned shared-secret half survives; caller-supplied vector randomness is unchanged. |
| ML-KEM decapsulation cleanup | K-PKE now clears `v` after it has become the recovered polynomial `w`. The implicit-rejection selection is not a new constant-time implementation. |
| ML-DSA signing cleanup | Four rejected-iteration exits clear working buffers before retrying. This reaches randomized ML-DSA-87 signing; it does not add a function-wide exception cleanup guard. |
| ML-DSA options and byte copies | Public sign/verify validate a frozen, null-prototype snapshot of own options. Plain `{ context }` calls remain valid; the snapshot does not clone referenced byte arrays. `copyBytes` avoids an overridable iterator during KEM public-key validation. No application exploit or protection of a compromised JS realm was demonstrated. |

These changes reduce retained mutable working state. They do **not** establish
complete exception-path cleanup, constant-time JS/JIT execution, physical
erasure, or removal of GC/JIT/native copies. In particular, encapsulation's
new `finally` does not clear the shared-secret half of `kr` if encryption
throws. The adapter continues to own sensitive returned subarrays and clears
the old view when it copies them. No new application-specific exploit was
demonstrated by this assessment, and no exact-stack leakage bound follows.

The published import closure includes PQ `ml-kem`, `ml-dsa`, `_crystals`,
and `utils`; hashes `sha3`, `_u64`, and `utils`; and curves `utils`,
`abstract/fft`, and `abstract/modular`. This is source reachability, not a
measurement of the final tree-shaken bundle.

| Transitive 2.3.0→2.4.0 disposition | Active effect |
| --- | --- |
| [hashes](https://github.com/paulmillr/noble-hashes/compare/2.3.0...2.4.0) | SHA3 changes are formatting only and `_u64` is unchanged. Utility option merging uses a fresh null-prototype object, checks plain objects, and rejects own `__proto__`; this reaches SHAKE configuration. |
| [curves](https://github.com/paulmillr/noble-curves/compare/2.3.0...2.4.0) | Its active `abool`, `FFTCore`/`reverseBits`, and generic modular-helper source files are unchanged. Curves is not wholly unimported. |
| [ciphers](https://github.com/paulmillr/noble-ciphers/compare/2.3.0...2.4.0) | No module is in the selected import closure. It remains a supply-chain dependency, not the implementation of this application's AES-GCM. |

Falcon, SLH-DSA, hybrid combiners, prehash XOF/OID enforcement, prepared-key
surfaces, and Noble's new PQ WebCrypto wrapper are unselected. Transitive
curve-specific, KDF, stream-cipher, and WebCrypto changes are likewise not
fixes to QR Crypt's active cryptography. Existing browser WebCrypto
AES-256-GCM/HKDF-SHA-256 composition is unchanged.

**Provenance disposition.** The four exact registry records provide publish
and SLSA v1 attestations. In the assessment, downloaded tarballs matched
registry SHA-512 integrity, decoded attestation subjects matched their
SHA-256 digests, and provenance commits matched registry `gitHead` and
upstream source heads. Installed package files were compared with those
assessed tarballs. This is content/metadata consistency, **not** independent
Sigstore certificate-chain, signature, or transparency-log verification;
neither that trust-chain check nor an independent source-to-published-JS
rebuild was performed.

| Exact package | Recorded source/provenance commit |
| --- | --- |
| [post-quantum 0.7.1](https://registry.npmjs.org/@noble%2fpost-quantum/0.7.1) | `a23736036d4d5b34dd3a9e0ee312fd43d00154ac` |
| [hashes 2.4.0](https://registry.npmjs.org/@noble%2fhashes/2.4.0) | `663c2aeeffc308ac0cded59bd32f7c212adacfc2` |
| [curves 2.4.0](https://registry.npmjs.org/@noble%2fcurves/2.4.0) | `656c4364dffa44c64aa0c49914b8000b278b67a9` |
| [ciphers 2.4.0](https://registry.npmjs.org/@noble%2fciphers/2.4.0) | `d9e8a6a599e7ed729d9be03854c46a3c73bd9a79` |

**API and size check against 0.7.1.** Selected calls remain
`ml_kem1024.keygen(seed64?)`, `.encapsulate(pk)`, `.decapsulate(ct, sk)`;
`ml_dsa87.keygen(seed32?)`, `.sign(msg, sk, { context })`, and
`.verify(sig, msg, pk, { context })`. Context is at most 255 bytes. Noble's
`cipherText` result is still mapped to the adapter's `ciphertext`.

| Algorithm | Public key | Secret key | Ciphertext / signature | Shared secret | Seed |
| --- | ---: | ---: | ---: | ---: | ---: |
| ML-KEM-1024 | 1,568 B | 3,168 B | 1,568 B ciphertext | 32 B | 64 B |
| ML-DSA-87 | 2,592 B | 4,896 B | 4,627 B signature | — | 32 B |

`KEM_SIZES`, `DSA_SIZES`, and `PQ_PROFILES.maximum` are unchanged; no retired
algorithm or profile was restored.

**FIPS errata, assessed 2026-09-07.** Both linked workbooks were read in full.
[FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) retains the 2025-11-17
planning note; [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) links the
2026-07-31 update. Their notices say these prospective corrections introduce
no new technical requirements. The selected-source dispositions are:

| Workbook rows | Disposition |
| --- | --- |
| [203, 16–17](https://csrc.nist.gov/files/pubs/fips/203/final/docs/fips-203-potential-updates.xlsx) | Extra index-zero zeta and Algorithm 15's `v`→`w` comment: indexed powers and transformed-polynomial decoding already agree; no wire change. |
| [204, 16–23](https://csrc.nist.gov/files/pubs/fips/204/final/docs/fips-204-potential-updates.xlsx) | NTT exposition, internal `M'` naming, editorial fixes, and commitment order `mu || w1`: selected context formatting and signing/verification hash order agree. |
| 204, 24–26 | The Montgomery appendix routine is not used. Invalid signatures remain rejected; ML-DSA-87 UseHint uses its 16-value range. |
| 204, 27 | Expected repetitions become 4.36/5.14/3.91 and the optional signing-loop minimum becomes 821 instead of 814. Selected signing has no 814-iteration cap to change. These values are not measured performance. |

No active API or parameter size changes follow. KATs support the exercised
cases; they do not establish complete FIPS conformance or FIPS 140 validation.

**Local validation, 2026-09-07.** `aube ci`, `aube run typecheck`, and
`aube run lint` passed (lint: 0 errors, 13 existing Fast Refresh warnings).
`aube run test:pq` passed 179 tests in 17 files, including the existing
negative-input, composition, size, and frozen golden coverage;
`aube run test:pq-vectors` passed all 6 tests. `aube run test` passed 1,101
tests in 91 files, including existing Worker/integration and security-copy
coverage; `aube run build:prod` passed. `aube run test:e2e` passed all 33
existing mobile-chromium scenarios (39.1s), including offline Worker crypto,
seed re-expansion after reload, CSP, and relay/receipt non-persistence.
The final install-template/packaging/header checks passed 49 tests in 5 files.
These checks exercise the upgraded
dependency on the baseline application; F1–F3 acceptance on the combined
implementation remains an integration gate.

`aube run bench:pq -- --run` completed on the Linux development host with
Node 26.5.0, aube 1.32.0, and Vitest 4.1.10. The existing benchmark runs in
both its `node` and `ui` projects; the latter is a test environment, not a
phone measurement. Mean milliseconds per operation:

| Operation | Node project | UI project |
| --- | ---: | ---: |
| ML-KEM-1024 keygen | 0.7127 | 0.8150 |
| ML-KEM-1024 encapsulate | 0.9011 | 0.9543 |
| ML-KEM-1024 decapsulate | 1.2123 | 1.2056 |
| ML-DSA-87 sign | 11.1772 | 10.3111 |
| ML-DSA-87 verify | 3.4006 | 3.3656 |

Signing relative margins were ±14.96% and ±16.10%, with 45 and 49 samples.
These are reference throughput figures, not constant-time or timing/power/EM
leakage measurements. Device support and Android/iOS browser-matrix cells were
not remeasured or restamped. The full browser run exercised the long-text
measurement scenario but retained no new attachment, so its historical table
above is not refreshed from an unrecorded value.

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
- **HISTORICAL RESOLUTION (dev chain, 2026-07-25; found stale
  2026-08-08)**: `brace-expansion` — `GHSA-mh99-v99m-4gvg` (high): DoS via
  unbounded expansion; vulnerable `<=5.0.7`. Paths: `workbox-build` → `glob` →
  `minimatch` → `brace-expansion@5.0.7` and `workbox-build` → … →
  `minimatch@5` → `brace-expansion@2.1.2` (build tooling only; inputs are
  repo-controlled glob patterns). Both selectors were forced to `5.0.8`. That
  version was itself vulnerable under `GHSA-rgw5-rvv9-x895`, published
  2026-07-30, which bypassed the mitigation this pin existed for. The
  2026-08-02 record asserting that `aube audit` exited 0 was already stale when
  written.
- **RESOLVED (build/test/deploy chain, 2026-08-08)**: `brace-expansion` is
  forced to `5.0.9` for both the `@5` and `@2` selectors; `2.1.4` is also
  patched, and choosing `5.0.9` for both is a deliberate one-version-in-the-graph
  decision. Additional overrides then forced `fast-uri@3.1.5`,
  `nanoid` (now `3.3.18`, after the 2026-08-14 remediation), and
  `undici@7.29.0`. These packages are build, test, or deploy tooling and none is
  in the browser bundle. The known-advisory set grew from seven findings to
  eight during remediation; after the overrides, `aube audit` reported no known
  vulnerabilities on 2026-08-08.
- **RESOLVED (build chain, 2026-09-06)**: `fast-uri` moved from `3.1.5` to
  `3.1.6`; an override now pins `browserslist@4.28.7` instead of locked
  `4.28.6`. These close the six findings published to the GitHub Advisory
  Database on 2026-09-01/2026-09-02, individually recorded in
  [threat-model.md](threat-model.md) §5.1. Their Workbox/Babel/AJV paths have
  no direct application imports; the URI-parser findings do not establish
  application SSRF exposure. Only these two package versions and their lock
  references changed; every unrelated pin, integrity, and override remains
  unchanged. `aube ci` passed and `aube audit` reported no known
  vulnerabilities on 2026-09-06. Independent audit and release approval
  remain unresolved.
- CI `validate` runs `aube audit` after `aube ci` on every push and pull
  request targeting `main` or `dev`. The approved 2026-09-07 maintenance
  contract additionally requires scheduled/manual, read-only external audit
  and exact-pin/latest-upstream comparison; see
  [deployment.md](../develop/deployment.md). Its integration validation is
  pending. Neither check updates an offline installation or maintains this
  written record automatically.
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

## 1.2 Findings NSR-01 / NSR-02 / NSR-04 / NSR-05 / NSR-06 (2026-08-03 and 2026-08-08)

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

### NSR-05 — Relay accepted multi-frame symmetric transfers

- **Found:** the single-frame rule for `sym-message` / `symmetric-key` lived only
  in `qrFrameV2Schema`. The offline assembler reached it through
  `validateQrFrameV2`; the relay decoded through `guardQrFrameV2` and did not. A
  crafted two-frame `sym-message` was accepted at every split boundary,
  restoring the chunk-length partition as a covert channel on the exact path T21
  describes.
- **Shipped:** the rule moved into `guardQrFrameV2`, so every OCF2 frame decode
  path inherits it, and the superseded Zod clause was deleted rather than left as
  a second owner. Pinned by `tests/unit/relay-frames.test.ts`,
  `tests/ui/online-relay.test.tsx`, and
  `tests/pq/maximum-policy-boundaries.test.ts`.
- **Residual, unchanged:** the 277-bit covert floor in the smallest legitimate
  symmetric transfer. This removes one additional channel; it does not close T21.

### NSR-06 — Cosign identity-policy bypass in Route A verification

- **Found:** the release workflow pinned Cosign v3.0.6. High-severity
  [GHSA-fx35-mq7g-6g98](https://github.com/sigstore/cosign/security/advisories/GHSA-fx35-mq7g-6g98),
  published 2026-08-06, affects Cosign v3 through v3.1.2. When a legacy JSON
  bundle's `cert` value failed X.509 parsing, `verify-blob` could treat it as a
  raw public key and then skip certificate-chain and certificate-policy checks.
  A substituted bundle could therefore produce `Verified OK` while bypassing
  the `--certificate-identity` and `--certificate-oidc-issuer` policy Route A
  depends on.
- **Shipped:** the workflow's installed signer and isolated verifier image now
  pin [Cosign v3.1.3](https://github.com/sigstore/cosign/releases/tag/v3.1.3),
  including the verifier image index digest
  `sha256:9e5c2f2edc34351160407ca3416c61855bdf9403c3c5936e0f0be7fc261611b8`.
  The English and Japanese Route A procedures retain independent provisioning
  and authentication and require v3.1.3 or later.
- **Residual:** the repository controls its workflow pin, but the Route A
  verifier supplies their own Cosign binary; that version floor is an
  instruction, not an enforced control. The CI `aube audit` gate checks npm
  packages and would never have detected this Cosign advisory. The independent
  rebuild remains mandatory: this change removes an identity-policy bypass, not
  the source-to-binary gap.

### Recorded, not implemented

- Independent third-party audit, independent reproduction of the release from
  source, and an authenticated rebuild toolchain remain the open external
  blockers (§1, §4). No repository change closes them.
- The T21 covert-egress floor (277 bits in the smallest legitimate symmetric
  transfer) is an architectural residual; reducing it further is a wire-format
  change and was not attempted here.
- The widened-QR promotion condition was recorded as unmet in
  `docs/develop/browser-matrix.md` rather than silently satisfied.

## 1.3 Merged 2026-08-12 nation-state-security review round (closed 2026-08-14)

Three same-skill runs reviewed revision `db082c7`. Exactly two have file-backed
reports under gitignored `.tmp/`: `nss-review-20260812-db082c7.md` (Claude,
NSS-R1–NSS-R8 plus the merge addendum) and `nss-codex-pY-20260812.md` (Codex
pY, NSR-01–NSR-10). The third run, Codex pW, was in-pane only; its executable
evidence — typecheck and lint passed, 75 Vitest files / 1,016 tests passed, 31
Playwright tests passed, the production build passed, and `aube audit` was
clean — is preserved in the first report's merge addendum. These are
same-skill self-investigations, not an independent review in the sense §4
requires.

The owner decisions and merged dispositions were taken as follows:

- **D1 — option A:** retain the permanent wipe-on-online switch with typed
  confirmation and acknowledgment parity; retain the one-transition
  maintenance token. The boot and wipe decision logic did not change.
- **D2 — default:** show the symmetric-key fingerprint at import and require
  an independent-channel comparison acknowledgment, without a wire,
  storage-schema, or persisted trust-state change.
- **D3 — accepted:** take the relay and README precision work. This reverses
  the earlier r1 misattribution: the existing PNG / ZIP / clipboard disclaimer
  did not refute the tension between persistent-storage and transfer claims.
- **D4 — approved and taken:** upgrade the exact `@noble/post-quantum` pin to
  0.7.0 through the complete `crypto-noble` unit; its audit, PQ, vector, and
  benchmark gate passed.
- **D5 — superseded 2026-09-07:** the owner approved external
  scheduled/manual maintenance for advisories and unassessed Noble releases.
  The required workflow and helper are described in
  [deployment.md](../develop/deployment.md); integration verification remains
  pending. Offline installations still have no updater.

NSS-R8 remains `REPOSITORY_IMPLEMENTABLE` but deliberately deferred. Re-open
unverified-signer plaintext gating first if operator reports show the current
destructive identity alerts being ignored. Consider cross-session replay
persistence only with the device-keyed opaque-tag design named in F-02.
Sender-key binding is a wire revision.

The exact-device leakage campaign remains an `EXTERNAL_ASSURANCE` follow-up.
Evaluating a hardened native backend remains an architectural decision if
side-channel resistance becomes a requirement. Operator Cosign currency,
Route A navigation-response checking, the T21 277-bit covert-egress floor, E8,
and T13 retain their recorded deployment, external-assurance, or architectural
boundaries. This round changes no external-assurance status: the independent
third-party audit and environment-independent release reproduction blockers
stand, and `release-approved` remains unreached.

**Architectural residual (NSR-07).** The sole active post-quantum suite
concentrates confidentiality in ML-KEM-1024 and authenticity in ML-DSA-87. No
independently different component preserves the corresponding property if its
family fails. Hybridization or diversification would be a versioned-protocol
redesign requiring independent design review, not a dependency swap. This is a
concentration record, not evidence of a present break.

## 1.4 F1–F5 follow-up (2026-09-07; integration verification pending)

This bounded follow-up starts from `1ae9cf5c675068b30d8b5e3a8f7fa092106824a5`.
The Noble assessment, application and release implementation reports, and
independent app/release-test and integration/harness reports were read. Release commits are
`1295d5c02674493f3a14b332f311ef26f460f2d3` (archive/browser gate) and
`b983bb7fcfcac3c82b3bb21c563e75696d392724` (external maintenance). Integrated revision
`619d03fe2167e2b677f34502c3215b7f46da08b5` contains those implementations,
the application fixes, Noble 0.7.1, and the independent app/release tests.
No combined-tree GREEN result is claimed here.

The assessment assumes persistent targeting of a few installations across
provisioning, years of use, captured ciphertext, and retirement; initial
supply-chain influence, brief unsupervised custody, nearby observation, and
browser/OS/firmware compromise are relevant capabilities. Device access,
distance, duration, timers, and recovery probabilities remain uncertain. No
demonstrated mathematical break or unlimited adversary is assumed. Honest
Web Locks/IndexedDB and cooperating sensitive writers bound the relay control;
an independently trusted comparison channel bounds person-binding. Platform,
operator, media, and physical-environment assurance is not supplied by these
repository checks; see [environment-threat-catalog.md](environment-threat-catalog.md).

| Item | Control class | Implemented or required behavior and verification disposition |
| --- | --- | --- |
| F1 — incomplete fingerprint comparison | `REPOSITORY_IMPLEMENTABLE` | App commit `203b515ed1f81e7ab0ffab1526d3b027b46454c8` changes `formatFingerprint` and the shared `Fingerprint` display to all 64 lowercase hex digits. The composite identity is authoritative at import, details, and saved-key confirmation; complete KEM/signing hashes are supplementary. Symmetric import also requires full comparison. Independent tests cover every digit, modulo aliases, suffix differences, EN/JA acknowledgement, trust gating, and 320px layout. Focused integrated checks pass; final combined verification remains pending. |
| F2 — relay admission after a stale display proof | `REPOSITORY_IMPLEMENTABLE` | App commit `ae4a6b6b9457ab08f20aea944fbba02bbe406967` adds `BootController.acquireRelaySession(signal)`, wired through `OnlineInstallScreen.onRelaySessionAcquire` to `OnlineRelay.onSessionAcquire`. It acquires first, reads actual sensitive stores, checks lifecycle, and holds that same lease until teardown. Missing callback/locks, cancellation, failed/dirty reads, and stale lifecycle reject and release. `refreshRelayEligibility` is display-only. Independent completed-writer, cancellation, delayed-read, and lifecycle regressions pass the focused integrated checks; final combined verification remains pending. No database-exfiltration attack was demonstrated. |
| F3 — release browser evidence | `REPOSITORY_IMPLEMENTABLE` | Implemented: no-build `E2E_ARTIFACT_ROOT` execution of extracted bytes, archive digest/full-member checks before and after, the same digest checked by sign/publish, and a separate broken-JS archive regression. The source report records 33 existing browser scenarios passing against one archive, the before/after digest/member checks, and a separate broken-JS browser failure plus healthy control. Integrated unit/helper and workflow checks pass; real artifact-browser regressions, integrated 0.7.1 archive checks, and remote CI remain pending; [deployment.md](../develop/deployment.md) records the exact scope. |
| F4 — selected crypto dependency and monitoring | `REPOSITORY_IMPLEMENTABLE` | Exact Noble 0.7.1, active/transitive/provenance dispositions, and local evidence are recorded in §1. External read-only scheduled/manual audit and exact-pin/latest-upstream checking replace D5's deferral. Integrated maintenance-helper tests and the live 0.7.1 comparison pass; the complete workflow remains pending. No new application exploit or exact-stack assurance is claimed. |
| F5 — deployment-header assurance | `DEPLOYMENT_ENFORCED` | The persisted sentinel-response verdict already fails closed on absent/failing values. It cannot validate navigation or arbitrary asset responses. Route A §7 step 4 and the archive template require a separate actual-server check; reference-server release tests do not replace it. External deployment evidence remains pending. |

Each item has a potential **HIGH** consequence if its relied-upon boundary
fails: false person-binding, admission of a sensitive origin, substituted
release bytes, exposed cryptographic state, or missing deployment controls.
Feasibility depends on the prerequisites above; these are not five demonstrated
exploits. F1/F2's independently authored baseline tests establish the old
behavior, not successful remediation on the combined tree.

The independent F1/F2 test commits are
`ef5e450fd5d4ec683daa01ede700e813f42c3814` and
`621f880c816dbac1e2ad2e7d330a733841a2a925`. Their reported baseline RED includes
the actual-browser completed-writer cases for keys, PQ identities, and Vault,
and the missing complete comparison at 320px. Required final checks include
`tests/ui/fingerprint-confirmation.test.tsx`,
`tests/ui/boot/relay-session-admission.test.tsx`,
`tests/e2e/fingerprint-comparison.spec.ts`, and
`tests/e2e/relay-admission.spec.ts`, alongside existing import/trust/relay tests.
These tests are present in the integrated revision above. The initial integration report at
`70ec1cf0b0228b44578cb1a6007ca0fba098a1ce` records 408 passing/3 failing
unit/UI tests and 9 passing/1 failing browser tests. Full comparison and
controller tests and all native relay cases passed there; the report attributes
the remaining failures to old raw-value/missing-callback fixtures and browser
layout synchronization/disclosure handling. Harness correction
`3d163d76fd684613c3271b2ed1dffbf0d33feef9` fixes those assumptions; its report
records passing focused and fingerprint checks but a pagehide probe setup race
in the combined browser run. Commit `16f6970ffe5a4852b680beda4ae825eadff2efd3`
then changes only the relay test's second-page fixture to a verified inert
same-origin document. Its report records passing combined app-browser checks
and repeated native relay cases. Whole-tree and packaged-browser verification
remain pending, so these scoped results authorize no dependent stamp.

Independent release-test commit `b6f87bb1ece873f1bffd4ddb77a2df1789909bbf`
is integrated as `619d03fe2167e2b677f34502c3215b7f46da08b5`. Its baseline RED
covers root selection, archive/member mutation, and the broken-JavaScript
browser case. Concrete final checks are
`tests/unit/release-packaged-pwa.test.ts`,
`tests/unit/release-tested-archive.test.ts`,
`tests/unit/crypto-release-check.test.ts`, and
`tests/e2e/release-artifact.spec.ts`, with their registered fixtures. The
controlled process fixtures establish orchestration behavior only; the
browser regression requires an actual damaged-asset error and healthy
controls. The release-verification report at the same integrated revision
records passing unit/helper, workflow/shell, action-tag, and live release
checks. Real artifact-browser and final combined outcomes remain pending.

E8/T21 valid-egress risk (QR, clipboard, PNG, ZIP, removable media), retained
old decryption keys, bounded window-memory replay detection, best-effort wipe,
and export/media residue remain. Exact-device leakage, independent audit,
authenticated tooling, independent rebuild, deployment checks, physical
custody, and procedure effectiveness remain external work. No freshness unit
depending on app/release integration is stamped by this follow-up.

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
