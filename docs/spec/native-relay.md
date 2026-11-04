# Native relay host contract

[日本語](../locales/ja/spec/native-relay.md)

This contract governs the native host of `dist-relay/`, the ciphertext-only relay bundle. It is a specification for implementation, not a native release approval or a claim that every platform below is supported. The first product target is Windows; [G0r](../develop/native-spikes/g0r-20261025.md) records older feasibility measurements separately. The [wire specification](qr-protocol-v2.md), [threat model](../security/threat-model.md) and [security review](../security/security-review.md) still apply.

See the [user privacy information](../privacy/native-relay.md) and
[distribution guide and interoperability ledger](../develop/native-relay-distribution.md)
for information handling, listing drafts and still-pending publication records.

## 1. Device and edition boundary

**Do not install or use the relay on a device that holds, or has ever held, keys, identities or plaintext, including a device with a Route A PWA browser profile.** Separate application identifiers prevent accidental data sharing; they do not protect that profile from a full-trust process under the same OS user. The prohibition applies before capture, copy or paste, and must remain visible in both application languages, user documentation and each store listing.

Only the offline edition may generate/store keys or encrypt/decrypt plaintext. The native relay accepts complete canonical `sym-message` and `pq-message` ciphertext frame sets and rejects other outer artifact types. Its envelope validation is structural; it cannot authenticate a sender, inspect encrypted plaintext, or prevent an already compromised offline endpoint from hiding data in an accepted ciphertext. Independent identity confirmation remains necessary.

The relay bundle has no key repository, IndexedDB application database, boot controller, wipe, crypto worker, Service Worker or reachability probe. Build-time module and final-output allowlists enforce this composition. A local relay session has no Web Locks admission step because this bundle contains no cooperating key writer. This is not a runtime scan proving the device is clean. Never deploy `dist-relay/` to the full web application's origin, where it would bypass that application's admission gate.

The offline installation remains permanently offline and is not updated in place. Store updates are permitted only for the relay, as a residual risk: a compromised update, host, runtime or OS may access the camera, clipboard and other user data beyond the legitimate program's behavior. A relay update must remain interoperable with every authorized fixed Route A PWA release, and later every authorized native offline release. Record exact partner release hashes and each published store version. An incompatible wire change requires a separate distribution decision and sanitized fresh offline installs; do not add a legacy parser.

## 2. Origin and bundled assets

| Host | Required application origin | Evidence/status |
| --- | --- | --- |
| Tauri / Windows WebView2 | `http://tauri.localhost` | G0r observed secure context; verify again in each product candidate |
| Tauri / macOS and Linux | `tauri://localhost` | G0r only; product implementation and supported floor pending |
| Capacitor / Android | `https://localhost` | G0r only; product implementation and supported floor pending |
| Capacitor / iOS | `capacitor://localhost` | G0r only; product implementation and supported floor pending |

Use the intended platform origin without credentials, an alternative scheme, a lookalike host or a non-default port. Serve only embedded assets with correct MIME types. Secure context and bundled WASM loading must be measured in the actual host; success in an ordinary Playwright browser is not a substitute.

All executable code, styles and reader WASM come from the reviewed bundle. The reader always receives the bundled WASM locator; there is no CDN fallback. The dependency contains an inert CDN template, accepted only by the exact normalized entry in `scripts/relay-bundle-allowlist.mjs`. That entry permits a measured string in the output, not a request or an external origin. Build graph checks, final-file checks, CSP and actual request observation are separate controls.

No server content, live manifest, reachability sentinel, telemetry, updater or Service Worker is loaded. No application-level outgoing request carries relay data. Test requests after the actual native page reload and require only the expected embedded assets, without query strings or bodies. OS/runtime maintenance traffic is outside this application claim.

## 3. CSP and unavailable web response policies

The relay build derives its meta CSP from `public/_headers` through `metaCspFromHeaders()`. Tauri must not replace that policy: `app.security.csp` is null. The policy retains `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'` and `form-action 'none'`, together with the other supported directives in that source. Do not add script `unsafe-inline` or general `unsafe-eval`. The inherited `worker-src` directive is not permission to ship workers; the relay graph/output prohibition is stricter.

An unsupported WASM/CSP runtime must reach the existing visible reader failure state without retrying through a CDN or weakening CSP. Text-to-QR playback does not depend on camera readiness. The bundle also supplies `<meta name="referrer" content="no-referrer">`.

The native host does not inherit the web deployment's `_headers` file. Its narrower UI and navigation policy reduce exposure but do not recreate missing browser policies:

