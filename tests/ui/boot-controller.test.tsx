import { StrictMode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BOOT_PROBE_TIMEOUT_MS,
  createBootController,
  probeNetworkSentinel,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { useBootState } from "@/app/boot/use-boot-state"
import { createWipeCoordinator } from "@/app/boot/wipe-coordinator"

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
  return {
    wipeOnOnline: true,
    sensitiveDataExists: false,
    maintenanceTokenArmed: false,
    resetChurnMb: 0,
    preferencesReadFailed: false,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("destructive reachability probe", () => {
  it("requires status 200 and an exact, untrimmed sentinel body", async () => {
    const fetchImpl = vi.fn(async () => response("QRYPT-REACHABLE"))
    await expect(
      probeNetworkSentinel({ fetchImpl, nonce: "fixed", timeoutMs: 50 }),
    ).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      "/reachability-sentinel.txt?n=fixed",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    )

    await expect(
      probeNetworkSentinel({
        fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE\n")),
        timeoutMs: 50,
      }),
    ).resolves.toBe(false)
  })

  it.each([
    ["non-200", vi.fn(async () => response("QRYPT-REACHABLE", 204))],
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
    resolvers[0]?.(response("QRYPT-REACHABLE"))
    await first
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })
})

describe("boot decisions", () => {
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
        fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
        performWipe,
        readDecision: async () =>
          decision({ maintenanceTokenArmed: true, sensitiveDataExists: true }),
      })
      controller.addTransientResetHandler(resetTransient)

      const pendingProbe = controller.probe()
      await waitFor(() =>
        expect(controller.getState()).toEqual({ kind: "network-confirmed" }),
      )
      expect(controller.nudgeDisplayOffline()).toBe(true)
      expect(controller.nudgeDisplayOffline()).toBe(false)
      expect(controller.getState()).toEqual({ kind: "network-confirmed" })

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
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      readDecision: async () => decision(),
    })
    controller.subscribe(() => {
      if (controller.getState().kind === "network-confirmed") order.push("publish")
    })

    await controller.probe()

    expect(order).toEqual(["marker", "publish"])
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
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
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
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: false }),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({ kind: "network-confirmed" })
    expect(performWipe).not.toHaveBeenCalled()
  })

  it("clears transient state only when wipeOnOnline is disabled", async () => {
    const resetTransient = vi.fn()
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe,
      readDecision: async () =>
        decision({ sensitiveDataExists: true, wipeOnOnline: false }),
    })
    controller.addTransientResetHandler(resetTransient)
    await controller.probe()
    expect(resetTransient).toHaveBeenCalledTimes(1)
    expect(performWipe).not.toHaveBeenCalled()
  })

  it("fails safe to wipe when preferences failed and sensitive data is confirmed", async () => {
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
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
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe,
      readDecision: async () =>
        decision({ maintenanceTokenArmed: true, sensitiveDataExists: true }),
    })
    controller.addTransientResetHandler(resetTransient)
    await controller.probe()
    expect(consumeMaintenanceToken).toHaveBeenCalledTimes(1)
    expect(performWipe).not.toHaveBeenCalled()
    expect(resetTransient).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toEqual({ kind: "network-confirmed" })
  })

  it("is idempotent across React StrictMode's double effect mount", async () => {
    const fetchImpl = vi.fn(async () => response("QRYPT-REACHABLE"))
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
      resetTransient: () => order.push("3-transient"),
    })
    await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      resetTransient: () => order.push("unexpected"),
    })

    expect(report).toEqual({ ok: true, failedSteps: [] })
    expect(order).toEqual([
      "1-barrier",
      "2-worker",
      "2-vault-cache",
      "3-transient",
      "4-tabs",
      "4-lock",
      "5-7-reset",
    ])
  })
})
