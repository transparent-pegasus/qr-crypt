import { StrictMode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BOOT_PROBE_TIMEOUT_MS,
  createBootController,
  probeNetworkSentinel,
  readBootDecision,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { useBootState } from "@/app/boot/use-boot-state"
import {
  createWipeCoordinator,
  installWipeBroadcastListener,
} from "@/app/boot/wipe-coordinator"
import {
  clearReceipts,
  recordReceipt,
  type ReceiptSubject,
} from "@/features/receipt-cache"

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length(): number {
    return this.values.size
  }
  clear(): void {
    this.values.clear()
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const localStorage = new MemoryStorage()
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorage,
})

function response(body: string, status = 200): Response {
  return { status, text: vi.fn(async () => body) } as unknown as Response
}

function decision(overrides: Partial<BootDecisionSnapshot> = {}): BootDecisionSnapshot {
  const snapshot = {
    wipeOnOnline: true,
    sensitiveDataExists: false,
    maintenanceTokenArmed: false,
    resetChurnMb: 0,
    preferencesReadFailed: false,
    ...overrides,
  }
  return {
    ...snapshot,
    cleanOrigin:
      overrides.cleanOrigin ??
      (snapshot.sensitiveDataExists ? "dirty" : "confirmed-clean"),
  }
}

interface FakeBootDatabaseOptions {
  countFailure?: "keys" | "pqIdentities"
  keyCount?: number
  missingStore?: "keys" | "preferences" | "appMetadata" | "pqIdentities"
  preferencesValue?: Record<string, unknown>
  transactionFailure?: "create" | "done"
  vaultGetFailure?: boolean
}

function fakeBootDatabase(options: FakeBootDatabaseOptions = {}) {
  const storeNames = new Set(["keys", "preferences", "appMetadata", "pqIdentities"])
  if (options.missingStore) storeNames.delete(options.missingStore)
  const transaction = vi.fn((requestedStores: readonly string[], mode: "readonly") => {
    if (options.transactionFailure === "create") {
      throw new DOMException("transaction failed", "InvalidStateError")
    }
    return {
      objectStore(name: string) {
        return {
          async count() {
            if (options.countFailure === name) {
              throw new DOMException("count failed", "UnknownError")
            }
            return name === "keys" ? (options.keyCount ?? 0) : 0
          },
          async get(key: IDBValidKey) {
            if (
              name === "appMetadata" &&
              key === "vault-key" &&
              options.vaultGetFailure
            ) {
              throw new DOMException("get failed", "UnknownError")
            }
            if (
              name === "preferences" &&
              key === "preferences" &&
              options.preferencesValue !== undefined
            ) {
              return { key: "preferences", value: options.preferencesValue }
            }
            return undefined
          },
        }
      },
      done:
        options.transactionFailure === "done"
          ? Promise.reject(new DOMException("transaction aborted", "AbortError"))
          : Promise.resolve(),
      requestedStores,
      mode,
    }
  })
  return {
    database: {
      objectStoreNames: {
        contains: (name: string) => storeNames.has(name),
      },
      transaction,
    },
    transaction,
  }
}

