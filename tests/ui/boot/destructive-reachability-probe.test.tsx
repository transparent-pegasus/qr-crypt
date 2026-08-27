import "./boot-test-support"
import { describe, expect, it, vi } from "vitest"
import {
  BOOT_PROBE_TIMEOUT_MS,
  createBootController,
  probeNetworkSentinel,
} from "@/app/boot/boot-controller"
import { decision, response } from "../../helpers/boot-fixtures"

describe("destructive reachability probe", () => {
  it("requires status 200 and an exact, untrimmed sentinel body", async () => {
    const fetchImpl = vi.fn(async () => response("QR-CRYPT-REACHABLE"))
    await expect(
      probeNetworkSentinel({ fetchImpl, nonce: "fixed", timeoutMs: 50 }),
    ).resolves.toMatchObject({ confirmed: true })
    expect(fetchImpl).toHaveBeenCalledWith(
      "/reachability-sentinel.txt?n=fixed",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    )

    await expect(
      probeNetworkSentinel({
        fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE\n")),
        timeoutMs: 50,
      }),
    ).resolves.toMatchObject({ confirmed: false })
  })

  it.each([
    ["non-200", vi.fn(async () => response("QR-CRYPT-REACHABLE", 204))],
    ["body mismatch", vi.fn(async () => response("captive portal"))],
    ["fetch rejection", vi.fn(async () => Promise.reject(new TypeError("offline")))],
  ])("treats %s as offline", async (name, fetchImpl) => {
    const controller = createBootController({
      fetchImpl,
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await controller.probe()
    // A non-200 response is still an obtained response: evaluateDeploymentHeaders
    // marks the status field failed, so the deployment gate latches blocked
    // instead of confirming offline — and it is a checked failure, not a missing
    // verdict. Body mismatch / fetch rejection stay offline-confirmed.
    if (name === "non-200") {
      expect(controller.getState()).toEqual({
        kind: "blocked",
        reason: "deployment-failed",
      })
      return
    }
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })

  it("times out an unresponsive fetch", async () => {
    vi.useFakeTimers()
    const controller = createBootController({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
      probeTimeoutMs: BOOT_PROBE_TIMEOUT_MS,
      readConnectivityHint: () => "offline",
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
      readConnectivityHint: () => "offline",
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
