# Boot State Machine and Local Reset Contract (v2)

This document is the authoritative specification of this contract.
Implementation: `src/app/boot/*` and `src/storage/best-effort-reset.ts`.
Types and constants are frozen in `src/app/boot/boot-contract.ts`.

## 1. Separating Display Online State from Destructive Reachability

| Purpose                         | Basis                                                                                                                                | Use                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display                         | `navigator.onLine` + the existing probe (HEAD of `/manifest.webmanifest`)                                                            | Switches the OnlineGate display and requests boot reconciliation. **The display edge itself is never the basis for, or a direct trigger of, destructive operations** |
| Destructive (network-confirmed) | `GET /reachability-sentinel.txt?n=<nonce>` (`cache:"no-store"`), **confirmed only when the response body matches `QR-CRYPT-REACHABLE`** | The sole trigger of wipe-on-online                                                                                                                                   |
| Non-destructive lock (`blocked`) | The connectivity hint (`navigator.onLine`, three-valued: only an explicit `false` reads as `offline`) and the deployment verdict taken from the same sentinel response | Refuses to mount the Router. **Never wipes, never writes, never deletes** |

- The sentinel is excluded from the SW precache, served via a `NetworkOnly`
  runtime route (vite.config.ts), and delivered with
  `Cache-Control: no-store` through the Cloudflare `_headers` file. Offline it
  always fails.
- False-positive classes (probe ≠ airgap): SW interference, captive portals,
  delayed responses, StrictMode double invocation. These are absorbed by the
  sentinel body match, the nonce, generation numbers + AbortSignal, and the
  once-per-transition rule.
- Both probes are same-origin, so under Route A they both fail permanently once
  the install server is stopped. The app therefore cannot observe a later
  network reconnection from its own origin, and `navigator.onLine` is the only
  remaining signal. That signal locks; it never wipes. See §2.1.
- While the display probe sits in a false-negative window, the InstallScreen is
  not guaranteed to keep blocking. The connectivity gate in §2.1 is what stops
  that window from opening the Router; the next time the display re-commits
  online, the symmetric reconciliation re-runs the sentinel check.

## 2. Boot State Machine (Ahead of the Router)

```
unknown → probing → offline-confirmed
                  → network-confirmed(pending)
                       → network-confirmed(eligible | ineligible)
                       → wiping → wiped | partial-failure
                       ↘ offline-confirmed (display offline nudge;
                          only after non-destructive post-commit processing
                          has completed)
offline-confirmed -- display online re-commit --> probing (at most once)

any non-terminal state → blocked(network-suspected | deployment-unverified)
blocked → (nothing; reload only)
```

- Until the state reaches `offline-confirmed`, the Router, `usePreferences`,
  and the repositories are not mounted. **Only the boot controller opens the DB
  first** and reads the wipe setting and the presence of sensitive data.
- `offline-confirmed` is an invariant, not merely a probe outcome: publishing it
  asserts that connectivity was proven absent **and** that the deployment
  verdict for this origin passed.
- The only destructive trigger is network-confirmed. Even when the initial
  `navigator.onLine` is `true`, no wipe happens if the sentinel fails.

### 2.1 The single offline-publication gate and the `blocked` latch

`offline-confirmed` has four possible publication paths — the sentinel-failure
branch, the post-commit continuation, the display-offline nudge, and an
`offline` event delivered while probing. All four go through one gate. Gating
only the sentinel branch would leave the display-offline nudge as a live bypass:
stopping the install server while the network stays up makes the display probe
fail, and the nudge would otherwise publish `offline-confirmed` without ever
re-consulting the sentinel.

The gate publishes `offline-confirmed` only when both hold:

1. the connectivity hint is exactly `"offline"` — a missing `navigator`, a
   throwing getter, or any value that is not a boolean resolves to
   `"indeterminate"` and locks;
2. the deployment verdict for this episode, or failing that the persisted one,
   is `pass`. An absent verdict refuses.

Otherwise the controller latches `blocked` with the corresponding reason.
`blocked` is terminal for the JavaScript lifetime: `emit` refuses to leave it,
and `probe` / `start` / `stop` / `release` / the online and offline handlers all
guard on it. There is deliberately no in-app recovery affordance — a retry
button would let an operator click past the only connectivity signal the app
has. A page reload is the sole exit.

Entering `blocked` engages the runtime access barrier, disposes the PQ crypto
clients, drops the Vault key cache and receipts, and broadcasts a
non-destructive quarantine request to peer tabs. **It does not itself begin any
IndexedDB read, write, or delete.** (That is not the same as claiming the
session never touched IndexedDB: arriving from `network-confirmed` means
`readBootDecision` already ran.)

