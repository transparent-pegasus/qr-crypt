import { cleanup, render } from "@testing-library/react"
import { createElement, type ComponentProps } from "react"
import { resetFakes } from "./fakes"
import { setTestOnlineStatus } from "./network"
import { clearAckPending } from "@/app/offline-ack-marker"

type AppComponent = typeof import("@/app/App").App
let appComponent: AppComponent | null = null

class MemoryLocalStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.#values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, String(value))
  }
}

export const memoryLocalStorage = new MemoryLocalStorage()
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
