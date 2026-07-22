import { vi } from "vitest"

export function stubReachabilityFetch(reachable: boolean) {
  const fetchMock = vi.fn((): Promise<Response> => {
    if (reachable) return Promise.resolve({ status: 503 } as Response)
    return Promise.reject(new TypeError("Network request failed"))
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

export function setTestOnlineStatus(
  online: boolean,
  { emit = false, reachable = online }: { emit?: boolean; reachable?: boolean } = {},
): void {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
  })
  stubReachabilityFetch(reachable)
  if (emit) window.dispatchEvent(new Event(online ? "online" : "offline"))
}