`navigator.onLine === false` is not proof of a physical air gap. It reduces
false negatives under an honest browser; a compromised OS or browser can fake
both the value and the events. Physical disconnection remains the requirement.

### 2.2 Deployment verdict

The reachability sentinel is the only route excluded from the service worker, so
its response is the one response guaranteed to come from the real server rather
than the precache. The same response the destructive probe already fetches is
checked against the policy extracted from `public/_headers` at build time: the
seven `/*` security headers, the sentinel's own `Cache-Control: no-store`, a
`text/plain` content type, status 200, not redirected, and the expected
same-origin URL. The verdict is persisted once under the
`deployment-verdict` app-metadata key and read back in the same transaction as
the wipe decision.

**Scope limit.** This detects an honest server that ignores `_headers`. It does
**not** prove the top-level navigation response carries the same headers — a
per-path misconfiguration, or a hostile server, can serve the sentinel correctly
and `/index.html` incorrectly. An independent, pre-provisioned deployment
checker remains required.
- A preferences read failure is recorded as `preferencesReadFailed=true` and
  forces `wipeOnOnline=true`. However, the destructive operation additionally
  requires independent confirmation that at least one of keys /
  `pqIdentities` / the Vault key exists; a DB open/count/lookup failure alone
  must never be taken as evidence of sensitive data and used to trigger a
  reset.
- Relay authorization uses a separate fail-closed proof:
  `cleanOrigin = confirmed-clean | dirty | indeterminate`. The boot controller
  reads `keys`, `pqIdentities`, the Vault-key metadata, the maintenance token,
  and preferences in one read-only transaction. DB-open failure, an unusable
  DB, any required missing store, a count/get failure, or transaction failure
  yields `indeterminate`. Only `confirmed-clean` can authorize the relay;
  `dirty` and `indeterminate` are identical at the UI boundary.
- That read is taken under an origin-wide exclusion, not concurrently with the
  sentinel. The controller holds the `qr-crypt-sensitive-write` Web Lock
  exclusively across the read, the maintenance-token consumption, and the
  publication of `eligible` / `ineligible`; every operation that can bring
  sensitive data into existence — saving or rotating a key record, saving or
  rotating a PQ identity, creating the Vault key, and symmetric key generation
  through to its write — holds the same lock shared. A snapshot taken while a
  writer is running proves nothing, so the exclusion is what makes it a proof.
  The wipe runs outside the hold: it is long, and relay eligibility is already
  invalidated before it starts. Where the platform exposes no Web Locks the
  exclusion was never held, so the relay is denied; the wipe decision is still
  made from the same read.
- The exclusive request is bounded at `SENSITIVE_WRITE_EXCLUSION_TIMEOUT_MS`
  (3 s). Origin-wide cuts both ways: a frozen tab or a hung transaction anywhere
  in the origin can hold the lock shared indefinitely, and the wipe decision is
  taken inside the hold, so an unbounded request would let any tab pin a
  key-holding device that has already reached the network. Waiting forever and
  deciding nothing is the one outcome worse than a denied relay. On timeout — or
  on any rejection raised before the hold begins — the decision is taken with
  the exclusion unproved: the relay is denied and the wipe still runs.
- Sentinel success first publishes a fresh immutable
  `network-confirmed { relayEligibility: "pending" }`. Only after the decision
  completes may it publish another fresh state with `eligible` or
  `ineligible`. Maintenance-token survival and `wipeOnOnline:false` with
  sensitive rows therefore publish `ineligible`; they never reuse an earlier
  state object. Every probe, offline request, destructive/terminal transition,
  and peer wipe invalidates relay eligibility.
- An eligible relay proof is re-read with the same boot scanner before a relay
  dialog opens and whenever the document becomes visible, and each re-read is
  taken under the same exclusive hold. The lease covers the proof, not the
  relay session that follows it: a second tab can still create a key after a
  successful proof and before the next re-check, so that residual race remains
  — narrowed from "any write racing the proof" to "a write beginning after
  eligibility was published". It is a stale policy signal, not a relay read of
  or disclosure from the database.
- The active preference and write vocabulary has two algorithms:
  `A256GCM` and `MLKEM1024_MLDSA87_A256GCM`. Boot deliberately has one
  read-only exception: its `defaultAlgorithm` allowlist also accepts the
  retired `RSA-HYBRID` identifier. The normal preferences repository drops
  that value and uses the `A256GCM` default, but boot must first preserve a
  stored `wipeOnOnline:false`. Treating the row as unreadable would set
  `preferencesReadFailed=true`, force `wipeOnOnline=true`, and allow a later
  network-confirmed contact to wipe user data. Nothing can write or select
  `RSA-HYBRID`, and no RSA key or crypto path is retained.
