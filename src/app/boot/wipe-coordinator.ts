import { WIPE_BROADCAST_CHANNEL } from "@/app/boot/boot-contract"
import { dropVaultKeyCache as dropVaultKeyCacheModule } from "@/crypto/vault/vault-key"
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import { clearReceipts } from "@/features/receipt-cache"
import {
  bestEffortLocalReset,
  type BestEffortResetArgs,
  type BestEffortResetReport,
} from "@/storage/best-effort-reset"
import { closeDb, engageDatabaseAccessBarrier } from "@/storage/database"

export const WIPE_LOCK_NAME = `${WIPE_BROADCAST_CHANNEL}-exclusive`
export const WIPE_COORDINATION_TIMEOUT_MS = 3_000

const WIPE_REQUEST_TYPE = "qr-crypt-wipe-request"

interface WipeRequestMessage {
  type: typeof WIPE_REQUEST_TYPE
  version: 1
}

export interface WipeCoordinatorArgs extends BestEffortResetArgs {
  endSession?: () => void
  resetTransient: () => void
}

export interface WipeCoordinatorDependencies {
  bestEffortReset: (args: BestEffortResetArgs) => Promise<BestEffortResetReport>
  coordinateTabs: () => void | Promise<void>
  disposeCrypto: () => void | Promise<void>
  dropVaultKeyCacheAndReceipts: () => void | Promise<void>
  engageBarrier: () => void | Promise<void>
  withExclusiveLock: <T>(operation: () => Promise<T>) => Promise<T>
}

export interface WipeCoordinator {
  wipe(args: WipeCoordinatorArgs): Promise<BestEffortResetReport>
}

const cryptoClients = new Set<Pick<PqCryptoClient, "dispose">>()
let wipeBarrierEngaged = false

export function registerPqCryptoClientForWipe(
  client: Pick<PqCryptoClient, "dispose">,
): () => void {
  if (wipeBarrierEngaged) {
    client.dispose()
    return () => undefined
  }
  cryptoClients.add(client)
  return () => cryptoClients.delete(client)
}

function engageBarrier(): void {
  wipeBarrierEngaged = true
  engageDatabaseAccessBarrier()
}

function disposeCrypto(): void {
  let failed = false
  for (const client of cryptoClients) {
    try {
      client.dispose()
    } catch {
      failed = true
    }
  }
  cryptoClients.clear()
  if (failed) throw new Error("crypto disposal failed")
}

async function dropVaultKeyCacheAndReceipts(): Promise<void> {
  try {
    dropVaultKeyCacheModule()
  } finally {
    clearReceipts()
  }
}

function isWipeRequest(value: unknown): value is WipeRequestMessage {
  if (typeof value !== "object" || value === null) return false
  const message = value as Partial<WipeRequestMessage>
  return message.type === WIPE_REQUEST_TYPE && message.version === 1
}

function broadcastWipeRequest(): void {
  closeDb()
  if (typeof BroadcastChannel !== "function") return
  const channel = new BroadcastChannel(WIPE_BROADCAST_CHANNEL)
  try {
    channel.postMessage({
      type: WIPE_REQUEST_TYPE,
      version: 1,
    } satisfies WipeRequestMessage)
  } finally {
    queueMicrotask(() => channel.close())
  }
}

async function withExclusiveWipeLock<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = typeof navigator === "undefined" ? undefined : navigator.locks
  if (!lockManager) return operation()

  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  timeoutId = setTimeout(() => controller.abort(), WIPE_COORDINATION_TIMEOUT_MS)
  try {
    return await lockManager.request(
      WIPE_LOCK_NAME,
      { mode: "exclusive", signal: controller.signal },
      async () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        timeoutId = undefined
        return operation()
      },
    )
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

const DEFAULT_DEPENDENCIES: WipeCoordinatorDependencies = {
  bestEffortReset: bestEffortLocalReset,
  coordinateTabs: broadcastWipeRequest,
  disposeCrypto,
  dropVaultKeyCacheAndReceipts,
  engageBarrier,
  withExclusiveLock: withExclusiveWipeLock,
}

