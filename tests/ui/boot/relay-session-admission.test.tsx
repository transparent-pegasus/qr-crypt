import "./boot-test-support"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useSyncExternalStore } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBootController,
  readBootDecision,
  type BootController,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { REACHABILITY_SENTINEL_BODY } from "@/app/boot/boot-contract"
import { FeatureSupportProvider } from "@/app/providers"
import { OnlineRelay } from "@/components/online-relay"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { LanguageProvider } from "@/i18n"
import {
  getDb,
  type RelayLease,
  resetDatabaseAccessBarrierForTesting,
  STORE_APP_METADATA,
  STORE_KEYS,
  STORE_PQ_IDENTITIES,
  STORE_PREFERENCES,
  withSensitiveWriteLock,
} from "@/storage/database"
import { saveKeyRecord } from "@/storage/key-repository"
import { saveIdentity } from "@/storage/pq-identity-repository"
import { PREFERENCES_KEY } from "@/storage/preferences-repository"
import { response } from "../../helpers/boot-fixtures"
import { deferred } from "../../helpers/deferred"
import { defaultKeys } from "../helpers/fakes/key-fixtures"
import { defaultIdentity } from "../helpers/fakes/pq-fixtures"

vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: () => ({ offlineReady: [false, vi.fn()] }),
}))

// These exercise the real controller, repositories and fake-indexeddb. The
// jsdom setup installs a Web Locks scheduler stub; browser evidence is separate.
const controllers: BootController[] = []

beforeEach(async () => {
  resetDatabaseAccessBarrierForTesting()
  dropVaultKeyCache()
  const database = await getDb()
  for (const store of [
    STORE_KEYS,
    STORE_PQ_IDENTITIES,
    STORE_APP_METADATA,
    STORE_PREFERENCES,
  ] as const) {
    await database.clear(store)
  }
  await database.put(STORE_PREFERENCES, {
    key: PREFERENCES_KEY,
    value: { wipeOnOnline: false },
  })
})

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop()
  dropVaultKeyCache()
})

async function readyController(readDecision = readBootDecision): Promise<BootController> {
  const controller = createBootController({
    readDecision,
    fetchImpl: vi.fn(async () => response(REACHABILITY_SENTINEL_BODY)),
    readConnectivityHint: () => "online",
  })
  controllers.push(controller)
  await controller.probe()
  expect(controller.getState()).toEqual({
    kind: "network-confirmed",
    relayEligibility: "eligible",
  })
  return controller
}

async function writeKey(): Promise<void> {
  const symmetricKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  )
  await saveKeyRecord({ ...defaultKeys()[0]!, id: "A".repeat(22), symmetricKey })
}

const sensitiveWriters = [
  { name: "key row", write: writeKey },
  {
    name: "PQ identity",
    write: async () => {
      await saveIdentity(defaultIdentity())
    },
  },
  {
    name: "Vault key",
    write: async () => {
      await getOrCreateVaultKey()
    },
  },
]

async function writerCanComplete(): Promise<void> {
  let completed = false
  const write = withSensitiveWriteLock(async () => {
    completed = true
  })
  await waitFor(() => expect(completed).toBe(true), { timeout: 500 })
  await write
}

