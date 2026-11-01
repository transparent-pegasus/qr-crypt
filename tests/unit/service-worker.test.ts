import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const workbox = vi.hoisted(() => ({
  clientsClaim: vi.fn(),
  skipWaiting: vi.fn(),
  precacheAndRoute: vi.fn<(manifest: unknown) => void>(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
  handler: vi.fn(),
  NavigationRoute: vi.fn(class NavigationRoute {}),
  NetworkOnly: vi.fn(class NetworkOnly {}),
  registerRoute: vi.fn<(route: unknown, handler?: unknown) => void>(),
}))

vi.mock("workbox-core", () => ({
  clientsClaim: workbox.clientsClaim,
  skipWaiting: workbox.skipWaiting,
}))
vi.mock("workbox-precaching", () => ({
  precacheAndRoute: workbox.precacheAndRoute,
  cleanupOutdatedCaches: workbox.cleanupOutdatedCaches,
  createHandlerBoundToURL: workbox.createHandlerBoundToURL,
}))
vi.mock("workbox-routing", () => ({
  NavigationRoute: workbox.NavigationRoute,
  registerRoute: workbox.registerRoute,
}))
vi.mock("workbox-strategies", () => ({
  NetworkOnly: workbox.NetworkOnly,
}))

describe("service worker", () => {
  const manifest = [{ url: "index.html", revision: "r" }]
  const addEventListener = vi.fn<(type: string, listener: unknown) => void>()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    workbox.createHandlerBoundToURL.mockReturnValue(workbox.handler)
    vi.stubGlobal("__PRECACHE_MANIFEST__", manifest)
    vi.stubGlobal("skipWaiting", workbox.skipWaiting)
    vi.stubGlobal("addEventListener", addEventListener)
  })

  afterEach(() => vi.unstubAllGlobals())

  it("registers the fixed route table in order", async () => {
    await import("../../src/sw/service-worker")

    expect(workbox.clientsClaim).toHaveBeenCalledExactlyOnceWith()
    expect(workbox.precacheAndRoute).toHaveBeenCalledExactlyOnceWith(manifest)
    expect(workbox.precacheAndRoute.mock.calls[0]![0]).toBe(manifest)
    expect(workbox.cleanupOutdatedCaches).toHaveBeenCalledExactlyOnceWith()
    expect(workbox.createHandlerBoundToURL).toHaveBeenCalledExactlyOnceWith("/index.html")
    expect(workbox.NavigationRoute).toHaveBeenCalledExactlyOnceWith(workbox.handler, {
      denylist: [/^\/about\//],
    })
    expect(workbox.NetworkOnly).toHaveBeenCalledExactlyOnceWith()
    expect(workbox.registerRoute).toHaveBeenCalledTimes(2)
    expect(workbox.registerRoute).toHaveBeenNthCalledWith(
      1,
      expect.any(workbox.NavigationRoute),
    )
    expect(workbox.registerRoute).toHaveBeenNthCalledWith(
      2,
      /\/reachability-sentinel\.txt/,
      expect.any(workbox.NetworkOnly),
    )

    const order = [
      workbox.clientsClaim.mock.invocationCallOrder[0]!,
      workbox.precacheAndRoute.mock.invocationCallOrder[0]!,
      workbox.cleanupOutdatedCaches.mock.invocationCallOrder[0]!,
      workbox.registerRoute.mock.invocationCallOrder[0]!,
      workbox.registerRoute.mock.invocationCallOrder[1]!,
    ]
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it("never skips waiting or listens for messages", async () => {
    await import("../../src/sw/service-worker")

    expect(workbox.skipWaiting).not.toHaveBeenCalled()
    expect(addEventListener.mock.calls.filter(([type]) => type === "message")).toEqual([])
  })
})
