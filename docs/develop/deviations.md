# Managed Deviations from the Specification

Deliberate, maintainer-approved departures from the originally specified stack and
protocol that **still constrain the current implementation**. Each row states what the
code does today and why, so a future change does not silently undo the decision.

Purely historical entries ("feature X was withdrawn", "algorithm Y was removed") are not
kept here. This project has no backward compatibility and no update path — installs never
update — so a record of what the software once did constrains nothing.

## Stack

| Deviation | Reason / basis |
| --- | --- |
| `sonner` instead of `toast` | The shadcn v3 registry has no `toast`, so its official successor `sonner` provides the toast surface |
| No shadcn CLI; manual vendoring | The CLI generates an npm-style lockfile, so it is not used. Components are placed manually into `src/components/ui/` from the official registry JSON |
| `radix-ui` umbrella package not adopted | Only `radix-ui@1.6.4` lacked provenance, so the scoped `@radix-ui/react-*` packages are used. Supply-chain incident details: [../security/threat-model.md](../security/threat-model.md) §5.1 |
| `typescript@6` pin | Exact major pin: installs never update, so a silently adopted major has no rollback path; moves happen only through the deps freshness unit. |
| `@playwright/test` instead of `playwright` | `@playwright/test` is the test runner. Browsers are installed via `aube exec playwright install chromium` (CI uses `--with-deps`) |
| Test-support dev deps (`fake-indexeddb` / `pngjs` / `@types/pngjs` / `@testing-library/jest-dom`, etc.) and Tailwind / Radix packages | Outside the originally recommended dependency list but required by the stack (e.g. PNG round-trip decoding with `pngjs`) |
| Additional shadcn components `checkbox` / `collapsible` | Needed for strong confirmation and collapsible detail views |
| Camera QR reading runs on `zxing-wasm` (reader-only build) | `@zxing/browser` is not used. The WebAssembly binary is served same-origin and precached, so `script-src` carries `'wasm-unsafe-eval'`. See [../security/security-review.md](../security/security-review.md) §1 |
| `wrangler` kept as an exactly pinned devDependency though no script invokes it | `cloudflare/wrangler-action@v4` in `.github/workflows/cloudflare-pages.yml` uses the project's wrangler when one is present, so this devDependency is what pins the deploy tool — and through it `miniflare` and `sharp` (see [../security/security-review.md](../security/security-review.md) §1 for the advisory-driven 4.114.0 bump). The range is exact, not `^`, because a caret silently re-resolved that chain on the next install |
| `@zxing/library` kept as a devDependency | Pixel decode of generated PNGs in unit and Playwright helpers only. Not in the shipped bundle |
| Supply-chain pins and overrides (`eslint-config-prettier@10.1.8` / rollup OMT via `aube.overrides`) | Responses to advisories and a trust downgrade during initial setup. Full list: [../security/threat-model.md](../security/threat-model.md) §5.1 |

## Deployment and CI

| Deviation | Reason / basis |
| --- | --- |
| `_headers` carries `Cache-Control: no-cache` for `/index.html`, `/sw.js`, `/registerSW.js`, and `/manifest.webmanifest` | Keeps the service worker and manifest fresh. A managed addition to the deployment headers |
| CI runs `e2e` as a job independent of `validate` | `.github/workflows/cloudflare-pages.yml` splits validation, e2e, and deploy into three jobs; `deploy` needs both `validate` and `e2e`, so a failing e2e blocks deployment |

## Crypto and protocol

| Deviation | Reason / basis |
| --- | --- |
| Active vocabulary is the single PQ suite `ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM` plus `SymSuite` `HKDF-SHA256+A256GCM` | Owner decision, 2026-08-01 (no-compatibility purge). Removed identifiers (unsigned suites, 768/65, `balanced`, v1 prefixes, RSA) are absent from active domain unions, writes, and cryptographic and wire dispatch; there is no retained four-suite wire/codec contract. Boot deliberately accepts a stored `RSA-HYBRID` preference read-only, then repository normalization replaces it with `A256GCM`, so an old value cannot hide `wipeOnOnline=false` and force the later online-wipe path |
| ML-KEM-512 / ML-DSA-44 not implemented | Not supported, including for interoperability testing |
| `QrFrameV2.artifactType` includes `pq-kem-public-key` / `pq-dsa-public-key` / `sym-message` / `symmetric-key` | Values beyond the three of the original draft, so single public keys and the unified symmetric artifacts can be carried as frames |
| Error codes `RESET_FAILED`, `SIGNATURE_INVALID`, `SIGNING_KEY_NOT_FOUND`, `FRAME_MISMATCH`, `WORKER_UNAVAILABLE` beyond the specified set | `RESET_FAILED` carries the honest-naming policy for best-effort logical deletion — no error name may imply guaranteed erasure. The others cover signature verification failure, missing signing key, frame mismatch, and Worker unavailability |
| `VITE_DEFAULT_ALGORITHM=A256GCM` (symmetric AES-256-GCM is the default) | Maintainer requirement, 2026-07-24. The sole selectable post-quantum UI algorithm is `MLKEM1024_MLDSA87_A256GCM` |
| Symmetric messages and keys are single-frame OCF2 only | Owner decision, 2026-08-01. `MAX_SYM_PLAINTEXT_BYTES` = 853 is the accepted capacity cost of that hard constraint |

## Product surface

| Deviation | Reason / basis |
| --- | --- |
| No in-app update mechanism | Maintainer decision: after installation, devices that hold or have held protected material run offline permanently. A new version requires sanitizing the device and installing fresh |
| No in-app QR storage | Maintainer requirement, 2026-07-24. Both ciphertext and key QR codes are limited to on-screen display, PNG or frame-ZIP export, and clipboard; there is no `qrArtifacts` store in IndexedDB |
| Plaintext auto-clear defaults ON | Maintainer decision: auto-clear after successful encryption and after the app moves to the background are both default ON. The primary delay is `VITE_AUTO_CLEAR_SECONDS=60`; when the QR reader's required WebAssembly runtime is unavailable, `VITE_AUTO_CLEAR_FALLBACK_SECONDS=300` applies. Keeping plaintext for five times longer in that fallback environment is an explicitly accepted owner decision because manual payload transport requires longer trips away from the app |
| Online use limited to installation plus the clean-origin optical relay | Maintainer decision: online encryption/decryption/key-management/settings stay blocked. A fail-closed clean-origin relay may forward exact canonical OCF2 strings whose outer header declares `pq-message` or `sym-message`, and only after assembled-artifact schema validation succeeds ([../security/threat-model.md](../security/threat-model.md) T19). The hop still performs no AEAD, signature verification, or decryption. On the offline→online transition, in-memory transient data is cleared immediately |
| Replay detection is session-only | Maintainer decision, 2026-07-28. Persisting a frame- or assembled-artifact-derived receipt (ciphertext hash / message ID) would violate the no-frame-or-artifact-derived-persistence invariant ([../security/threat-model.md](../security/threat-model.md) §1 / T11 / T19) and the clean-origin boot gate. Cross-session detection remains an open security-design decision in [../security/security-review.md](../security/security-review.md) |