- Other retired algorithm values, including `MLKEM768_*` and
  `MLKEM1024_A256GCM`, are not boot-readable. The removed
  `defaultPqProfile` and `requireSignature` fields are no longer preferences;
  boot does not interpret unknown fields, and the repository omits them while
  merging recognized values over current defaults. Thus a historical
  `defaultPqProfile: "balanced"` field does not restore that profile and does
  not by itself endanger a stored `wipeOnOnline:false`.
- The numeric density and interval read allowlists remain append-only. Active
  generated density is every 100B grid value from 100 through 1,000B; boot
  accepts every safe density integer from 100 through 1,000B, retaining every
  historical integer from 100 through 900. The generated interval set is
  every 100ms grid value from 200 through 1,000ms plus 2,000ms; boot accepts
  every safe interval integer from 150 through 3,000ms, retaining every
  historical integer from 150 through 2,000 together with 2,500 and 3,000.
  Neither numeric boot-readable set may be narrowed when the display preference
  policy changes — narrowing them would make older stored preferences
  unreadable and force `wipeOnOnline`.
- Boot only decides whether the stored row is readable. When the normal
  preferences repository later loads that row, it preserves the exact default
  1,000B/200ms pair and the exact user-selected compatible 100B/2,000ms pair.
  Every other boot-readable historical combination — including independently
  admitted values, off-grid values, or either missing member — is
  canonicalized to the default pair before strict validation. The append-only
  read ranges and per-field historical normalization paths stay in place even
  though the compatibility switch has only two positions. Thus no historical
  stored preference becomes unreadable, `preferencesReadFailed` remains false,
  and this field alone cannot force `wipeOnOnline=true`.
- The compatibility switch itself — exact pairs, atomic write, per-artifact
  clamp, and dwell-not-cadence — is owned by
  [qr-protocol-v2.md](qr-protocol-v2.md) §6. Boot only applies the
  canonicalization rule above; environment values remain strict admitted-set
  inputs.
- Once the sentinel body matches, the destructive decision is latched. A
  subsequent offline request does not cancel maintenance-token consumption, a
  transient reset, or a wipe whose conditions are met. Generation numbers and
  AbortSignal can invalidate a probe only before the sentinel is confirmed.

## 3. Trigger Conditions (Owner Requirement: Keep the Default ON)

`Preferences.wipeOnOnline` defaults to **true**. However:

1. On the install-gate path (no sensitive data present at all) no wipe occurs.
2. Only network-confirmed (sentinel body match) fires the wipe.
3. **maintenance token**: set offline with strong confirmation, meaning "keep
   the keys for the next single update only". It always expires after one
   verified transition and reverts to ON.
4. Turning the setting permanently OFF always shows a warning.

## 4. WipeCoordinator Order (Single Instance, Owned by the Boot Layer)

0. Synchronously invoke the relay's one idempotent `endSession` handle. It
   aborts pending camera startup, stops a live scan handle, cancels relay
   lifetime/display work, detaches the video, and releases app references
   before the barrier. A peer broadcast performs this as its first action.
1. Fail-close all new UI/crypto/storage operations (subsequent
   repository/worker calls error immediately).
2. Cancel/terminate the Workers by disposing every registered PQ crypto
   client, then drop the Vault key cache, the session receipt cache
   (`clearReceipts` in `src/features/receipt-cache.ts`), and the promise
   references. Worker-owned seed/plaintext/sharedSecret buffers are zeroized
   inside the Worker itself; the app keeps no registry of page-side byte
   buffers, because page plaintext lives in JavaScript strings, which cannot
   be zeroized.
3. Hide and reset transient/SensitiveSession state.
4. Request stop/close in all tabs via `navigator.locks` (with a fallback) +
   `BroadcastChannel("qr-crypt-wipe")`.
5. **Delete the `EncryptedSecret` records under the Vault first → then delete
   the Vault key record** (crypto-shredding; overwriting the bytes of a
   non-extractable `CryptoKey` is impossible and is not claimed).
6. Delete all DBs (including `pqIdentities`/`pqPublicBundles`) + all `oc-*`
   localStorage keys. This includes the UI language (`oc-lang`), theme
   (`oc-theme`), and last online tab (`oc-online-tab`) preferences; after a wipe
   or full reset, the language reverts to English, the theme reverts to the
   `system` default, and the online gate's tab preference reverts to the install
   screen.
   Only in the `online-detected` case, re-set `oc-offline-ack-pending="1"`
   after the deletion and before publishing `wiped`. In the `user-requested`
   case it is not re-set.