afterEach(() => {
  clearReceipts()
  cleanup()
  window.localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("destructive reachability probe", () => {
  it("requires status 200 and an exact, untrimmed sentinel body", async () => {
    const fetchImpl = vi.fn(async () => response("QR-CRYPT-REACHABLE"))
    await expect(
      probeNetworkSentinel({ fetchImpl, nonce: "fixed", timeoutMs: 50 }),
    ).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      "/reachability-sentinel.txt?n=fixed",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    )

    await expect(
      probeNetworkSentinel({
        fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE\n")),
        timeoutMs: 50,
      }),
    ).resolves.toBe(false)
  })

  it.each([
    ["non-200", vi.fn(async () => response("QR-CRYPT-REACHABLE", 204))],
    ["body mismatch", vi.fn(async () => response("captive portal"))],
    ["fetch rejection", vi.fn(async () => Promise.reject(new TypeError("offline")))],
  ])("treats %s as offline", async (_name, fetchImpl) => {
    const controller = createBootController({
      fetchImpl,
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })

  it("times out an unresponsive fetch", async () => {
    vi.useFakeTimers()
    const controller = createBootController({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
      probeTimeoutMs: BOOT_PROBE_TIMEOUT_MS,
      readDecision: async () => decision(),
    })
    const pending = controller.probe()
    await vi.advanceTimersByTimeAsync(BOOT_PROBE_TIMEOUT_MS)
    await pending
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })

  it.each([
    ["an offline sentinel", "not-the-sentinel"],
    ["a confirming sentinel", "QR-CRYPT-REACHABLE"],
  ])(
    "keeps a user-requested reset failure terminal against %s still in flight",
    async (_name, body) => {
      const resolvers: Array<(value: Response) => void> = []
      const controller = createBootController({
        fetchImpl: () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve)
          }),
        readDecision: async () => decision(),
      })
      const pending = controller.probe()

      // The reset engaged the one-way barrier while that probe was still open.
      controller.beginUserRequestedReset()
      expect(controller.getState()).toEqual({ kind: "wiping" })
      controller.reportResetFailure(["database"])

      resolvers[0]?.(response(body))
      await pending

      expect(controller.getState()).toEqual({
        kind: "partial-failure",
        failedSteps: ["database"],
      })
    },
  )

  it("refuses to leave a destructive state through any later transition", async () => {
    const controller = createBootController({
      fetchImpl: async () => response("not-the-sentinel"),
      readDecision: async () => decision(),
    })
    controller.reportResetFailure(["database", "database-verification"])
    const terminal = {
      kind: "partial-failure",
      failedSteps: ["database", "database-verification"],
    }

    await controller.probe()
    controller.start()
    controller.stop()
    expect(controller.nudgeDisplayOffline()).toBe(false)
    expect(await controller.refreshRelayEligibility()).toBe(false)

    expect(controller.getState()).toEqual(terminal)
  })

  it("ignores a stale probe generation", async () => {
    const resolvers: Array<(value: Response) => void> = []
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    const controller = createBootController({
      fetchImpl,
      readDecision: async () => decision(),
    })
    const first = controller.probe()
    const second = controller.probe()
    resolvers[1]?.(response("not-the-sentinel"))
    await second
    resolvers[0]?.(response("QR-CRYPT-REACHABLE"))
    await first
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })
})

