import "./boot-test-support"
import { describe, expect, it, vi } from "vitest"
import {
  createBootController,
  readDeploymentVerdict,
} from "@/app/boot/boot-controller"
import type { DeploymentVerdict } from "@/lib/deployment-headers"
import {
  decision,
  response,
  responseMissingHeader,
} from "../../helpers/boot-fixtures"

describe("deployment verdict (NS-08)", () => {
  const conformingSentinelFetch = () =>
    vi.fn(async () => response("QR-CRYPT-REACHABLE"))
  const failingFetch = () =>
    vi.fn(async () => Promise.reject(new TypeError("offline")))
  const sentinelFetchWithout = (header: string) =>
    vi.fn(async () => responseMissingHeader("QR-CRYPT-REACHABLE", header))
  const decisionWithVerdict = (verdict: DeploymentVerdict | undefined) => async () => {
    if (verdict === undefined) {
      const base = decision()
      return {
        wipeOnOnline: base.wipeOnOnline,
        sensitiveDataExists: base.sensitiveDataExists,
        cleanOrigin: base.cleanOrigin,
        maintenanceTokenArmed: base.maintenanceTokenArmed,
        resetChurnMb: base.resetChurnMb,
        preferencesReadFailed: base.preferencesReadFailed,
      }
    }
    return decision({ deploymentVerdict: verdict })
  }

  it("persists a passing verdict from the sentinel response", async () => {
    const controller = createBootController({
      fetchImpl: conformingSentinelFetch(),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await controller.probe()
    const stored = await readDeploymentVerdict()
    expect(stored?.status).toBe("pass")
  })

  it("blocks when the sentinel response is missing security headers", async () => {
    const controller = createBootController({
      fetchImpl: sentinelFetchWithout("x-frame-options"),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "deployment-failed",
    })
  })

  it("blocks on a later boot when no verdict was ever persisted", async () => {
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "offline",
      readDecision: decisionWithVerdict(undefined),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "deployment-unverified",
    })
  })

  it("blocks on a later boot when the persisted verdict failed", async () => {
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "offline",
      readDecision: decisionWithVerdict({
        status: "fail",
        failedFields: ["x-frame-options"],
        checkedAt: 5,
      }),
    })
    await controller.probe()
    expect(controller.getState().kind).toBe("blocked")
  })

  it("honours this episode's pass without re-reading storage", async () => {
    // network-confirmed -> PASS -> server stopped -> display offline
    const controller = createBootController({
      fetchImpl: conformingSentinelFetch(),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState().kind).toBe("network-confirmed")
    controller.nudgeDisplayOffline()
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })

  it("blocks without wiping when the verdict fails", async () => {
    const performWipe = vi.fn()
    const controller = createBootController({
      fetchImpl: sentinelFetchWithout("cross-origin-opener-policy"),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
      performWipe,
    })
    await controller.probe()
    // Both halves matter: the state assertion is what detects a missing
    // implementation, the wipe assertion is what detects an over-reaction.
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "deployment-failed",
    })
    expect(performWipe).not.toHaveBeenCalled()
  })

  it("refuses the router when the boot decision could not be read", async () => {
    // readBootDecision returns FALLBACK_DECISION on an open failure
    // (boot-controller.ts), which carries no verdict. Under D8 an
    // absent verdict refuses, and it must still not wipe.
    const performWipe = vi.fn()
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "offline",
      readDecision: () => Promise.reject(new Error("storage open failed")),
      performWipe,
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "deployment-unverified",
    })
    expect(performWipe).not.toHaveBeenCalled()
  })
})