async function executeWipe(
  args: WipeCoordinatorArgs,
  dependencies: WipeCoordinatorDependencies,
): Promise<BestEffortResetReport> {
  const failedSteps: string[] = []
  const attempt = async (step: string, operation: () => void | Promise<void>) => {
    try {
      await operation()
    } catch {
      failedSteps.push(step)
    }
  }

  // Relay teardown precedes the one-way barrier. This synchronous callback aborts a
  // pending camera acquisition and stops an already-live handle before storage work.
  try {
    args.endSession?.()
  } catch {
    failedSteps.push("relay-session")
  }

  // The remaining order is security-significant. Do not reorder these calls.
  await attempt("barrier", dependencies.engageBarrier)
  await attempt("crypto", dependencies.disposeCrypto)
  await attempt("vault-key-cache", dependencies.dropVaultKeyCacheAndReceipts)
  await attempt("transient", args.resetTransient)
  await attempt("cross-tab-close", dependencies.coordinateTabs)

  try {
    const resetReport = await dependencies.withExclusiveLock(() =>
      dependencies.bestEffortReset({
        reason: args.reason,
        resetChurnMb: args.resetChurnMb,
        ...(args.signal ? { signal: args.signal } : {}),
      }),
    )
    failedSteps.push(...resetReport.failedSteps)
  } catch {
    failedSteps.push("cross-tab-lock")
  }

  return { ok: failedSteps.length === 0, failedSteps }
}

export function createWipeCoordinator(
  overrides: Partial<WipeCoordinatorDependencies> = {},
): WipeCoordinator {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides }
  let execution: Promise<BestEffortResetReport> | undefined
  return {
    wipe(args) {
      execution ??= executeWipe(args, dependencies)
      return execution
    },
  }
}

const defaultCoordinator = createWipeCoordinator()

export function wipeOnOnline(args: WipeCoordinatorArgs): Promise<BestEffortResetReport> {
  return defaultCoordinator.wipe(args)
}

// The online terminal path memoizes one execution. Settings gets a fresh
// coordinator per attempt so a partial reset can be retried without reloading.
export function performUserRequestedReset(
  args: { resetChurnMb: number; resetTransient: () => void },
  overrides: Partial<WipeCoordinatorDependencies> = {},
): Promise<BestEffortResetReport> {
  return createWipeCoordinator(overrides).wipe({
    reason: "user-requested",
    resetChurnMb: args.resetChurnMb,
    resetTransient: args.resetTransient,
  })
}

export interface WipeBroadcastListenerOptions {
  endSession?: () => void
  resetTransient: () => void
}

export interface WipeBroadcastListenerDependencies {
  closeDatabase: () => void
  disposeCrypto: () => void
  dropVaultKeyCacheAndReceipts: () => Promise<void>
  engageBarrier: () => void
}

const DEFAULT_BROADCAST_LISTENER_DEPENDENCIES: WipeBroadcastListenerDependencies = {
  closeDatabase: closeDb,
  disposeCrypto,
  dropVaultKeyCacheAndReceipts,
  engageBarrier,
}

/** Installs the peer side of step 4: fail closed, clear secrets, then close DB. */
export function installWipeBroadcastListener(
  options: WipeBroadcastListenerOptions,
  overrides: Partial<WipeBroadcastListenerDependencies> = {},
): () => void {
  if (typeof BroadcastChannel !== "function") return () => undefined
  const dependencies = {
    ...DEFAULT_BROADCAST_LISTENER_DEPENDENCIES,
    ...overrides,
  }
  const channel = new BroadcastChannel(WIPE_BROADCAST_CHANNEL)
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (!isWipeRequest(event.data)) return
    // This must be the first peer-wipe action, before the barrier or any await.
    try {
      options.endSession?.()
    } catch {
      // Continue into the fail-closed wipe path.
    }
    void (async () => {
      dependencies.engageBarrier()
      try {
        dependencies.disposeCrypto()
      } catch {
        // Continue clearing other secret holders.
      }
      try {
        await dependencies.dropVaultKeyCacheAndReceipts()
      } catch {
        // The sender will report its own reset status; this tab must still close.
      }
      try {
        options.resetTransient()
      } finally {
        dependencies.closeDatabase()
      }
    })()
  }
  channel.addEventListener("message", handleMessage)
  return () => {
    channel.removeEventListener("message", handleMessage)
    channel.close()
  }
}
