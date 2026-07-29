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
  isBootReadableFrameBytes,
  isBootReadableFrameIntervalMs,
  RESET_CHURN_MB_MAX,
  RESET_CHURN_MB_MIN,
  TRANSFER_TIMEOUT_MINUTES_MAX,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { probeNonce } from "@/lib/reachability"
import { VAULT_KEY_METADATA_KEY } from "@/crypto/vault/vault-key"
import {
  getDb,
  STORE_APP_METADATA,
  STORE_KEYS,
  STORE_PQ_IDENTITIES,
  STORE_PREFERENCES,
} from "@/storage/database"
import { PREFERENCES_KEY } from "@/storage/preferences-repository"
import { setAckPending } from "@/app/offline-ack-marker"
import { clearReceipts } from "@/features/receipt-cache"

export const BOOT_PROBE_TIMEOUT_MS = 3_000
export const MAINTENANCE_TOKEN_METADATA_KEY = "maintenance-token"

// Minimal early-boot storage ports. These are NOT a re-declaration of idb's types for
// their own sake: readBootDecision accepts an injected getDatabase() and casts to
// BootDatabase, and tests/ui/boot-controller.test.tsx supplies a hand-written structural
// fake against exactly this surface. Widening them to idb's generic types would couple
// this fail-closed boundary, and that fake, to surface neither one uses.
interface BootStore {
  count(): Promise<number>
  get(key: IDBValidKey): Promise<unknown>
  put(value: unknown): Promise<IDBValidKey>
  delete(key: IDBValidKey): Promise<void>
}

interface BootTransaction {
  store: BootStore
  objectStore(name: string): BootStore
  done: Promise<void>
}

interface BootDatabase {
  objectStoreNames: DOMStringList
  get(storeName: string, key: IDBValidKey): Promise<unknown>
  transaction(
    storeNames: string | readonly string[],
    mode: "readonly" | "readwrite",
  ): BootTransaction
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
  endSession: () => void
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
  endRelaySession(reason: RelaySessionEndReason): void
  getState(): BootState
  nudgeDisplayOffline(): boolean
  probe(): Promise<void>
  refreshRelayEligibility(): Promise<boolean>
  // A user-requested reset engages the same one-way barrier as the
  // online-detected wipe, so its partial failure is terminal for the whole
  // application, not for the surface that started it. The controller owns that
  // state: publishing it here unmounts the Router the same way a wipe does.
  reportResetFailure(failedSteps: readonly string[]): void
  registerRelaySessionEndHandler(
    handler: (reason: RelaySessionEndReason) => void,
  ): () => void
  release(): void
  start(): void
  stop(): void
  subscribe(listener: () => void): () => void
}

export type RelaySessionEndReason =
  | "display-offline"
  | "eligibility-loss"
  | "local-wipe"
  | "new-probe"
  | "peer-wipe"
  | "controller-stop"

const FALLBACK_DECISION: BootDecisionSnapshot = {
  wipeOnOnline: true,
  sensitiveDataExists: false,
  cleanOrigin: "indeterminate",
  maintenanceTokenArmed: false,
  resetChurnMb: 0,
  preferencesReadFailed: true,
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
    const nonce = options.nonce ?? probeNonce()
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

function confirmedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError("STORAGE_FAILED")
  return value
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

function optionalIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
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
    "MLKEM1024_A256GCM",
    "MLKEM1024_MLDSA87_A256GCM",
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
    isBootReadableFrameBytes(value.frameBytes) &&
    isBootReadableFrameIntervalMs(value.frameIntervalMs) &&
    optionalIntegerInRange(
      value.transferTimeoutMinutes,
      TRANSFER_TIMEOUT_MINUTES_MIN,
      TRANSFER_TIMEOUT_MINUTES_MAX,
    ) &&
    optionalBoolean(value.wipeOnOnline) &&
    (value.resetChurnMb === undefined || validResetChurnMb(value.resetChurnMb))
  )
}

export interface BootDecisionReadOptions {
  getDatabase?: () => Promise<unknown>
}