| Web response policy | Native contract and remaining limit |
| --- | --- |
| Permissions-Policy | Request camera only after explicit action; do not request microphone, location, USB or similar features. A prompt or native permission declaration does not reproduce the web policy. Inspect the actual package permissions. |
| COOP / CORP | One top-level application window; deny popups and external navigation. This does not establish cross-origin isolation or an equivalent CORP boundary. |
| X-Frame-Options / CSP frame-ancestors | The reviewed host creates the top-level view and no external embedded page. Meta CSP cannot enforce frame-ancestors; do not claim it does. |
| X-Content-Type-Options | Embedded assets require correct MIME types and runtime verification. Do not infer nosniff from a local file or a single window. |
| Referrer-Policy | The explicit meta policy applies to the document; verify it in the product WebView. |
| Cache-Control | Bundle bytes are embedded, but a WebView may retain profiles, caches or diagnostic data. No application storage is not a promise of no OS/runtime traces. |

## 4. Host privileges and navigation

The desktop host creates one window, `main`, and grants no application IPC permissions. Use one explicit inline capability selecting that window with an empty permissions list. In the pinned Tauri implementation, an absent or empty capabilities selection includes capability files by default; it is not a sufficient deny policy. Verify the generated effective ACL and denied calls in the real WebView. Keep the global Tauri API disabled and register no application command, plugin, updater, filesystem, network, opener or clipboard bridge. Tauri's internal IPC infrastructure still exists.

Allow navigation only to the exact platform application origin. Reject all new-window and download events. The relay UI supplies no external link, file export or share sheet. Source policy tests must cover credential, hostname, scheme and port confusion; native tests must establish the actual effect on navigation, popup and download attempts.

The Windows download gate uses the feature-gated test-only
`native-relay-download-profile` helper to prepare an exclusively owned profile and
destination through set/close/read, with source/EXE/lock/selected-host identities,
actual Medium integrity, normal helper exit/EOF and job drainage before transfer.
The selected case keeps one browser CDP session at native `default` behavior,
events enabled and no download path. Require matching canceled GUIDs and complete
empty before/final no-reparse inventories; silence is unresolved. The isolated
one-site allow control runs the same denial assertion and must instead prove a
completed GUID and the exact contained 27-byte inert payload. Retain separate
primary/cleanup failures and independently prove candidate drainage and owned
root/parent removal; uncertainty fails and retains storage. The helper is absent
from default product builds and the manual kit.

