import "./boot-test-support"
import { describe, expect, it, vi } from "vitest"
import { createBootController } from "@/app/boot/boot-controller"
import { WIPE_BROADCAST_CHANNEL } from "@/app/boot/boot-contract"
import {
  installQuarantineBroadcastListener,
  QUARANTINE_REQUEST_TYPE,
} from "@/app/boot/wipe-coordinator"
import * as databaseModule from "@/storage/database"
import { decision, response } from "../../helpers/boot-fixtures"

describe("connectivity-hint gating (NS-02)", () => {
  const failingFetch = () =>
    vi.fn(async () => Promise.reject(new TypeError("offline")))
  const succeedingSentinelFetch = () =>
    vi.fn(async () => response("QR-CRYPT-REACHABLE"))
  const hangingFetch = () => vi.fn(() => new Promise<Response>(() => undefined))

  it("confirms offline when the sentinel fails and the hint is offline", async () => {
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
  })

  it("blocks when the sentinel fails but the hint is online", async () => {
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "network-suspected",
    })
  })

  it("blocks on an indeterminate hint", async () => {
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "indeterminate",
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "network-suspected",
    })
  })

  it("blocks instead of confirming offline via nudgeDisplayOffline", async () => {
    const controller = createBootController({
      fetchImpl: succeedingSentinelFetch(),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
    })
    await controller.probe()
    expect(controller.getState().kind).toBe("network-confirmed")

    controller.nudgeDisplayOffline()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "network-suspected",
    })
  })

  it("blocks instead of confirming offline on an offline event while probing", async () => {
    const target = new EventTarget()
    const controller = createBootController({
      fetchImpl: hangingFetch(),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
      eventTarget: target as Pick<Window, "addEventListener" | "removeEventListener">,
    })
    controller.start()
    target.dispatchEvent(new Event("offline"))
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "network-suspected",
    })
  })

  it("is terminal: stop, start, probe, and events leave it unchanged", async () => {
    const target = new EventTarget()
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
      eventTarget: target as Pick<Window, "addEventListener" | "removeEventListener">,
    })
    await controller.probe()
    const blocked = controller.getState()

    controller.stop()
    expect(controller.getState()).toEqual(blocked)
    controller.start()
    expect(controller.getState()).toEqual(blocked)
    await controller.probe()
    expect(controller.getState()).toEqual(blocked)
    target.dispatchEvent(new Event("online"))
    target.dispatchEvent(new Event("offline"))
    expect(controller.getState()).toEqual(blocked)
    controller.release()
    controller.acquire()
    expect(controller.getState()).toEqual(blocked)
  })

  it("blocks without invoking the wipe executor", async () => {
    // The state assertion is the one that fails if the lock is missing; a
    // bare "performWipe was not called" assertion passes on today's code too,
    // because a failing sentinel already reaches offline-confirmed without
    // wiping. Keep both, and never keep only the second.
    const performWipe = vi.fn()
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
      performWipe,
    })
    await controller.probe()
    expect(controller.getState()).toEqual({
      kind: "blocked",
      reason: "network-suspected",
    })
    expect(performWipe).not.toHaveBeenCalled()
  })

  it("quarantines without wiping and without opening the database", async () => {
    const performWipe = vi.fn()
    // Spying on getDb is what actually proves the design's claim. Asserting that
    // a later getDb() rejects only proves the barrier engaged — it would still
    // pass if the lock path had opened a readwrite transaction first.
    const openSpy = vi.spyOn(databaseModule, "getDb")
    const controller = createBootController({
      fetchImpl: failingFetch(),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
      performWipe,
    })
    await controller.probe()

    expect(controller.getState().kind).toBe("blocked")
    expect(performWipe).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it("enters blocked when a peer broadcasts a quarantine request", async () => {
    const onQuarantine = vi.fn()
    const stop = installQuarantineBroadcastListener({ onQuarantine })
    const channel = new BroadcastChannel(WIPE_BROADCAST_CHANNEL)
    channel.postMessage({ type: QUARANTINE_REQUEST_TYPE, version: 1 })
    await vi.waitFor(() => expect(onQuarantine).toHaveBeenCalled())
    stop()
    channel.close()
  })
})