7. Re-verify DB absence and keep the barrier in place.
   `deleteDB({blocked})`/`openDB({blocking,blocked})` carry a timeout + UI.
   Partial failure is never presented with success wording; it is surfaced as
   `RESET_FAILED`.

The display-online status edge is not a destructive trigger, but a
display-offline edge synchronously invokes the same relay `endSession` handle
and removes relay eligibility. React unmount remains a secondary cleanup path,
not the ordering proof for camera teardown.

## 5. Honest Naming and Wording (Forbidden: "secure erase" / "permanent deletion")

- The module is named `best-effort-reset`. The UI/README/threat-model wording
  is: "**Attempts best-effort logical deletion of local data. Physical erasure
  is not guaranteed** (LevelDB is append-only; SSD wear leveling)." Even a
  full device format does not guarantee erasure on flash/SSD media; when
  assurance matters, use a media-appropriate sanitization procedure
  (e.g. NIST SP 800-88) or destroy the media.
- churn (`resetChurnMb`) is an experimental option with a **default of 0**
  (overwriting is not an erasure guarantee). It comes with idle/quota
  caps/AbortSignal/failure recording. The completion message states that
  best-effort logical deletion was attempted and that physical erasure is not
  guaranteed.
- The SW cache (the app shell itself, non-sensitive) is kept.

## 6. Defensive Boundary (Stated in the threat-model / UI)

This feature is "**reduction of residual data in the case where the current
(trusted) code was able to run after connectivity**"; it does not defend
against: malicious same-origin code, physical recovery (disk imaging), or
compromised code that runs first through an update. The theme (`oc-theme`), the
last online tab (`oc-online-tab`, `top`/`relay`), and the
pending-acknowledgement marker (`oc-offline-ack-pending="1"`) are
non-sensitive but are included in the bulk `oc-*` deletion. §4 step 6; the tab
preference is not re-set.

## 7. Display-Only Offline Acknowledgement Phase and the Persistent Marker

Exactly one display-only ack phase sits outside the BootState and the one-way
barrier of §4 (under AppProviders). The initial `navigator.onLine` remains a
hint only; the generation advances on each online→offline edge after the
display probe has committed online. Before the display-online state commit and
before boot publishes `network-confirmed`, a synchronous API sets the
origin-scoped `oc-offline-ack-pending="1"`. The value expresses only that the
explanation shown after an online contact has not yet been acknowledged; it is
a non-sensitive control state containing no keys, plaintext, or ciphertext.

The marker is read synchronously in the DisplayGate's lazy initializer. `"1"`,
malformed values, read exceptions, and unavailable storage are all treated as
pending (fail-closed), and the initial phase is
`coldOffline:false, ackPending:true, offlineGeneration:1`. Until
acknowledgement, neither the Router, child effects, nor
preferences/repositories are mounted. Only a true cold offline start with the
marker absent is exempt, as before.

On acknowledgement, marker deletion is attempted first, and the
acknowledgement for that generation in the current tab takes effect regardless
of whether the deletion succeeds. A failed deletion keeps the next run on the
pending side. A storage removal event from another tab does not clear the
current tab's in-progress pending. Persistent acknowledgement is per origin,
while the in-tab generation remains per tab as before; under contention,
redundant re-acknowledgement is allowed but skipping acknowledgement is not.

| boot / wipe outcome         | Behavior after an offline edge / reload                                                                                                                                                  | Marker                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no wipe                     | The Router is mounted only after the per-generation acknowledgement                                                                                                                      | Deletion attempted on acknowledgement                                                                                                                                              |
| `wiped` (`online-detected`) | While the display is offline the result and the acknowledgement are shown in the same full-screen shell, and the "reload to continue" action performs a full reload. While it is online the status screen carries the result and a "return to the online page" control that performs the same full reload: the controller stays pinned in this destructive terminal state, so a new JS lifetime is the only route back to the install screen. The Router is not mounted in the current JS lifetime | §4 step 6 |
| `partial-failure`           | Shows only `RESET_FAILED` plus guidance to close the tab / fully format the device; no resume path is provided                                                                           | Kept re-set as evidence of online contact                                                                                                                                          |
| `user-requested`            | Settings runs the §4 sequence. On success the app performs a full reload; on partial failure it shows a terminal `RESET_FAILED` state with the failed steps and no resume path | Not re-set (§4 step 6) |

A display offline commit issues no sentinel; only when boot is
`network-confirmed` does it request the dedicated nudge, once. When the
display re-commits online while boot is `offline-confirmed`, the BootGate
starts at most one normal sentinel probe on the same controller. A display
edge never directly fires a wipe, and neither the acknowledgement screen nor
the checkbox itself verifies or restores the safety of the device.
