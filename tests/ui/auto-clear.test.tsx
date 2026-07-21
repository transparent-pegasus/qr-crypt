import "./helpers/module-mocks"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetUi } from "./helpers/render-app"

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
}

describe("useAutoClear deadline semantics", () => {
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

  it("clears immediately on return when the hidden deadline passed even if the timer stalled", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ seconds: 60, onClear })
      return null
    }
    render(<Harness />)

    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    vi.setSystemTime(new Date("2026-07-21T00:01:01Z"))
    expect(onClear).not.toHaveBeenCalled()
    act(() => {
      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("clears immediately for a zero-second setting", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ seconds: 0, onClear })
      return null
    }
    render(<Harness />)
    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("recalculates the deadline when the setting changes while hidden", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness({ seconds }: { seconds: number }) {
      useAutoClear({ seconds, onClear })
      return null
    }
    const view = render(<Harness seconds={300} />)
    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    vi.setSystemTime(new Date("2026-07-21T00:02:00Z"))
    view.rerender(<Harness seconds={60} />)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("removes listeners and pending timers on unmount", async () => {
    const { useAutoClear } = await import("@/hooks/use-auto-clear")
    const onClear = vi.fn()
    function Harness() {
      useAutoClear({ seconds: 60, onClear })
      return null
    }
    const view = render(<Harness />)
    act(() => {
      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    view.unmount()
    act(() => vi.advanceTimersByTime(120_000))
    expect(onClear).not.toHaveBeenCalled()
  })
})
