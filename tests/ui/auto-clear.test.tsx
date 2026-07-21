import "./helpers/module-mocks"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "@/schemas/env-schema"
import { resetUi } from "./helpers/render-app"

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
}

describe("useAutoClear fixed deadline semantics", () => {
  beforeEach(() => {
    resetUi()
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
