import "./helpers/module-mocks"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeFeatures, fakePwa, useFakeRegisterSW } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null = null
  resolveReady!: () => void
  ready = new Promise<void>((resolve) => {
    this.resolveReady = resolve
  })

  takeControl(): void {
    this.controller = {}
    this.dispatchEvent(new Event("controllerchange"))
  }
}

describe("PWA offline readiness", () => {
  let original: PropertyDescriptor | undefined

  beforeEach(() => {
    resetUi()
    original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
  })
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "serviceWorker", original)
    else Reflect.deleteProperty(navigator, "serviceWorker")
    resetUi()
  })

  function installContainer(): FakeServiceWorkerContainer {
    const container = new FakeServiceWorkerContainer()
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: container,
    })
    return container
  }

  it("stays preparing until the worker controls this page", async () => {
    const container = installContainer()
    fakePwa.offlineReady = false
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen />
      </AppProviders>,
    )

    const row = () => screen.getByText("Offline-use readiness").parentElement!

    // An activated-but-not-controlling worker must not read as ready.
    await act(async () => {
      container.resolveReady()
      await container.ready
    })
    expect(row()).toHaveTextContent("Preparing")
    expect(row()).not.toHaveTextContent("Ready")

    await act(async () => {
      container.takeControl()
    })
    await waitFor(() => expect(row()).toHaveTextContent("Ready"))
  })
})
