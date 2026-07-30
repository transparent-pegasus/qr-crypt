# Boot State Machine and Local Reset Contract (v2)

This document is the authoritative specification of this contract.
Implementation: `src/app/boot/*` and `src/storage/best-effort-reset.ts`.
Types and constants are frozen in `src/app/boot/boot-contract.ts`.

## 1. Separating Display Online State from Destructive Reachability

| Purpose                         | Basis                                                                                                                                | Use                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display                         | `navigator.onLine` + the existing probe (HEAD of `/manifest.webmanifest`)                                                            | Switches the OnlineGate display and requests boot reconciliation. **The display edge itself is never the basis for, or a direct trigger of, destructive operations** |
| Destructive (network-confirmed) | `GET /reachability-sentinel.txt?n=<nonce>` (`cache:"no-store"`), **confirmed only when the response body matches `QR-CRYPT-REACHABLE`** | The sole trigger of wipe-on-online                                                                                                                                   |

- The sentinel is excluded from the SW precache, served via a `NetworkOnly`
  runtime route (vite.config.ts), and delivered with
  `Cache-Control: no-store` through the Cloudflare `_headers` file. Offline it
  always fails.
- False-positive classes (probe ≠ airgap): SW interference, captive portals,
  delayed responses, StrictMode double invocation. These are absorbed by the
  sentinel body match, the nonce, generation numbers + AbortSignal, and the
  once-per-transition rule.
- While the display probe sits in a false-negative window, the InstallScreen is
  not guaranteed to keep blocking. This is a residual risk of separating the
  display judgment from the destructive judgment; the next time the display
  re-commits online, the symmetric reconciliation re-runs the sentinel check.

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
```

- Until the state reaches `offline-confirmed`, the Router, `usePreferences`,
  and the repositories are not mounted. **Only the boot controller opens the DB
  first** and reads the wipe setting and the presence of sensitive data.
- The only destructive trigger is network-confirmed. Even when the initial
  `navigator.onLine` is `true`, no wipe happens if the sentinel fails.
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
- Sentinel success first publishes a fresh immutable
  `network-confirmed { relayEligibility: "pending" }`. Only after the decision
  completes may it publish another fresh state with `eligible` or
  `ineligible`. Maintenance-token survival and `wipeOnOnline:false` with
  sensitive rows therefore publish `ineligible`; they never reuse an earlier
  state object. Every probe, offline request, destructive/terminal transition,
  and peer wipe invalidates relay eligibility.
- An eligible relay proof is re-read with the same boot scanner before a relay
  dialog opens and whenever the document becomes visible. No cross-tab
  mutation-exclusion lease is held. A second tab can therefore create a key
  after a successful proof and before the next re-check; this residual race is
  a stale policy signal, not a relay read of or disclosure from the database.
- As of 2026-07-24 the boot read-compatibility allowlist is algorithm
  (`A256GCM`, `RSA-HYBRID`, `MLKEM768_A256GCM`,
  `MLKEM768_MLDSA65_A256GCM`, `MLKEM1024_A256GCM`,
  `MLKEM1024_MLDSA87_A256GCM`) and profile (`balanced`, `maximum`).
  The allowlist is append-only so that a stored preference can never turn into
  a read failure and misfire the fail-safe above.
- The numeric read allowlists are append-only for the same reason. Active
  generated density is every 100B grid value from 100 through 1,000B; boot
  accepts every safe density integer from 100 through 1,000B, retaining every
  historical integer from 100 through 900. The generated interval set is
  every 100ms grid value from 200 through 1,000ms plus 2,000ms; boot accepts
  every safe interval integer from 150 through 3,000ms, retaining every
  historical integer from 150 through 2,000 together with 2,500 and 3,000.
  Neither boot-readable set may be narrowed when the display preference
  policy changes.
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
   localStorage keys. This includes the UI language preference (`oc-lang`) and
   the last online tab (`oc-online-tab`); after a wipe or full reset the UI
   language reverts to the English default and the online gate's tab preference
   reverts to the install screen.
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
non-sensitive but are included in the bulk `oc-*` deletion. Marker re-set
after an `online-detected` wipe follows §4 step 6; the tab preference is not
re-set.

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
| `wiped` (`online-detected`) | While the display is offline the result and the acknowledgement are shown in the same full-screen shell, and the "reload to continue" action performs a full reload. While it is online the status screen carries the result and a "return to the online page" control that performs the same full reload: the controller stays pinned in this destructive terminal state, so a new JS lifetime is the only route back to the install screen. The Router is not mounted in the current JS lifetime | Re-set after the `oc-*` deletion and before publishing `wiped`. Reloading without acknowledging shows the shell again; reloading after acknowledging is a marker-absent cold start |
| `partial-failure`           | Shows only `RESET_FAILED` plus guidance to close the tab / fully format the device; no resume path is provided                                                                           | Kept re-set as evidence of online contact                                                                                                                                          |
| `user-requested`            | Settings runs the same coordinator sequence (barrier, crypto dispose, Vault-key cache drop, transient reset, cross-tab stop, the ordered deletion above, churn, absence check). On success the app performs a full reload; on partial failure it shows a terminal `RESET_FAILED` state with the failed steps and no resume path | Not re-set after the `oc-*` deletion                                                                                                                                               |

A display offline commit issues no sentinel; only when boot is
`network-confirmed` does it request the dedicated nudge, once. When the
display re-commits online while boot is `offline-confirmed`, the BootGate
starts at most one normal sentinel probe on the same controller. A display
edge never directly fires a wipe, and neither the acknowledgement screen nor
the checkbox itself verifies or restores the safety of the device.
