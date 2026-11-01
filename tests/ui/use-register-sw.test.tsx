import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useDefaultRegisterSW,
  type RegisterSwOptions,
} from "@/hooks/use-register-sw"
import { deferred, type Deferred } from "../helpers/deferred"

class FakeWorker extends EventTarget {
  onstatechange: ((event: Event) => void) | null = null

  constructor(public state: ServiceWorkerState = "installing") {
    super()
  }

  transitionTo(state: ServiceWorkerState) {
    this.state = state
    const event = new Event("statechange")
    this.dispatchEvent(event)
    this.onstatechange?.(event)
  }
}

function registration({
  installing = null,
  waiting = null,
  active = null,
}: {
  installing?: FakeWorker | null
  waiting?: FakeWorker | null
  active?: FakeWorker | null
} = {}): ServiceWorkerRegistration {
  return Object.assign(new EventTarget(), {
    installing,
    waiting,
    active,
    scope: "/",
    onupdatefound: null,
  }) as unknown as ServiceWorkerRegistration
}

describe("useDefaultRegisterSW", () => {
  let original: PropertyDescriptor | undefined
  let pending: Deferred<ServiceWorkerRegistration>
  const getRegistration = vi.fn<
    (scope: string) => Promise<ServiceWorkerRegistration | undefined>
  >()
  const register = vi.fn<
    (script: string, options: RegistrationOptions) => Promise<ServiceWorkerRegistration>
  >()
  const onRegisterError = vi.fn<(error: unknown) => void>()

  beforeEach(() => {
    vi.stubEnv("PROD", true)
    vi.clearAllMocks()
    pending = deferred<ServiceWorkerRegistration>()
    getRegistration.mockResolvedValue(undefined)
    register.mockImplementation(() => pending.promise)
    original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        getRegistration,
        register,
        controller: null,
      }),
    })
  })

  afterEach(() => {
    cleanup()
    if (original) Object.defineProperty(navigator, "serviceWorker", original)
    else Reflect.deleteProperty(navigator, "serviceWorker")
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function resolveRegistration(value: ServiceWorkerRegistration) {
    await act(async () => {
      pending.resolve(value)
    })
  }

  it("registers /sw.js at root scope once", async () => {
    const lookup = deferred<ServiceWorkerRegistration | undefined>()
    getRegistration.mockReturnValueOnce(lookup.promise)
    const { result, rerender } = renderHook(
      (options: RegisterSwOptions) => useDefaultRegisterSW(options),
      { initialProps: { onRegisterError } },
    )

    expect(result.current).toEqual({ offlineReady: false })
    expect(getRegistration).toHaveBeenCalledExactlyOnceWith("/")
    expect(register).not.toHaveBeenCalled()
    await act(async () => lookup.resolve(undefined))
    expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" })
    expect(getRegistration.mock.invocationCallOrder[0]).toBeLessThan(
      register.mock.invocationCallOrder[0]!,
    )
    await resolveRegistration(registration())

    rerender({ onRegisterError: vi.fn() })
    expect(getRegistration).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(1)
  })

  it("first install reports ready at installed", async () => {
    const installing = new FakeWorker()
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    expect(result.current.offlineReady).toBe(false)
    await resolveRegistration(registration({ installing }))
    expect(result.current.offlineReady).toBe(false)

    act(() => installing.transitionTo("installed"))
    expect(result.current.offlineReady).toBe(true)
    expect(onRegisterError).not.toHaveBeenCalled()
  })

  it.each([
    ["installed", true],
    ["redundant", false],
  ] as const)(
    "first install with delayed updatefound reaches %s (offlineReady: %s)",
    async (state, offlineReady) => {
      const registered = registration()
      const installing = new FakeWorker()
      const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
      await resolveRegistration(registered)
      expect(result.current.offlineReady).toBe(false)

      act(() => {
        Object.assign(registered, { installing })
        registered.dispatchEvent(new Event("updatefound"))
      })
      expect(result.current.offlineReady).toBe(false)

      act(() => installing.transitionTo(state))
      expect(result.current.offlineReady).toBe(offlineReady)
      expect(onRegisterError).not.toHaveBeenCalled()
    },
  )

  it.each(["activating", "activated"] as const)(
    "first install reports ready at %s",
    async (state) => {
      const installing = new FakeWorker()
      const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
      await resolveRegistration(registration({ installing }))
      expect(result.current.offlineReady).toBe(false)

      act(() => installing.transitionTo(state))
      expect(result.current.offlineReady).toBe(true)
    },
  )

  it("first install already installed when registration resolves", async () => {
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(registration({ waiting: new FakeWorker("installed") }))

    expect(getRegistration).toHaveBeenCalledExactlyOnceWith("/")
    expect(result.current.offlineReady).toBe(true)
  })

  it("first install already activated when registration resolves", async () => {
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(registration({ active: new FakeWorker("activated") }))

    expect(getRegistration).toHaveBeenCalledExactlyOnceWith("/")
    expect(result.current.offlineReady).toBe(true)
  })

  it("first install already activating when registration resolves", async () => {
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(registration({ active: new FakeWorker("activating") }))

    expect(result.current.offlineReady).toBe(true)
  })

  it("returning visit never reports ready", async () => {
    const existing = registration({ active: new FakeWorker("activated") })
    getRegistration.mockResolvedValue(existing)
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(existing)

    expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" })
    expect(result.current.offlineReady).toBe(false)
  })

  it("update install never reports offline readiness", async () => {
    const active = new FakeWorker("activated")
    const installing = new FakeWorker()
    getRegistration.mockResolvedValue(registration({ active }))
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(registration({ active, installing }))
    expect(result.current.offlineReady).toBe(false)

    act(() => installing.transitionTo("installed"))
    expect(result.current.offlineReady).toBe(false)
    act(() => installing.transitionTo("activated"))
    expect(result.current.offlineReady).toBe(false)
  })

  it("update with delayed updatefound never reports offline readiness", async () => {
    const active = new FakeWorker("activated")
    const installing = new FakeWorker()
    getRegistration.mockResolvedValue(registration({ active }))
    const registered = registration({ active })
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(registered)
    expect(result.current.offlineReady).toBe(false)

    act(() => {
      Object.assign(registered, { installing })
      registered.dispatchEvent(new Event("updatefound"))
    })
    expect(result.current.offlineReady).toBe(false)

    act(() => installing.transitionTo("installed"))
    expect(result.current.offlineReady).toBe(false)
    act(() => installing.transitionTo("activated"))
    expect(result.current.offlineReady).toBe(false)
    expect(onRegisterError).not.toHaveBeenCalled()
  })

  it("redundant install never reports ready", async () => {
    const installing = new FakeWorker()
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await resolveRegistration(registration({ installing }))

    act(() => installing.transitionTo("redundant"))
    expect(result.current.offlineReady).toBe(false)
    expect(onRegisterError).not.toHaveBeenCalled()
  })

  it("registration failure calls onRegisterError", async () => {
    const error = new Error("registration failed")
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))

    await act(async () => pending.reject(error))
    expect(register).toHaveBeenCalledTimes(1)
    expect(onRegisterError).toHaveBeenCalledExactlyOnceWith(error)
    expect(result.current.offlineReady).toBe(false)
  })

  it("unmount before delayed updatefound ignores the worker", async () => {
    const registered = registration()
    const installing = new FakeWorker()
    const listen = vi.spyOn(installing, "addEventListener")
    const { result, unmount } = renderHook(() =>
      useDefaultRegisterSW({ onRegisterError }),
    )
    await resolveRegistration(registered)
    expect(result.current.offlineReady).toBe(false)
    unmount()

    act(() => {
      Object.assign(registered, { installing })
      registered.dispatchEvent(new Event("updatefound"))
      installing.transitionTo("installed")
    })

    expect(result.current.offlineReady).toBe(false)
    expect(listen).not.toHaveBeenCalled()
    expect(installing.onstatechange).toBeNull()
    expect(onRegisterError).not.toHaveBeenCalled()
  })

  it.each(["resolve", "reject"] as const)(
    "unmount before settle is silent (%s)",
    async (outcome) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const warningLog = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const { result, unmount } = renderHook(() =>
        useDefaultRegisterSW({ onRegisterError }),
      )
      await act(async () => {})
      expect(register).toHaveBeenCalledTimes(1)
      expect(result.current.offlineReady).toBe(false)
      unmount()

      await act(async () => {
        if (outcome === "resolve") {
          pending.resolve(registration({ waiting: new FakeWorker("installed") }))
        } else {
          pending.reject(new Error("late registration failure"))
        }
      })

      expect(result.current.offlineReady).toBe(false)
      expect(onRegisterError).not.toHaveBeenCalled()
      expect(errorLog).not.toHaveBeenCalled()
      expect(warningLog).not.toHaveBeenCalled()
    },
  )

  it("no service worker support is a no-op", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker")
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await act(async () => {})

    expect(result.current.offlineReady).toBe(false)
    expect(getRegistration).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(onRegisterError).not.toHaveBeenCalled()
  })

  it("dev build never registers", async () => {
    vi.stubEnv("PROD", false)
    const { result } = renderHook(() => useDefaultRegisterSW({ onRegisterError }))
    await act(async () => {})

    expect(result.current.offlineReady).toBe(false)
    expect(getRegistration).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(onRegisterError).not.toHaveBeenCalled()
  })
})
