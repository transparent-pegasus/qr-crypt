import { cleanup, render } from "@testing-library/react"
import { createElement, type ComponentProps } from "react"
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
