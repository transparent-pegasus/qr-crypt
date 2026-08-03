# Development

Everything needed to build, run, and test QR Crypt locally. Product-level usage lives in
the [README](../../README.md).

## Documentation languages

English is the source of record under `docs/` (and the root `README.md`). Translations of
docs live under `docs/locales/<lang>/` with the same relative path as the English file —
for example `docs/locales/ja/develop/install-route-a/README.md` mirrors
`docs/develop/install-route-a/README.md`. Each English document that has a translation
links to it; translations link back to English. The product README translation stays at
the repository root as `README.ja.md` (GitHub language switcher).

## Tech stack

* React / React DOM / React Router
* Vite / TypeScript / Tailwind CSS v4
* shadcn/ui (Radix UI) + sonner
* Web Crypto API / IndexedDB (idb)
* Zod / qrcode / zxing-wasm (reader-only, camera scanning); v2 wire CBOR is the
  in-house canonical codec in `src/crypto/pq/canonical-cbor.ts` (no `cbor-x`)
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

npm is forbidden in this repository; every Node execution goes through `aube`.

## Initial setup

```bash
git clone <repository-url>
cd qr-crypt
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

Reference bench numbers from the maintainer's machine are recorded in
[browser-matrix.md](browser-matrix.md).

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

On CI, `aube exec playwright install --with-deps chromium` is used. The validate job also
runs `test:pq-vectors` / `test:pq` / `test:qr-multipart`.

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
* `VITE_ENABLE_RSA`, `VITE_REQUIRE_SIGNATURE`, and `VITE_DEFAULT_PQ_PROFILE` are
  **retired and rejected**. Their presence in the environment — including the
  false/default values `.env.example` and `.env.prod` once carried — fails
  environment validation at application startup, rather than being accepted and
  normalized away. Delete those lines from any `.env.local` still holding them.
  The rejection is a startup check, not a build check: `aube build:prod` still
  succeeds with a stale value and embeds it, so a build that carries one fails
  for every user instead of failing in CI

## Pre-release checklist

Before any production-grade release or `release-approved` determination, work through
[../security/security-review.md](../security/security-review.md) §3, and check the current
blockers recorded in §1 of the same document.
