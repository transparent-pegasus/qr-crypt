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
* workbox-core / workbox-precaching / workbox-routing / workbox-strategies
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
aube exec playwright install chromium webkit
aube test:e2e
aube test:e2e:relay    # relay-only bundle (dist-relay), served without _headers
```

The web suite uses Chromium. The relay suite runs its common CSP, own-file
request, no-service-worker, sym/pq playback, non-message rejection, and
close/reopen checks in both `mobile-chromium` and `webkit`. WebKit skips
three individual API cases: text and PNG clipboard readback require the
unsupported `clipboard-write` permission grant, and fake-camera capture
requires Chromium's media launch flags. The clipboard cases inject decoder
results; the camera case uses a fake source and an injected visibility event.
These checks do not measure a physical camera or native OS background behavior.

On CI, the web job installs Chromium; the relay job uses
`aube exec playwright install --with-deps chromium webkit`. The
authoritative `validate` job step list and gate behavior are maintained in
[deployment.md](deployment.md#ci-flow).

## Build

```bash
aube build:prod
aube build:relay
```

`--mode prod` loads `.env.prod`.

`aube build:relay` builds the relay-only bundle into `dist-relay/` for the
native relay shells. The build fails when any module, worker, output file or
URL origin falls outside the lists in `scripts/relay-bundle-allowlist.mjs`;
re-measure those lists when dependencies change. `dist-relay/` is never
deployed to the web origin.

## Windows native relay candidate

`native/desktop/` embeds only `dist-relay/`. Its scoped `mise.toml` pins Rust
`1.99.1` with the required `rustfmt` component; Cargo pins Tauri `2.12.5` and
tauri-build `2.7.4` and commits the resolved graph. Tauri reads the application version from the root `package.json`;
the unpublished Cargo package has no separate release version.

Build on x64 Windows with the Visual Studio C++ build tools, Windows SDK and
WebView2 installed. The maintained Windows edition/runtime requirements and
remaining evidence gates are in [the host contract](../spec/native-relay.md).
From the repository root in PowerShell:

```powershell
$env:VITE_BUILD_SHA = (git rev-parse HEAD).Trim()
mise exec -- aube run build:relay
Push-Location native/desktop
mise install
mise exec -- cargo fmt -- --check
mise exec -- cargo test --release --locked --target-dir target
mise exec -- cargo build --release --locked --target-dir target
Pop-Location
.\native\desktop\target\release\qr-crypt-relay.exe
```

Build from a clean source tree so the complete displayed SHA identifies the
candidate. `--target-dir target` keeps the documented executable path even when
the developer has a global Cargo target directory. No Tauri CLI or JavaScript
API package is needed. The executable is
a developer candidate, not an MSIX/AppContainer or store-ready package. Linux
requires GTK/WebKit development libraries and has no product support claim.

For dependency review, use cargo-audit `0.22.2` and cargo-deny `0.20.2`:

```bash
cd native/desktop
mise exec -- cargo install cargo-audit --version 0.22.2 --locked
mise exec -- cargo install cargo-deny --version 0.20.2 --locked
mise exec -- cargo metadata --locked --format-version 1
mise exec -- cargo audit
mise exec -- cargo deny --locked check
```

Review all advisory notices, target reachability, source origins, licenses and
build scripts. An exit code alone does not clear informational maintenance or
soundness notices. Do not suppress an advisory or unknown license to pass a gate.
The source/license policy is `native/desktop/deny.toml`.

The shell selects one inline capability for `main` with no IPC permissions;
Tauri's internal bridge remains. On Windows, the host forwards actual
minimize/hide/restore messages to WebView2 controller visibility. The existing
frontend hidden-state handler ends the session; restore does not request a new
session. Propagation failure terminates the process. Actual Windows OS lifecycle,
denied IPC, navigation, downloads and clipboard content still require the native
verification gate; source inspection and a browser run cannot establish them.

Tauri generates ACL inspection inputs under `native/desktop/gen/schemas/` and
`native/desktop/target/release/build/qr-crypt-relay-*/out/`. The generated
`capabilities.json` contains filesystem capabilities; the inline selection is
resolved with configuration during code generation. Inspect the effective ACL
and denied calls in the actual Windows candidate. Also retain the generated
Windows resource manifest from that build; a developer EXE does not prove
package capabilities or OS isolation.

After building the clean candidate above, execute its native tests on a dedicated
relay test device in a non-elevated PowerShell:

```powershell
$env:NATIVE_RELAY_EXE = (Resolve-Path native/desktop/target/release/qr-crypt-relay.exe).Path
mise exec -- aube exec playwright test -c playwright.native-relay.config.ts --workers=1 --retries=0
```

Keep `VITE_BUILD_SHA` equal to that checkout's full HEAD. The suite launches the
actual EXE directly. Before waiting for CDP, the PowerShell helper measures that
owned process's `TokenIntegrityLevel` RID and `TokenElevation` through its held,
path/start-validated process handle with `TOKEN_QUERY` only. `native.integrity`
must be exactly `{ rid: 8192, elevated: false }`; missing measurements fail setup,
and other values fail immediately with `NATIVE_RELAY_INTEGRITY` and the measured
values. [Elevated WebView2 hosts ignore environment overrides](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security#recommended-privilege-level-for-webview2-host-applications).
The accepted process must use its own verified WebView2 profile and test-side CDP
port. The suite replaces the test session's clipboard, reads native text/PNG
content, and minimizes, hides and
restores the same owned HWND. Hide requires an invisible, non-minimized window
and an actual hidden DOM state before checking camera teardown. CI's isolated
hide-forwarding mutation must fail the dedicated `NATIVE_RELAY_HIDE_DOM` assertion;
Windows baseline/control acceptance remains pending until both are measured.
Camera pixels are synthetic and decoded by the shipped WASM;
this does not measure a physical camera or Windows 11 client compatibility.
Non-Windows hosts and missing/mismatched candidate inputs fail setup.

[`native-relay.yml`](../../.github/workflows/native-relay.yml) builds on Windows
Server 2025, checks the compiled context and actual WebView, and retains the linked
manifest, generated ACL inputs and build hashes before runtime controls. CI alone
uses portable gsudo `2.6.1`, verifies the reviewed ZIP SHA256
`21130bf178d7b9891207f00bff56f05b6b363ce9cec7b2d084e45fb12ee51f44`
and companion checksum before extracting only `x64/gsudo.exe` into a fresh
`RUNNER_TEMP` directory, and records its exact version and actual ZIP/EXE hashes.
`--integrity Medium --direct --wait` launches the whole PowerShell/mise/aube
command; the fixture still directly owns the release EXE. The Medium child
captures stdout/stderr separately for parent readback and returns the exact child
exit code. A preceding probe requires checkout CWD, the selected mise and pinned
aube/Node, distinct stream sentinels and deliberate exit `37`. No profile import,
global install/configuration, credential cache, environment-copy option or ACL
grant is used.

An untouched-runner control selects only the existing identity case. It must
fail solely at the owned-token guard with RID `12288` and `elevated: true`, the
original source/EXE/lock identity and owned-process/requested-temp cleanup.
The elevated host may ignore the requested profile; removal of that temporary
directory does not verify or clean its unknown default WebView profile.
Then the original EXE must pass all 18 cases under measured Medium without skips
or retries. The compiled hide mutant uses the same Medium command chain and must
fail only the existing DOM-hide assertion. Both controls decode the pinned
Playwright JSON reporter's Buffer attachment from its Base64 `body`, retaining
candidate/token and cleanup evidence. Reports and separate streams live under
`.tmp/native-relay-evidence/{launcher,integrity-negative,hide-negative,medium}`,
with the ordinary HTML report under `playwright-report/native-relay`.
These gates still require actual Windows results; a launcher probe or Linux
discovery is insufficient. Medium integrity does not establish AppContainer or
compromised-OS isolation. Separate mutation
checkouts must reject permissive navigation and an added IPC permission without
replacing the tested EXE. The Linux job audits the full lock and checks the Windows
dependency graph under the strict source/license/advisory policy. Outputs are
unsigned developer artifacts; package isolation and release gates remain separate.

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
