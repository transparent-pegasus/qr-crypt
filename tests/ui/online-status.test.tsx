import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { probeReachability } from "@/lib/reachability"
import { setTestOnlineStatus, stubReachabilityFetch } from "./helpers/network"
import { resetUi } from "./helpers/render-app"

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
}

async function flushProbe(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("active reachability detection", () => {
  beforeEach(() => {
    resetUi()
    setVisibility("visible")
  })

  afterEach(() => {
    resetUi()
    setVisibility("visible")
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("treats any resolved HEAD response as reachable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ({ status: 503 }) as Response)
    vi.stubGlobal("fetch", fetchMock)

    await expect(probeReachability()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/manifest\.webmanifest\?reach=.+/),
      expect.objectContaining({
        method: "HEAD",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it("treats a rejected request as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError("unreachable"))),
    )

    await expect(probeReachability()).resolves.toBe(false)
  })

  it("aborts a timed-out request and reports it as unreachable", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      void input
      signal = init?.signal
      return new Promise<Response>(() => undefined)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = probeReachability(100)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
  })

  it("does not commit a true navigator hint when the immediate probe fails", async () => {
    setTestOnlineStatus(true, { reachable: false })

    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)

    await flushProbe()
    expect(result.current).toBe(false)
  })

  it("commits an initial online hint only after the probe succeeds", async () => {
    setTestOnlineStatus(true)

    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)

    await flushProbe()
    expect(result.current).toBe(true)
  })

  it.each([
    "online",
    "indeterminate",
    "non-boolean",
    "missing navigator",
    "throwing",
  ] as const)(
    "keeps confirmed online status across failed polls when the hint is %s",
    async (hint) => {
      vi.useFakeTimers()
      setTestOnlineStatus(true)
      const { result } = renderHook(() => useOnlineStatus())
      await act(async () => vi.advanceTimersByTimeAsync(0))
      expect(result.current).toBe(true)

      if (hint === "missing navigator") vi.stubGlobal("navigator", undefined)
      else
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get() {
            if (hint === "throwing") throw new Error("hint unavailable")
            if (hint === "non-boolean") return 0
            return hint === "online" ? true : undefined
          },
        })
      const failedFetch = stubReachabilityFetch(false)

      try {
        for (let poll = 1; poll <= 3; poll += 1) {
          await act(async () => vi.advanceTimersByTimeAsync(4_000))
          expect(failedFetch).toHaveBeenCalledTimes(poll)
          expect(result.current).toBe(true)
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it("keeps confirmed online status when a later display probe times out", async () => {
    vi.useFakeTimers()
    setTestOnlineStatus(true)
    const { result } = renderHook(() => useOnlineStatus())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toBe(true)

    let signal: AbortSignal | null | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        signal = init?.signal
        return new Promise<Response>(() => undefined)
      }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(signal?.aborted).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(3_000))

    expect(signal?.aborted).toBe(true)
    expect(navigator.onLine).toBe(true)
    expect(result.current).toBe(true)
  })

  it("handles the offline event immediately without starting another probe", async () => {
    vi.useFakeTimers()
    setTestOnlineStatus(true)
    let signal: AbortSignal | null | undefined
    let finishProbe: ((response: Response) => void) | undefined
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ status: 204 } as Response)
      .mockImplementation((_input, init) => {
        signal = init?.signal
        return new Promise<Response>((resolve) => {
          finishProbe = resolve
        })
      })
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useOnlineStatus())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(signal?.aborted).toBe(false)

    // The explicit event is authoritative even if the hint has not caught up.
    act(() => window.dispatchEvent(new Event("offline")))

    expect(result.current).toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => finishProbe?.({ status: 204 } as Response))
    expect(result.current).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("switches from the online interval to the offline interval and back", async () => {
    vi.useFakeTimers()
    setTestOnlineStatus(true)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ status: 204 } as Response)
      .mockRejectedValueOnce(new TypeError("unreachable"))
      .mockResolvedValueOnce({ status: 204 } as Response)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(3_999))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // No event: a failed poll must still observe an explicit offline hint.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false })
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(false)

    await act(async () => vi.advanceTimersByTimeAsync(14_999))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true })
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current).toBe(true)
  })

  it("probes on online and visible events but not while hidden", async () => {
    const { result } = renderHook(() => useOnlineStatus())
    await flushProbe()
    expect(result.current).toBe(false)

    act(() => setTestOnlineStatus(true, { emit: true }))
    await flushProbe()
    expect(result.current).toBe(true)

    act(() => setTestOnlineStatus(false, { emit: true }))
    const fetchMock = stubReachabilityFetch(true)
    setVisibility("hidden")
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    await flushProbe()
    expect(fetchMock).not.toHaveBeenCalled()

    setVisibility("visible")
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    await flushProbe()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it("aborts an in-flight probe and clears polling on unmount", async () => {
    vi.useFakeTimers()
    setTestOnlineStatus(true)
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      void input
      signal = init?.signal
      return new Promise<Response>(() => undefined)
    })
    vi.stubGlobal("fetch", fetchMock)
    const { unmount } = renderHook(() => useOnlineStatus())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