describe("boot decisions", () => {
  it.each([
    [
      "DB open failure",
      async () =>
        readBootDecision({
          getDatabase: async () => {
            throw new DOMException("open failed", "UnknownError")
          },
        }),
    ],
    [
      "unusable DB object",
      async () => readBootDecision({ getDatabase: async () => ({}) }),
    ],
    ...(["keys", "preferences", "appMetadata", "pqIdentities"] as const).map(
      (missingStore) =>
        [
          `missing ${missingStore} store`,
          async () =>
            readBootDecision({
              getDatabase: async () => fakeBootDatabase({ missingStore }).database,
            }),
        ] as const,
    ),
    ...(["keys", "pqIdentities"] as const).map(
      (countFailure) =>
        [
          `${countFailure} count failure`,
          async () =>
            readBootDecision({
              getDatabase: async () => fakeBootDatabase({ countFailure }).database,
            }),
        ] as const,
    ),
    [
      "Vault lookup failure",
      async () =>
        readBootDecision({
          getDatabase: async () => fakeBootDatabase({ vaultGetFailure: true }).database,
        }),
    ],
    ...(["create", "done"] as const).map(
      (transactionFailure) =>
        [
          `transaction ${transactionFailure} failure`,
          async () =>
            readBootDecision({
              getDatabase: async () => fakeBootDatabase({ transactionFailure }).database,
            }),
        ] as const,
    ),
  ] as Array<[string, () => Promise<BootDecisionSnapshot>]>)(
    "keeps the relay ineligible after %s",
    async (_label, readFailure) => {
      const snapshot = await readFailure()
      expect(snapshot).toMatchObject({
        cleanOrigin: "indeterminate",
        sensitiveDataExists: false,
        preferencesReadFailed: true,
      })
      const controller = createBootController({
        fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
        readDecision: async () => snapshot,
      })
      await controller.probe()
      expect(controller.getState()).toEqual({
        kind: "network-confirmed",
        relayEligibility: "ineligible",
      })
    },
  )

  it("proves all sensitive stores clean in one readonly transaction", async () => {
    const { database, transaction } = fakeBootDatabase()
    await expect(
      readBootDecision({ getDatabase: async () => database }),
    ).resolves.toMatchObject({
      cleanOrigin: "confirmed-clean",
      sensitiveDataExists: false,
    })
    expect(transaction).toHaveBeenCalledOnce()
    expect(transaction).toHaveBeenCalledWith(
      ["keys", "preferences", "appMetadata", "pqIdentities"],
      "readonly",
    )
  })

  it.each([
    {
      label: "200 bytes with 1000 milliseconds",
      value: { frameBytes: 200, frameIntervalMs: 1_000 },
    },
    {
      label: "250 bytes with 3000 milliseconds",
      value: { frameBytes: 250, frameIntervalMs: 3_000 },
    },
    {
      label: "a missing interval member",
      value: { frameBytes: 200 },
    },
    {
      label: "a missing density member",
      value: { frameIntervalMs: 1_000 },
    },
  ] as const)(
    "keeps $label boot-readable without wiping sensitive data",
    async ({ value }) => {
      const { database } = fakeBootDatabase({
        keyCount: 1,
        preferencesValue: {
          ...value,
          wipeOnOnline: false,
        },
      })
      const getDatabase = async () => database
      const snapshot = await readBootDecision({
        getDatabase,
      })
      expect(snapshot).toMatchObject({
        preferencesReadFailed: false,
        sensitiveDataExists: true,
        wipeOnOnline: false,
      })

      const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
      const controller = createBootController({
        fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
        performWipe,
        readDecision: () => readBootDecision({ getDatabase }),
      })
      await controller.probe()

      expect(performWipe).not.toHaveBeenCalled()
      expect(controller.getState()).toEqual({
        kind: "network-confirmed",
        relayEligibility: "ineligible",
      })
    },
  )

  it.each([99, 1_001] as const)(
    "fails closed for stored frameBytes=%i outside the boot-readable range",
    async (frameBytes) => {
      const { database } = fakeBootDatabase({
        keyCount: 1,
        preferencesValue: { frameBytes, wipeOnOnline: false },
      })
      const getDatabase = async () => database
      const snapshot = await readBootDecision({
        getDatabase,
      })
      expect(snapshot).toMatchObject({
        preferencesReadFailed: true,
        sensitiveDataExists: true,
        wipeOnOnline: true,
      })

      const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
      const controller = createBootController({
        fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
        performWipe,
        readDecision: () => readBootDecision({ getDatabase }),
      })
      await controller.probe()

      expect(performWipe).toHaveBeenCalledTimes(1)
      expect(controller.getState()).toEqual({ kind: "wiped" })
    },
  )

  it.each([
    ["consume succeeds", true, "offline-confirmed"],
    ["consume fails and wipe qualifies", false, "wiped"],
  ] as const)(
    "latches an offline nudge while a deferred maintenance token %s",
    async (_label, tokenResult, expectedState) => {
      let resolveToken: ((value: boolean) => void) | undefined
      const consumeMaintenanceToken = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveToken = resolve
          }),
      )
      const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
      const resetTransient = vi.fn()
      const controller = createBootController({
        consumeMaintenanceToken,
        fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
        performWipe,
        readDecision: async () =>
          decision({ maintenanceTokenArmed: true, sensitiveDataExists: true }),
      })
      controller.addTransientResetHandler(resetTransient)

      const pendingProbe = controller.probe()
      await waitFor(() =>
        expect(controller.getState()).toEqual({
          kind: "network-confirmed",
          relayEligibility: "pending",
        }),
      )
      expect(controller.nudgeDisplayOffline()).toBe(true)
      expect(controller.nudgeDisplayOffline()).toBe(false)
      expect(controller.getState()).toEqual({
        kind: "network-confirmed",
        relayEligibility: "ineligible",
      })

      resolveToken?.(tokenResult)
      await pendingProbe

      expect(consumeMaintenanceToken).toHaveBeenCalledTimes(1)
      expect(controller.getState().kind).toBe(expectedState)
      expect(resetTransient).toHaveBeenCalledTimes(tokenResult ? 1 : 0)
      expect(performWipe).toHaveBeenCalledTimes(tokenResult ? 0 : 1)
      expect(controller.nudgeDisplayOffline()).toBe(false)
    },
  )

  it("sets the acknowledgement marker before publishing network-confirmed", async () => {
    const order: string[] = []
    const originalSetItem = localStorage.setItem.bind(localStorage)
    const setItem = vi.spyOn(window.localStorage, "setItem")
    setItem.mockImplementation((key, value) => {
      if (key === "oc-offline-ack-pending" && value === "1") order.push("marker")
      originalSetItem(key, value)
    })
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: async () => decision(),
    })
    controller.subscribe(() => {
      const state = controller.getState()
      if (state.kind === "network-confirmed") {
        order.push(`publish-${state.relayEligibility}`)
      }
    })

    await controller.probe()

    expect(order).toEqual(["marker", "publish-pending", "publish-eligible"])
  })

  it("keeps nudge a strict no-op outside one network-confirmed episode", async () => {
    let resolveFetch: ((value: Response) => void) | undefined
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const controller = createBootController({
      fetchImpl,
      readDecision: async () => decision(),
    })
    const listener = vi.fn()
    controller.subscribe(listener)

    expect(controller.nudgeDisplayOffline()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    const pending = controller.probe()
    const probingEmits = listener.mock.calls.length
    expect(controller.getState().kind).toBe("probing")
    expect(controller.nudgeDisplayOffline()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(probingEmits)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    resolveFetch?.(response("offline", 503))
    await pending
    const offlineEmits = listener.mock.calls.length
    expect(controller.nudgeDisplayOffline()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(offlineEmits)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["wiped", { ok: true, failedSteps: [] }],
    ["partial-failure", { ok: false, failedSteps: ["database"] }],
  ] as const)("does not nudge the %s terminal state", async (kind, report) => {
    let resolveWipe: ((value: typeof report) => void) | undefined
    const performWipe = vi.fn(
      () =>
        new Promise<typeof report>((resolve) => {
          resolveWipe = resolve
        }),
    )
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })
    const pending = controller.probe()
    await waitFor(() => expect(controller.getState().kind).toBe("wiping"))
    expect(controller.nudgeDisplayOffline()).toBe(false)
    expect(performWipe).toHaveBeenCalledTimes(1)

    resolveWipe?.(report)
    await pending
    expect(controller.getState().kind).toBe(kind)
    expect(controller.nudgeDisplayOffline()).toBe(false)
    expect(performWipe).toHaveBeenCalledTimes(1)
  })

  it("does not wipe the install path when no sensitive row exists", async () => {
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: false }),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "eligible",
    })
    expect(performWipe).not.toHaveBeenCalled()
  })

  it("clears transient state only when wipeOnOnline is disabled", async () => {
    const resetTransient = vi.fn()
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe,
      readDecision: async () =>
        decision({ sensitiveDataExists: true, wipeOnOnline: false }),
    })
    controller.addTransientResetHandler(resetTransient)
    await controller.probe()
    expect(resetTransient).toHaveBeenCalledTimes(1)
    expect(performWipe).not.toHaveBeenCalled()
  })

  it("clears session receipts with other transient state", async () => {
    const subject: ReceiptSubject = {
      kind: "aes",
      recipientKeyId: "receipt-recipient",
      envelopeHash: "receipt-envelope",
    }
    expect(recordReceipt(subject, 100)).toEqual({ kind: "first-seen" })

    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: async () =>
        decision({ sensitiveDataExists: true, wipeOnOnline: false }),
    })
    await controller.probe()

    expect(recordReceipt(subject, 200)).toEqual({ kind: "first-seen" })
  })

  it("fails safe to wipe when preferences failed and sensitive data is confirmed", async () => {
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe,
      readDecision: async () =>
        decision({
          preferencesReadFailed: true,
          sensitiveDataExists: true,
          wipeOnOnline: true,
        }),
    })
    await controller.probe()
    expect(performWipe).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toEqual({ kind: "wiped" })
  })

  it("consumes an armed maintenance token without wiping", async () => {
    const consumeMaintenanceToken = vi.fn(async () => true)
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const resetTransient = vi.fn()
    const controller = createBootController({
      consumeMaintenanceToken,
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe,
      readDecision: async () =>
        decision({ maintenanceTokenArmed: true, sensitiveDataExists: true }),
    })
    controller.addTransientResetHandler(resetTransient)
    await controller.probe()
    expect(consumeMaintenanceToken).toHaveBeenCalledTimes(1)
    expect(performWipe).not.toHaveBeenCalled()
    expect(resetTransient).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "ineligible",
    })
  })

  it("publishes pending during a refresh and revokes a stale clean proof", async () => {
    let resolveRefresh: ((value: BootDecisionSnapshot) => void) | undefined
    const readDecision = vi
      .fn<() => Promise<BootDecisionSnapshot>>()
      .mockResolvedValueOnce(decision())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          }),
      )
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision,
    })
    const endSession = vi.fn()
    controller.registerRelaySessionEndHandler(endSession)
    await controller.probe()
    const eligibleState = controller.getState()
    expect(eligibleState).toEqual({
      kind: "network-confirmed",
      relayEligibility: "eligible",
    })

    const pendingRefresh = controller.refreshRelayEligibility()
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "pending",
    })
    resolveRefresh?.(
      decision({
        cleanOrigin: "indeterminate",
        sensitiveDataExists: false,
      }),
    )
    await expect(pendingRefresh).resolves.toBe(false)
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "ineligible",
    })
    expect(controller.getState()).not.toBe(eligibleState)
    expect(endSession).toHaveBeenCalledWith("eligibility-loss")
  })

  it("invalidates an eligible state synchronously on the peer-wipe boundary", async () => {
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: async () => decision(),
    })
    const endSession = vi.fn()
    controller.registerRelaySessionEndHandler(endSession)
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "eligible",
    })

    controller.endRelaySession("peer-wipe")
    expect(endSession).toHaveBeenCalledWith("peer-wipe")
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "ineligible",
    })
  })

  it("does not republish eligibility when a peer wipe arrives during a deferred decision", async () => {
    let resolveDecision: ((value: BootDecisionSnapshot) => void) | undefined
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: () =>
        new Promise((resolve) => {
          resolveDecision = resolve
        }),
    })
    const pendingProbe = controller.probe()
    await waitFor(() =>
      expect(controller.getState()).toEqual({
        kind: "network-confirmed",
        relayEligibility: "pending",
      }),
    )
    controller.endRelaySession("peer-wipe")
    resolveDecision?.(decision())
    await pendingProbe
    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "ineligible",
    })
  })

  it("does not authorize from a proof started before a peer wipe", async () => {
    let resolveFetch: ((value: Response) => void) | undefined
    const controller = createBootController({
      fetchImpl: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
      readDecision: async () => decision(),
    })
    const pendingProbe = controller.probe()
    expect(controller.getState().kind).toBe("probing")

    controller.endRelaySession("peer-wipe")
    resolveFetch?.(response("QR-CRYPT-REACHABLE"))
    await pendingProbe

    expect(controller.getState()).toEqual({
      kind: "network-confirmed",
      relayEligibility: "ineligible",
    })
  })

  it("stops the relay synchronously before invoking a local wipe executor", async () => {
    const order: string[] = []
    let stopped = false
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe: vi.fn(async ({ endSession }) => {
        order.push("barrier")
        expect(stopped).toBe(true)
        endSession()
        return { ok: true, failedSteps: [] }
      }),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })
    controller.registerRelaySessionEndHandler((reason) => {
      if (reason !== "local-wipe") return
      if (stopped) return
      stopped = true
      order.push("stop")
    })
    await controller.probe()
    expect(order).toEqual(["stop", "barrier"])
  })

  it("is idempotent across React StrictMode's double effect mount", async () => {
    const fetchImpl = vi.fn(async () => response("QR-CRYPT-REACHABLE"))
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl,
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })

    function Probe() {
      const state = useBootState({ controller })
      return <p>{state.kind}</p>
    }

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getByText("wiped")).toBeInTheDocument())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(performWipe).toHaveBeenCalledTimes(1)
  })
})

