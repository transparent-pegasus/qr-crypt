import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useCompatibilityMode } from "@/hooks/use-compatibility-mode"
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  type Preferences,
} from "@/schemas/domain"
import { deferred } from "../helpers/deferred"

describe("useCompatibilityMode", () => {
  it("commits while active", async () => {
    const updatePreferences = vi.fn((patch: Partial<Preferences>) => {
      void patch
      return Promise.resolve(COMPATIBLE_GENERATED_DISPLAY_PAIR)
    })
    const { result } = renderHook(() =>
      useCompatibilityMode({ updatePreferences, active: true }),
    )

    await act(async () => {
      await result.current.change(true)
    })
    await act(async () => {
      await result.current.change(false)
    })

    expect(updatePreferences).toHaveBeenCalledTimes(2)
    expect(updatePreferences).toHaveBeenNthCalledWith(1, {
      frameBytes: COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes,
      frameIntervalMs: COMPATIBLE_GENERATED_DISPLAY_PAIR.frameIntervalMs,
    })
    expect(updatePreferences).toHaveBeenNthCalledWith(2, {
      frameBytes: DEFAULT_GENERATED_DISPLAY_PAIR.frameBytes,
      frameIntervalMs: DEFAULT_GENERATED_DISPLAY_PAIR.frameIntervalMs,
    })
    expect(result.current.updating).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("surfaces a storage failure while active", async () => {
    const write = deferred<unknown>()
    const updatePreferences = vi.fn((patch: Partial<Preferences>) => {
      void patch
      return write.promise
    })
    const { result } = renderHook(() =>
      useCompatibilityMode({ updatePreferences, active: true }),
    )
    let changePromise!: Promise<void>

    act(() => {
      changePromise = result.current.change(true)
    })
    expect(result.current.updating).toBe(true)

    await act(async () => {
      write.reject(new Error("storage unavailable"))
      await changePromise
    })

    expect(result.current.error).toBe("STORAGE_FAILED")
    expect(result.current.updating).toBe(false)
  })

  it("discards an error that lands after the surface went inactive", async () => {
    const write = deferred<unknown>()
    const updatePreferences = vi.fn((patch: Partial<Preferences>) => {
      void patch
      return write.promise
    })
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useCompatibilityMode({ updatePreferences, active }),
      { initialProps: { active: true } },
    )
    let changePromise!: Promise<void>

    act(() => {
      changePromise = result.current.change(true)
    })
    rerender({ active: false })

    await act(async () => {
      write.reject(new Error("late storage failure"))
      await changePromise
    })

    expect(result.current.error).toBeNull()
    expect(result.current.updating).toBe(false)
  })

  it("discards a write that settles while inactive even after the surface reactivates", async () => {
    const write = deferred<unknown>()
    const updatePreferences = vi.fn((patch: Partial<Preferences>) => {
      void patch
      return write.promise
    })
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useCompatibilityMode({ updatePreferences, active }),
      { initialProps: { active: true } },
    )
    let changePromise!: Promise<void>

    act(() => {
      changePromise = result.current.change(true)
    })
    rerender({ active: false })

    await act(async () => {
      write.resolve(undefined)
      await changePromise
    })
    rerender({ active: true })

    expect(result.current.updating).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("reset() drops a result that lands after it", async () => {
    const write = deferred<unknown>()
    const updatePreferences = vi.fn((patch: Partial<Preferences>) => {
      void patch
      return write.promise
    })
    const { result } = renderHook(() =>
      useCompatibilityMode({ updatePreferences, active: true }),
    )
    let changePromise!: Promise<void>

    act(() => {
      changePromise = result.current.change(true)
    })
    act(() => {
      result.current.reset()
    })

    await act(async () => {
      write.reject(new Error("late storage failure"))
      await changePromise
    })

    expect(result.current.error).toBeNull()
    expect(result.current.updating).toBe(false)
  })

  it("reset() clears a surfaced error", async () => {
    const updatePreferences = vi.fn((patch: Partial<Preferences>) => {
      void patch
      return Promise.reject(new Error("storage unavailable"))
    })
    const { result } = renderHook(() =>
      useCompatibilityMode({ updatePreferences, active: true }),
    )

    await act(async () => {
      await result.current.change(true)
    })
    expect(result.current.error).toBe("STORAGE_FAILED")

    act(() => {
      result.current.reset()
    })

    expect(result.current.error).toBeNull()
  })
})