/** Read only the fields needed before repositories and Router may mount. */
export async function readBootDecision(
  options: BootDecisionReadOptions = {},
): Promise<BootDecisionSnapshot> {
  let database: BootDatabase
  try {
    database = (await (options.getDatabase ?? getDb)()) as BootDatabase
    if (
      !database?.objectStoreNames ||
      typeof database.objectStoreNames.contains !== "function" ||
      typeof database.transaction !== "function"
    ) {
      return { ...FALLBACK_DECISION }
    }
  } catch {
    // Without a confirmed sensitive row, a storage-open failure cannot trigger
    // destructive reset. Relay authorization separately remains fail-closed.
    return { ...FALLBACK_DECISION }
  }

  const requiredStores = [
    STORE_KEYS,
    STORE_PREFERENCES,
    STORE_APP_METADATA,
    STORE_PQ_IDENTITIES,
  ] as const
  try {
    if (requiredStores.some((storeName) => !hasStore(database, storeName))) {
      return { ...FALLBACK_DECISION }
    }

    // The sensitive stores and Vault metadata are proved in one readonly
    // transaction. Any request or transaction failure makes cleanliness
    // indeterminate rather than authorizing the relay.
    const transaction = database.transaction(requiredStores, "readonly")
    const keys = transaction.objectStore(STORE_KEYS)
    const preferences = transaction.objectStore(STORE_PREFERENCES)
    const appMetadata = transaction.objectStore(STORE_APP_METADATA)
    const pqIdentities = transaction.objectStore(STORE_PQ_IDENTITIES)
    const [
      [
        keyCountValue,
        pqIdentityCountValue,
        vaultKeyRow,
        maintenanceTokenRow,
        preferencesRow,
      ],
    ] = await Promise.all([
      Promise.all([
        keys.count(),
        pqIdentities.count(),
        appMetadata.get(VAULT_KEY_METADATA_KEY),
        appMetadata.get(MAINTENANCE_TOKEN_METADATA_KEY),
        preferences.get(PREFERENCES_KEY),
      ]),
      transaction.done,
    ])

    const keysExist = confirmedCount(keyCountValue) > 0
    const pqIdentitiesExist = confirmedCount(pqIdentityCountValue) > 0
    const vaultKeyExists = vaultKeyRow !== undefined
    const sensitiveDataExists = keysExist || vaultKeyExists || pqIdentitiesExist
    const cleanOrigin = sensitiveDataExists ? "dirty" : "confirmed-clean"
    const maintenanceTokenArmed =
      maintenanceToken(metadataValue(maintenanceTokenRow)) !== undefined

    let wipeOnOnline = true
    let resetChurnMb = 0
    let preferencesReadFailed = false
    if (preferencesRow !== undefined) {
      const value = metadataValue(preferencesRow)
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

    if (preferencesReadFailed) wipeOnOnline = true

    return {
      wipeOnOnline,
      sensitiveDataExists,
      cleanOrigin,
      maintenanceTokenArmed,
      resetChurnMb,
      preferencesReadFailed,
    }
  } catch {
    return { ...FALLBACK_DECISION }
  }
}

function appMetadataTransaction(database: BootDatabase): BootTransaction {
  if (!hasStore(database, STORE_APP_METADATA)) throw new AppError("STORAGE_FAILED")
  return database.transaction(STORE_APP_METADATA, "readwrite")
}

/** Storage API for the strongly confirmed, one-update-only offline maintenance flow. */
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
  let relayRefreshGeneration = 0
  let peerWipeGeneration = 0
  let relaySessionEndHandler: ((reason: RelaySessionEndReason) => void) | undefined
  let networkTransitionHandled = false
  let confirmationEpisode:
    | {
        generation: number
        continuationPending: boolean
        offlineRequested: boolean
        relayInvalidated: boolean
      }
    | undefined

  const emit = (nextState: BootState) => {
    state = nextState
    for (const listener of listeners) listener()
  }

  const endRelaySession = (reason: RelaySessionEndReason) => {
    try {
      relaySessionEndHandler?.(reason)
    } catch {
      // Teardown is best-effort and idempotent; the boot transition remains authoritative.
    }
    if (reason === "peer-wipe" || reason === "display-offline") {
      if (reason === "peer-wipe") peerWipeGeneration += 1
      relayRefreshGeneration += 1
      if (confirmationEpisode) confirmationEpisode.relayInvalidated = true
      if (state.kind === "network-confirmed") {
        emit({ kind: "network-confirmed", relayEligibility: "ineligible" })
      }
    }
  }

  const invalidateRelay = (reason: RelaySessionEndReason) => {
    relayRefreshGeneration += 1
    endRelaySession(reason)
  }

  const resetTransient = () => {
    clearReceipts()
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

  const relayEligibleFrom = (decision: BootDecisionSnapshot): boolean =>
    decision.cleanOrigin === "confirmed-clean" && !decision.sensitiveDataExists

  const publishRelayDecision = (
    episode: NonNullable<typeof confirmationEpisode>,
    decision: BootDecisionSnapshot,
  ): boolean => {
    if (
      confirmationEpisode !== episode ||
      episode.offlineRequested ||
      state.kind !== "network-confirmed"
    ) {
      return false
    }
    if (episode.relayInvalidated) {
      emit({ kind: "network-confirmed", relayEligibility: "ineligible" })
      return false
    }
    const eligible = relayEligibleFrom(decision)
    if (!eligible) endRelaySession("eligibility-loss")
    emit({
      kind: "network-confirmed",
      relayEligibility: eligible ? "eligible" : "ineligible",
    })
    return eligible
  }

  const finishNonDestructiveConfirmation = (
    episode: NonNullable<typeof confirmationEpisode>,
    decision: BootDecisionSnapshot,
  ) => {
    resetTransient()
    episode.continuationPending = false
    if (
      confirmationEpisode === episode &&
      episode.offlineRequested &&
      state.kind === "network-confirmed"
    ) {
      networkTransitionHandled = false
      invalidateRelay("display-offline")
      emit({ kind: "offline-confirmed" })
      return
    }
    publishRelayDecision(episode, decision)
  }

  const probe = async (): Promise<void> => {
    if (isDestructiveTerminal() || confirmationEpisode?.continuationPending) return
    const probeGeneration = ++generation
    invalidateRelay("new-probe")
    const peerWipeGenerationAtStart = peerWipeGeneration
    activeProbe?.abort()
    confirmationEpisode = undefined
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
    if (probeGeneration !== generation || controller.signal.aborted) return
    activeProbe = undefined
    if (!confirmed) {
      networkTransitionHandled = false
      invalidateRelay("display-offline")
      emit({ kind: "offline-confirmed" })
      return
    }

    networkTransitionHandled = true
    const episode = {
      generation: probeGeneration,
      continuationPending: true,
      offlineRequested: false,
      relayInvalidated: peerWipeGeneration !== peerWipeGenerationAtStart,
    }
    confirmationEpisode = episode
    setAckPending()
    emit({ kind: "network-confirmed", relayEligibility: "pending" })

    // Sentinel success is the one-way boundary. From here onward no offline
    // request, generation update, or AbortSignal may cancel token consumption
    // or a qualifying wipe decision.
    const decision = await decisionPromise

    if (decision.maintenanceTokenArmed) {
      const tokenConsumed = await consumeToken()
      if (tokenConsumed) {
        finishNonDestructiveConfirmation(episode, decision)
        return
      }
    }
    if (!decision.sensitiveDataExists || !decision.wipeOnOnline) {
      finishNonDestructiveConfirmation(episode, decision)
      return
    }

    invalidateRelay("local-wipe")
    emit({ kind: "wiping" })
    try {
      const report = await performWipe({
        reason: "online-detected",
        resetChurnMb: decision.resetChurnMb,
        endSession: () => endRelaySession("local-wipe"),
        resetTransient,
      })
      episode.continuationPending = false
      emit(
        report.ok
          ? { kind: "wiped" }
          : { kind: "partial-failure", failedSteps: report.failedSteps },
      )
    } catch {
      episode.continuationPending = false
      emit({ kind: "partial-failure", failedSteps: ["reset"] })
    }
  }

  const nudgeDisplayOffline = (): boolean => {
    if (state.kind !== "network-confirmed") return false
    const episode = confirmationEpisode
    if (!episode || episode.offlineRequested) return false

    invalidateRelay("display-offline")
    episode.offlineRequested = true
    if (!episode.continuationPending) {
      networkTransitionHandled = false
      emit({ kind: "offline-confirmed" })
    }
    return true
  }

  const handleOnline = () => {
    if (networkTransitionHandled || isDestructiveTerminal()) return
    void probe()
  }

  const handleOffline = () => {
    if (isDestructiveTerminal()) return
    if (state.kind === "network-confirmed") {
      nudgeDisplayOffline()
      return
    }
    networkTransitionHandled = false
    if (state.kind === "probing") {
      invalidateRelay("display-offline")
      activeProbe?.abort()
      activeProbe = undefined
      generation += 1
      emit({ kind: "offline-confirmed" })
    }
  }

  const start = () => {
    if (started || isDestructiveTerminal()) return
    started = true
    eventTarget?.addEventListener("online", handleOnline)
    eventTarget?.addEventListener("offline", handleOffline)
    void probe()
  }

  const stop = () => {
    invalidateRelay("controller-stop")
    if (started) {
      started = false
      eventTarget?.removeEventListener("online", handleOnline)
      eventTarget?.removeEventListener("offline", handleOffline)
    }
    activeProbe?.abort()
    activeProbe = undefined
    generation += 1
    networkTransitionHandled = false
    if (!isDestructiveTerminal()) emit({ kind: "unknown" })
  }

  const refreshRelayEligibility = async (): Promise<boolean> => {
    const episode = confirmationEpisode
    if (
      !episode ||
      episode.continuationPending ||
      episode.offlineRequested ||
      episode.relayInvalidated ||
      state.kind !== "network-confirmed"
    ) {
      endRelaySession("eligibility-loss")
      return false
    }

    const refreshGeneration = ++relayRefreshGeneration
    endRelaySession("eligibility-loss")
    emit({ kind: "network-confirmed", relayEligibility: "pending" })
    const decision = await safeDecision(readDecision)
    if (
      refreshGeneration !== relayRefreshGeneration ||
      confirmationEpisode !== episode ||
      episode.continuationPending ||
      episode.offlineRequested ||
      episode.relayInvalidated ||
      state.kind !== "network-confirmed"
    ) {
      return false
    }
    return publishRelayDecision(episode, decision)
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
    endRelaySession,
    getState: () => state,
    nudgeDisplayOffline,
    probe,
    refreshRelayEligibility,
    reportResetFailure(failedSteps) {
      invalidateRelay("local-wipe")
      emit({ kind: "partial-failure", failedSteps: [...failedSteps] })
    },
    registerRelaySessionEndHandler(handler) {
      if (relaySessionEndHandler && relaySessionEndHandler !== handler) {
        endRelaySession("eligibility-loss")
      }
      relaySessionEndHandler = handler
      return () => {
        if (relaySessionEndHandler === handler) relaySessionEndHandler = undefined
      }
    },
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
