import { WIPE_BROADCAST_CHANNEL } from "@/app/boot/boot-contract"
import { dropVaultKeyCache as dropVaultKeyCacheModule } from "@/crypto/vault/vault-key"
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import {
  bestEffortLocalReset,
  type BestEffortResetArgs,
  type BestEffortResetReport,
} from "@/storage/best-effort-reset"
import { closeDb, engageDatabaseAccessBarrier } from "@/storage/database"

export const WIPE_LOCK_NAME = `${WIPE_BROADCAST_CHANNEL}-exclusive`
export const WIPE_COORDINATION_TIMEOUT_MS = 3_000

const WIPE_REQUEST_TYPE = "qrypt-wipe-request"

interface WipeRequestMessage {
  type: typeof WIPE_REQUEST_TYPE
  version: 1
}

export interface WipeCoordinatorArgs extends BestEffortResetArgs {
  resetTransient: () => void
}

export interface WipeCoordinatorDependencies {
  bestEffortReset: (args: BestEffortResetArgs) => Promise<BestEffortResetReport>
  coordinateTabs: () => void | Promise<void>
  disposeCrypto: () => void | Promise<void>
  dropVaultKeyCache: () => void | Promise<void>
  engageBarrier: () => void | Promise<void>
  withExclusiveLock: <T>(operation: () => Promise<T>) => Promise<T>
}

export interface WipeCoordinator {
  wipe(args: WipeCoordinatorArgs): Promise<BestEffortResetReport>
}

const cryptoClients = new Set<Pick<PqCryptoClient, "dispose">>()
const secretBuffers = new Set<Uint8Array>()
let wipeBarrierEngaged = false

export function isWipeBarrierEngaged(): boolean {
  return wipeBarrierEngaged
}

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

export function registerSecretBufferForWipe(buffer: Uint8Array): () => void {
  if (wipeBarrierEngaged) {
    buffer.fill(0)
    return () => undefined
  }
  secretBuffers.add(buffer)
  return () => secretBuffers.delete(buffer)
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
  for (const buffer of secretBuffers) buffer.fill(0)
  secretBuffers.clear()
  if (failed) throw new Error("crypto disposal failed")
}

function notImplemented(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("NOT_IMPLEMENTED")
}

async function dropVaultKeyCache(): Promise<void> {
  try {
    dropVaultKeyCacheModule()
  } catch (error) {
    if (!notImplemented(error)) throw error
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
  dropVaultKeyCache,
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

  // §B3 order is security-significant. Do not reorder these calls.
  await attempt("barrier", dependencies.engageBarrier)
  await attempt("crypto", dependencies.disposeCrypto)
  await attempt("vault-key-cache", dependencies.dropVaultKeyCache)
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

export interface WipeBroadcastListenerOptions {
  resetTransient: () => void
}

/** Installs the peer side of step 4: fail closed, clear secrets, then close DB. */
export function installWipeBroadcastListener(
  options: WipeBroadcastListenerOptions,
): () => void {
  if (typeof BroadcastChannel !== "function") return () => undefined
  const channel = new BroadcastChannel(WIPE_BROADCAST_CHANNEL)
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (!isWipeRequest(event.data)) return
    void (async () => {
      engageBarrier()
      try {
        disposeCrypto()
      } catch {
        // Continue clearing other secret holders.
      }
      try {
        await dropVaultKeyCache()
      } catch {
        // The sender will report its own reset status; this tab must still close.
      }
      try {
        options.resetTransient()
      } finally {
        closeDb()
      }
    })()
  }
  channel.addEventListener("message", handleMessage)
  return () => {
    channel.removeEventListener("message", handleMessage)
    channel.close()
  }
}
