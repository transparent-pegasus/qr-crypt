export const OFFLINE_ACK_PENDING_KEY = "oc-offline-ack-pending"
const OFFLINE_ACK_PENDING_VALUE = "1"

// localStorage can be unavailable even when the Storage API exists (for
// example, a denied origin). Keep the conservative state for this JS lifetime
// when persistence cannot represent a pending acknowledgement.
let sessionPending = false

function localStorageOrUndefined(): Storage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** Synchronous, fail-closed read used by DisplayGate's lazy initializer. */
export function readAckPending(): boolean {
  if (sessionPending) return true

  const storage = localStorageOrUndefined()
  if (!storage) {
    sessionPending = true
    return true
  }

  try {
    const value = storage.getItem(OFFLINE_ACK_PENDING_KEY)
    if (value === null) return false
    // Both the canonical value and malformed values require acknowledgement.
    return true
  } catch {
    sessionPending = true
    return true
  }
}

/** Establish pending state before publishing an online observation. */
export function setAckPending(): void {
  sessionPending = true
  const storage = localStorageOrUndefined()
  if (!storage) return

  try {
    storage.setItem(OFFLINE_ACK_PENDING_KEY, OFFLINE_ACK_PENDING_VALUE)
    sessionPending = false
  } catch {
    // sessionPending is the fail-closed substitute for the failed write.
  }
}

/**
 * Attempt persistent removal before accepting risk. A failed removal keeps the
 * next initialization on the acknowledgement side, while the caller may still
 * accept the current in-session generation.
 */
export function clearAckPending(): void {
  const storage = localStorageOrUndefined()
  if (!storage) {
    sessionPending = true
    return
  }

  try {
    storage.removeItem(OFFLINE_ACK_PENDING_KEY)
    sessionPending = false
  } catch {
    sessionPending = true
  }
}