describe("lease-protected relay admission", () => {
  it.each(sensitiveWriters)(
    "rejects a completed $name write after an old clean eligibility result",
    async ({ write }) => {
      const controller = await readyController()
      await write()
      expect((await readBootDecision()).cleanOrigin).toBe("dirty")
      expect(controller.getState()).toMatchObject({ relayEligibility: "eligible" })

      const lease = await controller.acquireRelaySession(new AbortController().signal)
      try {
        expect(lease).toBeNull()
      } finally {
        lease?.release()
      }
      await writerCanComplete()
    },
  )

  it.each(sensitiveWriters)(
    "holds the admitted lease across a cooperating $name write",
    async ({ write }) => {
      const controller = await readyController()
      const cancellation = new AbortController()
      const lease = await controller.acquireRelaySession(cancellation.signal)
      expect(lease).not.toBeNull()
      let completed = false
      const writer = write().then(() => {
        completed = true
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(completed).toBe(false)
        expect((await readBootDecision()).cleanOrigin).toBe("confirmed-clean")
      } finally {
        lease?.release()
      }
      await writer
      expect((await readBootDecision()).cleanOrigin).toBe("dirty")
    },
  )

  it("refuses when Web Locks disappears after the clean proof", async () => {
    const controller = await readyController()
    const original = Object.getOwnPropertyDescriptor(navigator, "locks")!
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined })
    try {
      expect(
        await controller.acquireRelaySession(new AbortController().signal),
      ).toBeNull()
    } finally {
      Object.defineProperty(navigator, "locks", original)
    }
  })

  it("refuses an already-aborted admission without retaining a lock", async () => {
    const controller = await readyController()
    const cancellation = new AbortController()
    cancellation.abort()
    expect(await controller.acquireRelaySession(cancellation.signal)).toBeNull()
    await writerCanComplete()
  })

  it("releases on a failed storage decision read", async () => {
    const readDecision = vi.fn(readBootDecision)
    const controller = await readyController(readDecision)
    readDecision.mockRejectedValueOnce(new Error("IndexedDB transaction failed"))
    expect(await controller.acquireRelaySession(new AbortController().signal)).toBeNull()
    await writerCanComplete()
  })

  it.each([
    "abort",
    "controller stop",
    "eligibility loss",
    "replacement handler",
  ] as const)(
    "settles and releases on %s while the decision read remains unresolved",
    async (boundary) => {
      const readDecision = vi.fn(readBootDecision)
      const controller = await readyController(readDecision)
      const lateRead = deferred<BootDecisionSnapshot>()
      let enteredRead = false
      const clean = await readBootDecision()
      readDecision.mockImplementationOnce(() => {
        enteredRead = true
        return lateRead.promise
      })
      controller.registerRelaySessionEndHandler(() => undefined)
      const cancellation = new AbortController()
      const admission: Promise<RelayLease | null> = controller.acquireRelaySession(
        cancellation.signal,
      )
      try {
        await waitFor(() => expect(enteredRead).toBe(true), { timeout: 500 })
        let completed = false
        const writer = withSensitiveWriteLock(async () => {
          completed = true
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(completed).toBe(false)

        if (boundary === "abort") cancellation.abort()
        else if (boundary === "controller stop") controller.stop()
        else if (boundary === "eligibility loss")
          controller.endRelaySession("eligibility-loss")
        else controller.registerRelaySessionEndHandler(() => undefined)

        // Neither assertion is allowed to depend on the delayed read settling.
        let result: unknown = "pending"
        void admission.then((lease) => {
          result = lease
        })
        await waitFor(() => expect(result).toBeNull(), { timeout: 500 })
        await waitFor(() => expect(completed).toBe(true), { timeout: 500 })
        await writer
        lateRead.resolve(clean)
        await expect(admission).resolves.toBeNull()
        await new Promise((resolve) => setTimeout(resolve, 0))
        await writerCanComplete()
      } finally {
        cancellation.abort()
        lateRead.resolve(clean)
        ;(await admission)?.release()
      }
    },
  )

  it("keeps display eligibility stable during admission so the mounted relay does not cancel itself", async () => {
    const controller = await readyController()
    const published: string[] = []
    const unsubscribe = controller.subscribe(() => {
      const state = controller.getState()
      published.push(
        state.kind === "network-confirmed" ? state.relayEligibility : state.kind,
      )
    })
    function Relay() {
      const state = useSyncExternalStore(controller.subscribe, controller.getState)
      return (
        <LanguageProvider initialLanguage="en">
          <FeatureSupportProvider
            features={{
              webCrypto: true,
              indexedDb: true,
              camera: true,
              serviceWorker: true,
            }}
          >
            <OnlineRelay
              eligible={
                state.kind === "network-confirmed" &&
                state.relayEligibility === "eligible"
              }
              onSessionAcquire={controller.acquireRelaySession}
              onEligibilityRefresh={controller.refreshRelayEligibility}
              registerRelaySessionEndHandler={controller.registerRelaySessionEndHandler}
            />
          </FeatureSupportProvider>
        </LanguageProvider>
      )
    }
    const rendered = render(<Relay />)
    try {
      await userEvent.setup().click(screen.getByRole("button", { name: "Text → QR" }))
      expect(
        await screen.findByRole("dialog", { name: "Turn relay text into QR" }),
      ).toBeVisible()
      expect(published).not.toContain("pending")
    } finally {
      rendered.unmount()
      unsubscribe()
    }
    await writerCanComplete()
  })

  it("drops a held session before a separate visibility refresh takes the proof lock", async () => {
    const controller = await readyController()
    const lease = await controller.acquireRelaySession(new AbortController().signal)
    expect(lease).not.toBeNull()
    controller.registerRelaySessionEndHandler(() => lease?.release())
    try {
      let refreshed: boolean | undefined
      const refresh = controller.refreshRelayEligibility().then((value) => {
        refreshed = value
      })
      await waitFor(() => expect(refreshed).toBe(true), { timeout: 500 })
      await refresh
      await writerCanComplete()
    } finally {
      lease?.release()
    }
  })
})
