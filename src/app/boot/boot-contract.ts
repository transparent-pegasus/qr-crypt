// Boot state-machine contract; see docs/boot-and-reset-v2.md.
//
// Separation:
//   - Display connectivity: navigator.onLine + the existing reachability probe
//     (/manifest.webmanifest). This drives OnlineGate display changes and requests boot
//     reconciliation, but the display edge itself neither justifies nor directly triggers
//     destructive operations.
//   - Destructive connectivity (network-confirmed): perform a no-store GET of the dedicated
//     sentinel and confirm connectivity only after verifying that the response body matches.
//
// Once the sentinel succeeds, latch the token-consumption/wipe decision; display-offline
// nudges and generation updates must not revoke it. Recommitting display-online may normally
// start at most one sentinel probe. Before publishing network-confirmed, fail closed while
// setting the origin-persistent acknowledgement marker.
//
// Do not mount the Router, usePreferences, or any repository until the state is
// offline-confirmed. Only the boot controller opens the database first and reads the wipe
// setting and whether sensitive data exists (the wipe path provides the fail-safe behavior
// if reading preferences fails). Only network-confirmed may trigger destruction. Generation
// numbers plus AbortSignal may invalidate stale probes only before sentinel confirmation.
// Execute once per transition and remain idempotent under StrictMode's double mount.

export const REACHABILITY_SENTINEL_PATH = "/reachability-sentinel.txt"
export const REACHABILITY_SENTINEL_BODY = "QRYPT-REACHABLE"
export const WIPE_BROADCAST_CHANNEL = "qrypt-wipe"

export type BootState =
  | { kind: "unknown" }
  | { kind: "probing"; generation: number }
  | { kind: "offline-confirmed" }
  | { kind: "network-confirmed" }
  | { kind: "wiping" }
  | { kind: "wiped" }
  | { kind: "partial-failure"; failedSteps: readonly string[] }

// Do not wipe on the install-gate path, where no sensitive data exists.
// Maintenance token: set it with strong confirmation while offline; it must expire after
// one verified transition and restore wipeOnOnline=ON ("retain keys for the next update only").
export interface WipeDecisionInput {
  wipeOnOnline: boolean
  sensitiveDataExists: boolean
  maintenanceTokenArmed: boolean
}
