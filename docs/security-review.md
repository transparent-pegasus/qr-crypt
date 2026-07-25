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
    byte counts in the table below, the OCF2 frame counts at chunk sizes
    200/300/400/600/900B, real EC-Q generation for every frame, and boundary agreement
    with the env capacity guard.
  - The ML-KEM-1024 / ML-DSA-87 KATs and `aube test` / `aube typecheck` pass,
    and the `aube bench:pq` maximum reference figures plus the README and
    protocol documents are updated.
- **release-approved**: Not reached until an independent third-party review of
  the selected versions and the whole application is recorded
  (**external blocker**). Until then, the UI, README, and CI consistently
  display experimental / not independently audited.

Self-investigation and self-authored documents (including this one) are no
substitute for independent review and do not close the blocker.

Measured maximum fixture (`maxPlaintext=4,096B`, `name="テスト"` — the literal
fixture string):

| artifact | canonical CBOR (bytes) | OCF2 frames (200 / 300 / 400 / 600 / 900B) |
|---|---:|---:|
| unsigned empty / max | 1,887 / 5,986 | 10/7/5/4/3 / 30/20/15/10/7 |
| signed empty / max | 6,613 / 10,711 | 34/23/17/12/8 / 54/36/27/18/12 |
| OCI2 bundle | 4,402 | 23/15/12/8/5 |
| OCP2 KEM / OCS2 DSA | 1,733 / 2,755 | 9/6/5/3/2 / 14/10/7/5/4 |
| OCB2 reserved sizing fixture | 4,637 | 24/16/12/8/6 |

OCI2 display uses balanced count mode:
`clamp(ceil(artifactBytes / 100), 40, 50)`. The 4,402B fixture selects 45
frames whose chunks are 97/98B. Tests cover short names through the maximum
80-character name, byte-exact reconstruction, non-empty chunks whose sizes
differ by at most 1 byte, and real EC-Q generation. If `VITE_QR_MAX_FRAMES` is below the selected count,
generation fails closed as `QR_TOO_LARGE`. OCP2/OCS2 use the fixed 140B
chunk (`PQ_KEY_QR_FRAME_BYTES`), producing 13/20 frames for the measured
fixtures. The 200/300/400/600/900 figures above remain message-class measurements
across the configurable range; 300B is the default.

The current multipart transition interval is exactly
1,000/1,500/2,000/2,500/3,000ms, defaulting to 2,000ms. New preferences and
environment values off that grid are rejected. Boot reads the exact union of
legacy safe integers 150–2,000ms and the current grid, then the preferences
repository normalizes only persisted legacy values to the nearest
current-grid value (midpoints round up) before merging a current patch. This keeps readable legacy rows (including `wipeOnOnline=false`) from
being misclassified while still rejecting stored/new 2,250ms.

## 1. Facts About the Adopted Libraries (as of 2026-07-25)

### @noble/post-quantum 0.6.1 (exact pin; version ranges forbidden)

- Released: 2026-04-12. npm provenance ✓ (all nearby versions attested). **Re-verified 2026-07-24: 0.6.1 is the latest; no advisories in the repo / GHSA / OSV**
- Dependencies: noble family only (@noble/ciphers / @noble/curves / @noble/hashes ~2.2.0)
- Implements: FIPS 203 (ML-KEM) / FIPS 204 (ML-DSA) algorithms
- FIPS errata (§3 step 1, checked 2026-07-24): NIST lists prospective corrections only (FIPS 204 sheet updated 2026-02-27). No impact on the API or the size table
- **Not independently audited.** The audit status as of 0.6.1 is self-audit only (scope: everything)
- **Side channels: as a JS implementation, constant-time execution is not guaranteed.** In particular, for the ML-KEM decaps implicit-rejection path, constant-time behavior under JS/JIT is explicitly documented and not guaranteed
- APIs used by the active policy (verified against the actual 0.6.1 source):
  `ml_kem1024.keygen(seed64?)` / `.encapsulate(pk)` / `.decapsulate(ct, sk)`,
  `ml_dsa87.keygen(seed32?)` / `.sign(msg, sk, {context})` /
  `.verify(sig, msg, pk, {context})`. The library also contains 768/65
  implementations, but the active policy does not use them for cryptographic
  processing

### Supply Chain

- Locked in `aube-lock.yaml` (must be committed). For the v1-era supply-chain
  decisions and the 2026-07-24 re-verification, see `docs/threat-model.md` §5.1
- ZIP output is an in-house store-only implementation with no added dependency (`fflate` was rejected for lacking provenance)
- **RESOLVED (dev chain, re-verified 2026-07-25)**: `sharp` — `GHSA-f88m-g3jw-g9cj`
  (CVE-2026-33327 / CVE-2026-33328 / CVE-2026-35590 / CVE-2026-35591,
  published 2026-07-17; affected versions below 0.35.0). Former path:
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
  `5.0.8` via `aube.overrides`; `aube build:prod` and the full test suite were
  re-verified after the override. `aube audit` currently exits 0.
- Supply-chain pins re-verified clean: `react-hook-form@7.82.0`, `eslint-config-prettier@10.1.8`

## 2. Prohibited Claims (UI / README / CI)

None of the following may be used in UI, README, or CI displays.

- "FIPS certified" (implementing FIPS 203/204 algorithms is distinct from FIPS 140 certification)
- "completely secure" (a safety declaration without independent audit)
- "secure erase" / "complete deletion" (see docs/boot-and-reset-v2.md)

The security screen must state explicitly:
noble is not independently audited; JS side-channel resistance is not
guaranteed; JS memory erasure has limits
(zeroize is incomplete due to GC, internal copies, and optimizations).

## 3. Per-Release Verification Checklist (also listed in the README)

1. Check the latest FIPS 203 / FIPS 204 errata (on the relevant NIST CSRC pages)
2. Check the `@noble/post-quantum` changelog, known vulnerabilities, and advisories
3. Confirm the KATs (`aube test:pq-vectors`) are all green
4. Confirm the bundle makes no external network references (e2e: `tests/e2e/security.spec.ts` asserts all in-page requests are same-origin)
5. Review the `aube-lock.yaml` diff (provenance maintained)

## 4. Items to Record Here When the Independent Review Completes (Template)

- Reviewing party (basis of independence) / review period
- Target commit hash, build hash, `@noble/post-quantum` version, and transitive lock
- Scope (the maximum-mainline libraries, the protocol design in
  docs/qr-protocol-v2.md, the application implementation, and the retained
  4-suite wire/codec contract)
- List of findings, fix commits, and re-verification results
- FIPS errata check result

**Current status: none of the above is recorded (no independent third-party audit has been performed). release-approved has NOT been reached.**
