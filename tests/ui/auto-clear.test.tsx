import "./helpers/module-mocks"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "@/schemas/env-schema"
import { mockWebAssemblyProbe, probeWebAssemblyRuntime } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe("useAutoClear fixed deadline semantics", () => {
  beforeEach(() => {
    resetUi()
    mockWebAssemblyProbe(true)
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"))
    setVisibility("visible")
  })

  afterEach(() => {
    setVisibility("visible")
    vi.useRealTimers()
    resetUi()
  })

  it("clears immediately on return when the fixed env deadline passed", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: true, onClear })
      return null
    }
    render(<Harness />)

    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    vi.setSystemTime(Date.now() + (env.autoClearSeconds + 1) * 1000)
    expect(onClear).not.toHaveBeenCalled()
    act(() => {
      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("uses env.autoClearSeconds as the non-configurable delay", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: true, onClear })
      return null
    }
    render(<Harness />)
    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    act(() => vi.advanceTimersByTime(env.autoClearSeconds * 1000 - 1))
    expect(onClear).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("uses env.autoClearSeconds when the WebAssembly runtime probe succeeds", async () => {
    mockWebAssemblyProbe(true)
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: true, onClear })
      return null
    }
    render(<Harness />)
    await act(async () => undefined)
    expect(probeWebAssemblyRuntime).toHaveBeenCalled()

    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    act(() => vi.advanceTimersByTime(env.autoClearSeconds * 1000 - 1))
    expect(onClear).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("uses env.autoClearFallbackSeconds when the WebAssembly runtime probe fails", async () => {
    mockWebAssemblyProbe(false)
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: true, onClear })
      return null
    }
    render(<Harness />)
    await act(async () => undefined)
    expect(probeWebAssemblyRuntime).toHaveBeenCalled()

    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    act(() => vi.advanceTimersByTime(env.autoClearFallbackSeconds * 1000 - 1))
    expect(onClear).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("uses the fallback delay for the first schedule when mounting hidden after the probe settled false", async () => {
    const runtimeProbe = deferred<boolean>()
    runtimeProbe.resolve(false)
    await runtimeProbe.promise
    mockWebAssemblyProbe(runtimeProbe.promise)
    setVisibility("hidden")
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: true, onClear })
      return null
    }
    render(<Harness />)

    act(() => vi.advanceTimersByTime(env.autoClearSeconds * 1000))
    expect(onClear).not.toHaveBeenCalled()
    act(() =>
      vi.advanceTimersByTime(
        (env.autoClearFallbackSeconds - env.autoClearSeconds) * 1000 - 1,
      ),
    )
    expect(onClear).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("keeps a fail-secure pending deadline and applies fallback only next time", async () => {
    const runtimeProbe = deferred<boolean>()
    mockWebAssemblyProbe(runtimeProbe.promise)
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: true, onClear })
      return null
    }
    render(<Harness />)

    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      vi.advanceTimersByTime(env.autoClearSeconds * 1000 - 1)
    })
    expect(onClear).not.toHaveBeenCalled()

    await act(async () => {
      runtimeProbe.resolve(false)
      await runtimeProbe.promise
    })
    act(() => vi.advanceTimersByTime(1))
    expect(onClear).toHaveBeenCalledTimes(1)

    act(() => {
      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      vi.advanceTimersByTime(env.autoClearFallbackSeconds * 1000 - 1)
    })
    expect(onClear).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(onClear).toHaveBeenCalledTimes(2)
  })

  it("does nothing while background clearing is disabled", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ enabled: false, onClear })
      return null
    }
    render(<Harness />)
    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      vi.advanceTimersByTime((env.autoClearSeconds + 1) * 1000)
    })
    expect(onClear).not.toHaveBeenCalled()
  })

  it("cancels a pending deadline when disabled or unmounted", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness({ enabled }: { enabled: boolean }) {
      useAutoClear({ enabled, onClear })
      return null
    }
    const view = render(<Harness enabled />)
    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    view.rerender(<Harness enabled={false} />)
    act(() => vi.advanceTimersByTime((env.autoClearSeconds + 1) * 1000))
    expect(onClear).not.toHaveBeenCalled()

    view.rerender(<Harness enabled />)
    view.unmount()
    act(() => vi.advanceTimersByTime((env.autoClearSeconds + 1) * 1000))
    expect(onClear).not.toHaveBeenCalled()
  })
})
