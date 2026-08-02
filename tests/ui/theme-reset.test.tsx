import { cleanup, render, screen, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OC_LOCAL_STORAGE_CLEARED_EVENT } from "@/storage/reset-events"
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "@/app/providers"
import { memoryLocalStorage } from "./helpers/render-app"

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ offlineReady: [false, () => undefined] }),
}))
vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: () => ({ offlineReady: [false, () => undefined] }),
}))

function ThemeProbe() {
  const { theme } = useTheme()
  return <span data-testid="theme">{theme}</span>
}

function renderTheme() {
  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  )
}

describe("ThemeProvider reset contract", () => {
  beforeEach(() => {
    memoryLocalStorage.clear()
    document.documentElement.classList.remove("dark")
  })
  afterEach(cleanup)

  it("returns mounted state to the system default when oc-* keys are cleared", () => {
    memoryLocalStorage.setItem(THEME_STORAGE_KEY, "dark")
    renderTheme()
    expect(screen.getByTestId("theme")).toHaveTextContent("dark")

    act(() => {
      memoryLocalStorage.removeItem(THEME_STORAGE_KEY)
      window.dispatchEvent(new Event(OC_LOCAL_STORAGE_CLEARED_EVENT))
    })

    expect(screen.getByTestId("theme")).toHaveTextContent("system")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(memoryLocalStorage.getItem(THEME_STORAGE_KEY)).toBe("system")
  })

  it("returns a mounted peer tab to the system default when its key is removed", () => {
    memoryLocalStorage.setItem(THEME_STORAGE_KEY, "dark")
    renderTheme()

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          oldValue: "dark",
          newValue: null,
        }),
      )
    })

    expect(screen.getByTestId("theme")).toHaveTextContent("system")
  })

  it("ignores a peer write that sets a value", () => {
    memoryLocalStorage.setItem(THEME_STORAGE_KEY, "dark")
    renderTheme()

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          oldValue: "dark",
          newValue: "light",
        }),
      )
    })

    expect(screen.getByTestId("theme")).toHaveTextContent("dark")
  })

  it("ignores the removal of an unrelated key", () => {
    memoryLocalStorage.setItem(THEME_STORAGE_KEY, "dark")
    renderTheme()

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "oc-lang",
          oldValue: "ja",
          newValue: null,
        }),
      )
    })

    expect(screen.getByTestId("theme")).toHaveTextContent("dark")
  })
})
