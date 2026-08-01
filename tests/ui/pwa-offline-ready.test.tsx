import "./helpers/module-mocks"
import { act, render, screen, waitFor } from "@testing-library/react"
import { useEffect, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UseRegisterSwHook } from "@/components/pwa-offline-ready"
import { fakeFeatures, fakePwa, useFakeRegisterSW } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

function useOfflineReadyAfterMount() {
  const offlineReady = useState(false)
  const setOfflineReady = offlineReady[1]
  useEffect(() => setOfflineReady(true), [setOfflineReady])
  return { offlineReady }
}

class FakeServiceWorkerContainer extends EventTarget {
  private currentController: object | null = null
  controllerReads = 0
  controllerChangeSubscriptions = 0
  resolveReady!: () => void
  ready = new Promise<void>((resolve) => {
    this.resolveReady = resolve
  })

  get controller(): object | null {
    this.controllerReads += 1
    return this.currentController
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === "controllerchange") this.controllerChangeSubscriptions += 1
    super.addEventListener(type, callback, options)
  }

  takeControl(): void {
    this.currentController = {}
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

  it("detects control taken after the first snapshot but before subscription", async () => {
    const container = installContainer()
    fakePwa.offlineReady = false
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    let tookControl = false
    const takeControlDuringRegistration: UseRegisterSwHook = () => {
      if (!tookControl) {
        expect(container.controllerReads).toBeGreaterThan(0)
        expect(container.controllerChangeSubscriptions).toBe(0)
        tookControl = true
        container.takeControl()
      }
      return { offlineReady: [false, () => undefined] }
    }

    render(
      <AppProviders
        features={{ ...fakeFeatures }}
        pwaHook={takeControlDuringRegistration}
      >
        <OnlineInstallScreen />
      </AppProviders>,
    )

    const row = screen.getByText("Offline-use readiness").parentElement!
    await waitFor(() => expect(row).toHaveTextContent("Ready"))
    expect(container.controllerChangeSubscriptions).toBe(1)
  })

  it("shows a loader only after one second of preparation, and drops it when ready", async () => {
    const container = installContainer()
    fakePwa.offlineReady = false
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")

    vi.useFakeTimers()
    try {
      render(
        <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
          <OnlineInstallScreen />
        </AppProviders>,
      )

      // A load that settles quickly must not flash a spinner.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(screen.queryByLabelText("Loading")).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(screen.getByLabelText("Loading")).toBeInTheDocument()

      await act(async () => {
        container.takeControl()
      })
      expect(screen.queryByLabelText("Loading")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("notifies when offline assets are ready without rendering update controls", async () => {
    const container = Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
      controller: {},
    })
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: container,
    })
    const { AppProviders } = await import("@/app/providers")

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useOfflineReadyAfterMount}>
        <p>アプリ本体</p>
      </AppProviders>,
    )

    expect(await screen.findByText("Offline use is ready")).toBeInTheDocument()
    expect(screen.queryByLabelText("アプリ更新通知")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "更新する" })).not.toBeInTheDocument()
  })
})
