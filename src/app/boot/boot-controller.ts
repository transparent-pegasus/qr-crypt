import type { BestEffortResetReport } from "@/storage/best-effort-reset"
import { AppError } from "@/crypto/errors"
import { wipeOnOnline } from "@/app/boot/wipe-coordinator"
import {
  REACHABILITY_SENTINEL_BODY,
  REACHABILITY_SENTINEL_PATH,
  type BootState,
  type WipeDecisionInput,
} from "@/app/boot/boot-contract"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  RESET_CHURN_MB_MAX,
  RESET_CHURN_MB_MIN,
  TRANSFER_TIMEOUT_MINUTES_MAX,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { getDb } from "@/storage/database"

export const BOOT_PROBE_TIMEOUT_MS = 3_000
export const MAINTENANCE_TOKEN_METADATA_KEY = "maintenance-token"

const PREFERENCES_KEY = "preferences"
const VAULT_KEY_METADATA_KEY = "vault-key"
const STORE_KEYS = "keys"
const STORE_PREFERENCES = "preferences"
const STORE_APP_METADATA = "appMetadata"
const STORE_PQ_IDENTITIES = "pqIdentities"

interface BootStore {
  get(key: IDBValidKey): Promise<unknown>
  put(value: unknown): Promise<IDBValidKey>
  delete(key: IDBValidKey): Promise<void>
}

interface BootTransaction {
  store: BootStore
  done: Promise<void>
}

interface BootDatabase {
  objectStoreNames: DOMStringList
  count(storeName: string): Promise<number>
  get(storeName: string, key: IDBValidKey): Promise<unknown>
  transaction(storeName: string, mode: "readwrite"): BootTransaction
}

interface MetadataRow {
  key: string
  value: unknown
}

interface MaintenanceToken {
  armedAt: number
}

export interface BootDecisionSnapshot extends WipeDecisionInput {
  resetChurnMb: number
  preferencesReadFailed: boolean
}

export interface SentinelProbeOptions {
  fetchImpl?: typeof fetch
  nonce?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface WipeExecutionArgs {
  reason: "online-detected"
  resetChurnMb: number
  resetTransient: () => void
}

export type WipeExecutor = (args: WipeExecutionArgs) => Promise<BestEffortResetReport>

export interface BootControllerOptions {
  consumeMaintenanceToken?: () => Promise<boolean>
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">
  fetchImpl?: typeof fetch
  nonce?: () => string
  performWipe?: WipeExecutor
  probeTimeoutMs?: number
  readDecision?: () => Promise<BootDecisionSnapshot>
}

export interface BootController {
  acquire(): void
  addTransientResetHandler(handler: () => void): () => void
  getState(): BootState
  probe(): Promise<void>
  release(): void
  start(): void
  stop(): void
  subscribe(listener: () => void): () => void
}

const FALLBACK_DECISION: BootDecisionSnapshot = {
  wipeOnOnline: true,
  sensitiveDataExists: false,
  maintenanceTokenArmed: false,
  resetChurnMb: 0,
  preferencesReadFailed: true,
}

let fallbackNonce = 0

function sentinelNonce(): string {
  if (globalThis.crypto?.getRandomValues) {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(2))
    return Array.from(values, (value) => value.toString(36)).join("")
  }
  fallbackNonce += 1
  return `${Date.now().toString(36)}-${fallbackNonce.toString(36)}`
}

function abortError(): DOMException {
  return new DOMException("Boot reachability probe aborted", "AbortError")
}

/**
 * Destructive reachability probe. The display-only reachability helper is
 * deliberately not used here.
 */