describe("WipeCoordinator order", () => {
  it("clears session receipts during the buffer-drop step", async () => {
    const subject: ReceiptSubject = {
      kind: "aes",
      recipientKeyId: "wipe-recipient",
      envelopeHash: "wipe-envelope",
    }
    expect(recordReceipt(subject, 100)).toEqual({ kind: "first-seen" })

    const coordinator = createWipeCoordinator({
      engageBarrier: () => undefined,
      disposeCrypto: () => undefined,
      coordinateTabs: () => undefined,
      withExclusiveLock: (operation) => operation(),
      bestEffortReset: async () => ({ ok: true, failedSteps: [] }),
    })
    await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      resetTransient: () => undefined,
    })

    expect(recordReceipt(subject, 200)).toEqual({ kind: "first-seen" })
  })

  it("runs the fail-closed sequence once in its frozen order", async () => {
    const order: string[] = []
    const coordinator = createWipeCoordinator({
      engageBarrier: () => {
        order.push("1-barrier")
      },
      disposeCrypto: () => {
        order.push("2-worker")
      },
      dropVaultKeyCache: () => {
        order.push("2-vault-cache")
      },
      coordinateTabs: () => {
        order.push("4-tabs")
      },
      withExclusiveLock: async <T,>(operation: () => Promise<T>) => {
        order.push("4-lock")
        return operation()
      },
      bestEffortReset: async () => {
        order.push("5-7-reset")
        return { ok: true, failedSteps: [] }
      },
    })

    const report = await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      endSession: () => order.push("0-relay"),
      resetTransient: () => order.push("3-transient"),
    })
    await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      endSession: () => order.push("unexpected-relay"),
      resetTransient: () => order.push("unexpected"),
    })

    expect(report).toEqual({ ok: true, failedSteps: [] })
    expect(order).toEqual([
      "0-relay",
      "1-barrier",
      "2-worker",
      "2-vault-cache",
      "3-transient",
      "4-tabs",
      "4-lock",
      "5-7-reset",
    ])
  })

  it("stops a relay before the barrier on a peer wipe broadcast", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | undefined
    class FakeBroadcastChannel {
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === "message") messageHandler = listener
      }
      close() {}
      postMessage() {}
      removeEventListener() {
        messageHandler = undefined
      }
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
    const order: string[] = []
    const remove = installWipeBroadcastListener(
      {
        endSession: () => order.push("relay-stop"),
        resetTransient: () => order.push("transient"),
      },
      {
        closeDatabase: () => order.push("close-db"),
        disposeCrypto: () => order.push("crypto"),
        dropVaultKeyCache: async () => {
          order.push("vault")
        },
        engageBarrier: () => order.push("barrier"),
      },
    )

    messageHandler?.(
      new MessageEvent("message", {
        data: { type: "qr-crypt-wipe-request", version: 1 },
      }),
    )
    expect(order.indexOf("relay-stop")).toBe(0)
    expect(order.indexOf("relay-stop")).toBeLessThan(order.indexOf("barrier"))
    await waitFor(() =>
      expect(order).toEqual([
        "relay-stop",
        "barrier",
        "crypto",
        "vault",
        "transient",
        "close-db",
      ]),
    )
    remove()
  })
})