On 2026-11-05, source `ae8dffac47489823fc67d75f9c169c8548be672f` passed all
18 maintained cases and required controls on Windows Server 2025 build 26100,
WebView2 `156.0.4314.50`. The original EXE and synthetic samples are available for
Windows 11 x64 manual testing; [the evidence record](../security/security-review.md#112-windows-manual-relay-candidate-2026-11-05)
identifies the artifact and hashes. Earlier diagnostic/report and process-ownership
cleanup failures remain recorded; this success does not explain their causes.
Windows 11 physical/camera behavior, MSIX/Store readiness and offline crypto remain
unverified. The EXE still requires WebView2 Runtime.

On Windows, navigation cancellation alone can still allow a GET while the host responds. Start with a hidden `about:blank` controller, install HTTP(S) request filters for all resource contexts and source kinds, then navigate to the embedded application and show the window. Reuse the exact-origin predicate and synchronously answer foreign or malformed requests with an empty local 403 response. Failure to install or apply the guard terminates the process. The transient blank page is not an allowed application destination. Verify the actual owned sink as well as request/response evidence; a retained application page alone does not prove rejection. This content-request guard does not cover OS networking, runtime telemetry, DNS/preconnect or a compromised WebView.

These controls constrain the legitimate WebView-to-host interface. They do not remove Rust's OS privileges, sandbox a compromised runtime, or prove OS network denial. A developer EXE is not an AppContainer package. The Windows packaging phase must try AppContainer first and verify its actual capabilities and behavior; it may not silently switch to `runFullTrust`. Any required fallback needs a recorded residual-risk decision. Android's eventual merged manifest must be checked for removal of INTERNET; iOS has no equivalent general outbound-network permission to remove. Neither prospective package design is established by G0r.

Production artifacts must contain no test WebDriver plugin, report handler, extra server or test command. Test-side WebView2 CDP configuration may be supplied only through the launched process environment. Before distribution, inspect the actual package and exercise a deliberately contaminated negative fixture; source and lockfile inspection alone are insufficient.

## 5. Camera, lifecycle and clipboard

Camera capture requires an explicit action and successful preparation of the bundled reader. Apply the existing readiness deadline and failure latch before `getUserMedia`. Stop every camera track and discard the relay session on close, pagehide or becoming hidden. Cancel pending camera acquisition and playback preparation; a late completion must not reopen the session. Restore must leave the session closed and empty.

The Windows host must propagate real minimize/hide/restore to WebView visibility. Locked Tauri/Wry behavior must be checked; if it does not propagate a state, the host must set native controller visibility or close the window when propagation fails. A synthetic visibility event is only a frontend logic test. The native gate uses an OS operation on the owned window for active and pending work. Physical camera behavior remains a separate release-candidate measurement.

Clipboard writes happen only through explicit copy actions. The product does not read the clipboard; paste uses the user's ordinary input action. Clipboard contents can persist in the OS, history or synchronization services after the relay session closes. Do not claim session cleanup erases these copies.

The Windows product gate clears/seeds a known prior clipboard state before each copy, performs a trusted click, then reads the native clipboard from test code. Text must match completely; the retrieved bitmap/PNG must decode to the expected QR frame. A resolved write promise or a contains-image flag is insufficient. No product read permission/plugin may be added to make this test pass. Unavailable readback leaves the gate incomplete.

## 6. Persistence and visible identity

Application persistence is limited to the language preference `oc-lang`. Theme follows the system without writing a preference. Do not write ciphertext, frame data, keys or plaintext to IndexedDB, CacheStorage, cookies, localStorage or files. Normal memory cleanup is not forensic erasure: screenshots, swap, crash reports, keyboard/IME, clipboard history and WebView/runtime copies remain outside this guarantee.

Show the relay edition, root package version and complete `VITE_BUILD_SHA` in the application. Match that SHA to the compiled candidate and its test evidence. Distinct edition identifiers do not establish a security boundary, and a displayed hash alone does not authenticate executable bytes.

The device prohibition, ambient-camera warning and lack of independent audit must appear before every relay action. Keep English and Japanese equivalent. Do not describe the relay as nation-state-proof, independently audited or release-approved. The project remains experimental; store-facing wording must truthfully disclose the missing audit without presenting an unfinished test product as a released one.

## 7. First Windows engineering target

Checked 2026-11-05. The initial target is x64 Windows 11 build 26100 or newer, **on a Microsoft-maintained release and edition with current security updates**. On this date, Home/Pro require 25H2 or newer; Enterprise/Education may use 24H2 while it remains maintained. Require a maintained WebView2 Evergreen runtime with functional baseline major 155 or newer. These are selected engineering floors, not completed minimum-client compatibility measurements. The G0r user agent reported Edg/155; it did not measure a Windows 11 client or all qualifying releases.

The [Windows release-information table](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information) lists these servicing dates:

| Edition/release | Servicing status/date as checked |
| --- | --- |
| Home/Pro 24H2 | End of updates; excluded |
| Home/Pro 25H2 | 2027-10-12 |
| Enterprise/Education 24H2 | 2027-10-12 |

The table's ISO dates are retained as published. The separate [Home/Pro](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro) and [Enterprise/Education](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-enterprise-and-education) lifecycle pages state Pacific Time and can render timestamp/date values differently; do not silently substitute their displayed timestamps for this table. Recheck maintained status at candidate verification, not only at installation. [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) describes Evergreen servicing; an old major satisfying the numeric floor is not sufficient if it is no longer maintained.

Windows Server 2025 CI is a runner measurement, not Windows 11 client compatibility. Android, iOS, macOS and Linux product floors remain pending their own native implementation and supported-runtime checks. The historical emulator/simulator versions in G0r do not define those floors. Do not weaken CSP to extend an unverified floor.

## 8. Evidence and release gates

| Gate | Required evidence |
| --- | --- |
| Relay bundle | Frozen graph and final files; exact negative inventory cases; Chromium and WebKit common behavior; individually identified API limitations |
| Windows host | Actual release EXE hash, source and lock identity; generated ACL; exact-origin policy; native clipboard content; OS lifecycle; runtime/OS versions; synthetic-camera limitations |
| Package/distribution | Actual package permissions/plugins, no unintended listener, negative contaminated fixture, fixed-release interoperability ledger, store identity and truthful privacy/listing copy |
| Public release | The same candidate measured on real devices immediately before publication; independent review and explicit disposition of all remaining release blockers |

Preserve owner decisions: Windows Store → Android → iOS → direct PC implementation order; submissions may proceed independently when their own gates pass; no added initial spending; individual accounts; iOS CI uses macOS runners. Physical measurements are delayed until each public-release candidate and the native offline gate, not waived. If the owner or a named collaborator cannot measure a required device, postpone that platform's publication. This contract does not decide the pending native-offline wipe, packaging or runtime-assurance choices.

Classify the boundaries honestly: graph/validation/teardown are application controls; separate devices and managed camera surroundings are deployment requirements; mutable host/runtime/store supply chains are architectural residuals; physical measurements, package inspection and independent review are external assurance. None is a certification against a nation-state adversary.
