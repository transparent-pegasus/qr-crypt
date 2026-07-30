import { cleanup, render, screen } from "@testing-library/react"
import { createElement, type ComponentProps } from "react"
import { expect } from "vitest"
import * as i18nExports from "@/i18n"
import { resetFakes } from "./fakes"
import { setTestOnlineStatus } from "./network"
import { clearAckPending } from "@/app/offline-ack-marker"
import { MemoryStorage } from "../../helpers/memory-storage"

type AppComponent = typeof import("@/app/App").App
let appComponent: AppComponent | null = null

export const memoryLocalStorage = new MemoryStorage()
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: memoryLocalStorage,
})

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

export async function renderApp(path = "/", props: ComponentProps<AppComponent> = {}) {
  if (!appComponent) appComponent = (await import("@/app/App")).App
  window.history.pushState({}, "", path)
  return render(createElement(appComponent, props))
}

export function resetUi({ clearStorage = true }: { clearStorage?: boolean } = {}): void {
  cleanup()
  resetFakes()
  if (clearStorage) {
    memoryLocalStorage.clear()
    clearAckPending()
  }
  document.documentElement.classList.remove("dark")
  setTestOnlineStatus(false)
  window.history.pushState({}, "", "/")
}

function isVisible(element: HTMLElement | null): boolean {
  if (!element) return false
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    const style = window.getComputedStyle(current)
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false
    }
  }
  return true
}

export function expectLanguageField(): void {
  const combobox = screen.getByRole("combobox")
  const label = screen.queryByText("Language", {
    exact: true,
    selector: "label",
  })

  expect({
    exportedComponent: typeof Reflect.get(i18nExports, "LanguageField"),
    visibleLabel: isVisible(label),
    nativeAssociation:
      label instanceof HTMLLabelElement && label.control === combobox,
    labelQueryResolvesToCombobox:
      screen.getByLabelText("Language") === combobox,
    fallbackAriaLabel: combobox.getAttribute("aria-label"),
  }).toEqual({
    exportedComponent: "function",
    visibleLabel: true,
    nativeAssociation: true,
    labelQueryResolvesToCombobox: true,
    fallbackAriaLabel: null,
  })
}