export async function probeNetworkSentinel(
  options: SentinelProbeOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== "function") return false

  const timeoutMs = Math.max(0, options.timeoutMs ?? BOOT_PROBE_TIMEOUT_MS)
  const controller = new AbortController()
  let rejectOnAbort: ((reason: DOMException) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject
  })
  const abort = () => controller.abort()
  const rejectAbort = () => rejectOnAbort?.(abortError())

  if (options.signal?.aborted) return false
  options.signal?.addEventListener("abort", abort, { once: true })
  controller.signal.addEventListener("abort", rejectAbort, { once: true })
  const timeoutId = setTimeout(abort, timeoutMs)

  try {
    const nonce = options.nonce ?? sentinelNonce()
    const response = await Promise.race([
      fetchImpl(`${REACHABILITY_SENTINEL_PATH}?n=${encodeURIComponent(nonce)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      }),
      aborted,
    ])
    if (response.status !== 200) return false
    return (await Promise.race([response.text(), aborted])) === REACHABILITY_SENTINEL_BODY
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener("abort", abort)
    controller.signal.removeEventListener("abort", rejectAbort)
    rejectOnAbort = undefined
  }
}

function hasStore(database: BootDatabase, storeName: string): boolean {
  return database.objectStoreNames.contains(storeName)
}

async function confirmedRowsExist(
  database: BootDatabase,
  storeName: string,
): Promise<boolean> {
  if (!hasStore(database, storeName)) return false
  try {
    return (await database.count(storeName)) > 0
  } catch {
    return false
  }
}

function maintenanceToken(value: unknown): MaintenanceToken | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const armedAt = (value as Partial<MaintenanceToken>).armedAt
  return typeof armedAt === "number" && Number.isFinite(armedAt) && armedAt >= 0
    ? { armedAt }
    : undefined
}

function metadataValue(row: unknown): unknown {
  if (typeof row !== "object" || row === null || !("value" in row)) return undefined
  return (row as MetadataRow).value
}

function validResetChurnMb(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= RESET_CHURN_MB_MIN &&
    value <= RESET_CHURN_MB_MAX
  )
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean"
}

function optionalIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum)
  )
}

function storedPreferencesAreReadable(value: Record<string, unknown>): boolean {
  const algorithms = [
    "A256GCM",
    "RSA-HYBRID",
    "MLKEM768_A256GCM",
    "MLKEM768_MLDSA65_A256GCM",
  ]
  const profiles = ["balanced", "maximum"]
  const correctionLevels = ["L", "M", "Q", "H"]
  return (
    (value.defaultAlgorithm === undefined ||
      algorithms.includes(value.defaultAlgorithm as string)) &&
    (value.defaultPqProfile === undefined ||
      profiles.includes(value.defaultPqProfile as string)) &&
    optionalBoolean(value.requireSignature) &&
    (value.qrErrorCorrection === undefined ||
      correctionLevels.includes(value.qrErrorCorrection as string)) &&
    optionalBoolean(value.autoClearPlaintextAfterEncrypt) &&
    optionalBoolean(value.backgroundClearEnabled) &&
    optionalIntegerInRange(value.frameBytes, FRAME_BYTES_MIN, FRAME_BYTES_MAX) &&
    optionalIntegerInRange(
      value.frameIntervalMs,
      FRAME_INTERVAL_MS_MIN,
      FRAME_INTERVAL_MS_MAX,
    ) &&
    optionalIntegerInRange(
      value.transferTimeoutMinutes,
      TRANSFER_TIMEOUT_MINUTES_MIN,
      TRANSFER_TIMEOUT_MINUTES_MAX,
    ) &&
    optionalBoolean(value.wipeOnOnline) &&
    (value.resetChurnMb === undefined || validResetChurnMb(value.resetChurnMb))
  )
}

/** Read only the fields needed before repositories and Router may mount. */
export async function readBootDecision(): Promise<BootDecisionSnapshot> {
  let database: BootDatabase
  try {
    database = (await getDb()) as unknown as BootDatabase
    if (!database?.objectStoreNames) return { ...FALLBACK_DECISION }
  } catch {
    // Without a confirmed sensitive row, a storage-open failure cannot trigger
    // destructive reset. Preference handling still remains fail-safe.
    return { ...FALLBACK_DECISION }
  }

  const keysExist = await confirmedRowsExist(database, STORE_KEYS)
  const pqIdentitiesExist = await confirmedRowsExist(database, STORE_PQ_IDENTITIES)

  let vaultKeyExists = false
  let maintenanceTokenArmed = false
  if (hasStore(database, STORE_APP_METADATA)) {
    try {
      vaultKeyExists =
        (await database.get(STORE_APP_METADATA, VAULT_KEY_METADATA_KEY)) !== undefined
    } catch {
      // A failed lookup is not evidence that sensitive data exists.
    }
    try {
      const row = await database.get(STORE_APP_METADATA, MAINTENANCE_TOKEN_METADATA_KEY)
      maintenanceTokenArmed = maintenanceToken(metadataValue(row)) !== undefined
    } catch {
      // Unreadable tokens are intentionally treated as absent.
    }
  }

  let wipeOnOnline = true
  let resetChurnMb = 0
  let preferencesReadFailed = false
  if (hasStore(database, STORE_PREFERENCES)) {
    try {
      const row = await database.get(STORE_PREFERENCES, PREFERENCES_KEY)
      if (row !== undefined) {
        const value = metadataValue(row)
        if (typeof value !== "object" || value === null) {
          preferencesReadFailed = true
        } else {
          const stored = value as Record<string, unknown>
          if (!storedPreferencesAreReadable(stored)) preferencesReadFailed = true
          if (stored.wipeOnOnline !== undefined) {
            if (typeof stored.wipeOnOnline === "boolean") {
              wipeOnOnline = stored.wipeOnOnline
            } else {
              preferencesReadFailed = true
            }
          }
          if (stored.resetChurnMb !== undefined) {
            if (validResetChurnMb(stored.resetChurnMb)) {
              resetChurnMb = stored.resetChurnMb
            } else {
              preferencesReadFailed = true
            }
          }
        }
      }
    } catch {
      preferencesReadFailed = true
    }
  } else {
    preferencesReadFailed = true
  }

  if (preferencesReadFailed) wipeOnOnline = true

  return {
    wipeOnOnline,
    sensitiveDataExists: keysExist || vaultKeyExists || pqIdentitiesExist,
    maintenanceTokenArmed,
    resetChurnMb,
    preferencesReadFailed,
  }
}

function appMetadataTransaction(database: BootDatabase): BootTransaction {
  if (!hasStore(database, STORE_APP_METADATA)) throw new AppError("STORAGE_FAILED")
  return database.transaction(STORE_APP_METADATA, "readwrite")
}

/** Storage API for WP-14's strongly-confirmed offline settings flow. */
export async function armMaintenanceToken(armedAt = Date.now()): Promise<void> {
  if (!Number.isFinite(armedAt) || armedAt < 0) throw new AppError("STORAGE_FAILED")
  if (typeof navigator !== "undefined" && navigator.onLine) {
    throw new AppError("STORAGE_FAILED")
  }
  const database = (await getDb()) as unknown as BootDatabase
  const transaction = appMetadataTransaction(database)
  await transaction.store.put({
    key: MAINTENANCE_TOKEN_METADATA_KEY,
    value: { armedAt },
  } satisfies MetadataRow)
  await transaction.done
}

export async function readMaintenanceToken(): Promise<MaintenanceToken | undefined> {
  try {
    const database = (await getDb()) as unknown as BootDatabase
    if (!hasStore(database, STORE_APP_METADATA)) return undefined
    const row = await database.get(STORE_APP_METADATA, MAINTENANCE_TOKEN_METADATA_KEY)
    return maintenanceToken(metadataValue(row))
  } catch {
    return undefined
  }
}

/** Atomically verifies and consumes a valid one-shot maintenance token. */
export async function consumeMaintenanceToken(): Promise<boolean> {
  try {
    const database = (await getDb()) as unknown as BootDatabase
    const transaction = appMetadataTransaction(database)
    const row = await transaction.store.get(MAINTENANCE_TOKEN_METADATA_KEY)
    if (maintenanceToken(metadataValue(row)) === undefined) {
      await transaction.done
      return false
    }
    await transaction.store.delete(MAINTENANCE_TOKEN_METADATA_KEY)
    await transaction.done
    return true
  } catch {
    return false
  }
}

const defaultWipeExecutor: WipeExecutor = wipeOnOnline

function safeDecision(
  readDecision: () => Promise<BootDecisionSnapshot>,
): Promise<BootDecisionSnapshot> {
  return readDecision().catch(() => ({ ...FALLBACK_DECISION }))
}

export function createBootController(
  options: BootControllerOptions = {},
): BootController {
  const listeners = new Set<() => void>()
  const transientResetHandlers = new Set<() => void>()
  const readDecision = options.readDecision ?? readBootDecision
  const consumeToken = options.consumeMaintenanceToken ?? consumeMaintenanceToken
  const performWipe = options.performWipe ?? defaultWipeExecutor
  const eventTarget =
    options.eventTarget ?? (typeof window === "undefined" ? undefined : window)

  let state: BootState = { kind: "unknown" }
  let generation = 0
  let activeProbe: AbortController | undefined
  let started = false
  let consumerCount = 0
  let releaseGeneration = 0
  let networkTransitionHandled = false

  const emit = (nextState: BootState) => {
    state = nextState
    for (const listener of listeners) listener()
  }

  const resetTransient = () => {
    for (const handler of transientResetHandlers) {
      try {
        handler()
      } catch {
        // Resetting every remaining handler is more important than one UI error.
      }
    }
  }

  const isDestructiveTerminal = () =>
    state.kind === "wiping" || state.kind === "wiped" || state.kind === "partial-failure"

  const probe = async (): Promise<void> => {
    if (isDestructiveTerminal()) return
    const probeGeneration = ++generation
    activeProbe?.abort()
    const controller = new AbortController()
    activeProbe = controller
    emit({ kind: "probing", generation: probeGeneration })

    const decisionPromise = safeDecision(readDecision)
    const configuredNonce = options.nonce?.()
    const confirmed = await probeNetworkSentinel({
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(configuredNonce !== undefined ? { nonce: configuredNonce } : {}),
      signal: controller.signal,
      ...(options.probeTimeoutMs !== undefined
        ? { timeoutMs: options.probeTimeoutMs }
        : {}),
    })
    const decision = await decisionPromise

    if (probeGeneration !== generation || controller.signal.aborted) return
    activeProbe = undefined
    if (!confirmed) {
      networkTransitionHandled = false
      emit({ kind: "offline-confirmed" })
      return
    }

    networkTransitionHandled = true
    emit({ kind: "network-confirmed" })

    if (decision.maintenanceTokenArmed) {
      const tokenConsumed = await consumeToken()
      if (probeGeneration !== generation) return
      if (tokenConsumed) {
        resetTransient()
        return
      }
    }
    if (!decision.sensitiveDataExists || !decision.wipeOnOnline) {
      resetTransient()
      return
    }

    emit({ kind: "wiping" })
    try {
      const report = await performWipe({
        reason: "online-detected",
        resetChurnMb: decision.resetChurnMb,
        resetTransient,
      })
      emit(
        report.ok
          ? { kind: "wiped" }
          : { kind: "partial-failure", failedSteps: report.failedSteps },
      )
    } catch {
      emit({ kind: "partial-failure", failedSteps: ["reset"] })
    }
  }

  const handleOnline = () => {
    if (networkTransitionHandled || isDestructiveTerminal()) return
    void probe()
  }

  const handleOffline = () => {
    if (isDestructiveTerminal()) return
    networkTransitionHandled = false
    if (state.kind === "network-confirmed") {
      activeProbe?.abort()
      activeProbe = undefined
      generation += 1
      emit({ kind: "offline-confirmed" })
      return
    }
    if (state.kind === "probing") void probe()
  }

  const start = () => {
    if (started || isDestructiveTerminal()) return
    started = true
    eventTarget?.addEventListener("online", handleOnline)
    eventTarget?.addEventListener("offline", handleOffline)
    void probe()
  }

  const stop = () => {
    if (!started) return
    started = false
    eventTarget?.removeEventListener("online", handleOnline)
    eventTarget?.removeEventListener("offline", handleOffline)
    activeProbe?.abort()
    activeProbe = undefined
    generation += 1
    networkTransitionHandled = false
    if (!isDestructiveTerminal()) emit({ kind: "unknown" })
  }

  return {
    acquire() {
      consumerCount += 1
      releaseGeneration += 1
      start()
    },
    addTransientResetHandler(handler) {
      transientResetHandlers.add(handler)
      return () => transientResetHandlers.delete(handler)
    },
    getState: () => state,
    probe,
    release() {
      consumerCount = Math.max(0, consumerCount - 1)
      const pendingRelease = ++releaseGeneration
      queueMicrotask(() => {
        if (consumerCount === 0 && pendingRelease === releaseGeneration) stop()
      })
    },
    start,
    stop,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let defaultBootController: BootController | undefined

export function getDefaultBootController(): BootController {
  defaultBootController ??= createBootController()
  return defaultBootController
}

export function resetDefaultBootControllerForTesting(): void {
  defaultBootController?.stop()
  defaultBootController = undefined
}
