import "./helpers/module-mocks"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeFeatures, useFakeRegisterSW } from "./helpers/fakes"
import { setTestOnlineStatus } from "./helpers/network"
import {
  expectLanguageField,
  renderApp,
  resetUi,
} from "./helpers/render-app"
import { createBootController } from "@/app/boot/boot-controller"
import { translate } from "@/i18n/messages"

describe("OnlineGate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("renders the language field on the online install screen", async () => {
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen />
      </AppProviders>,
    )

    expectLanguageField()
  })

  it("renders the ready offline-use status", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(new EventTarget(), { controller: {} }),
    })
    try {
      const { AppProviders } = await import("@/app/providers")
      const { OnlineInstallScreen } = await import("@/components/online-gate")
      render(
        <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
          <OnlineInstallScreen />
        </AppProviders>,
      )

      expect(screen.getByText("Offline-use readiness").parentElement).toHaveTextContent(
        "Ready",
      )
    } finally {
      if (original) Object.defineProperty(navigator, "serviceWorker", original)
      else Reflect.deleteProperty(navigator, "serviceWorker")
    }
  })

  it("shows no navigation or relay when relay is not eligible", async () => {
    setTestOnlineStatus(true)
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen relayEligible={false} />
      </AppProviders>,
    )

    expect(
      await screen.findByText(translate("en", "gate.mode.label")),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Switch to offline mode, for example with airplane mode, to use offline features. A risk acknowledgement will appear when the state changes. On a compromised device, neither airplane mode nor an offline indicator can be trusted, so going offline does not guarantee that the device is safe.",
      ),
    ).toBeVisible()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
  })

  it("persists relay and home selections from the online navigation", async () => {
    const user = userEvent.setup()
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen relayEligible />
      </AppProviders>,
    )

    await user.click(screen.getByRole("button", { name: "Relay" }))
    const storedAfterRelay = window.localStorage.getItem("oc-online-tab")
    await user.click(screen.getByRole("button", { name: "Top" }))
    const storedAfterHome = window.localStorage.getItem("oc-online-tab")

    expect(storedAfterRelay).toBe("relay")
    expect(storedAfterHome).toBe("top")
  })

  it("restores a stored relay selection on first render", async () => {
    window.localStorage.setItem("oc-online-tab", "relay")
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen relayEligible />
      </AppProviders>,
    )

    expect(
      await screen.findByText(translate("en", "relay.card.title")),
    ).toBeVisible()
    expect(
      screen.getByText(translate("en", "gate.heading")),
    ).not.toBeVisible()
  })

  it("keeps a stored relay selection closed while relay is not eligible", async () => {
    window.localStorage.setItem("oc-online-tab", "relay")
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen relayEligible={false} />
      </AppProviders>,
    )

    expect(
      await screen.findByText(translate("en", "gate.heading")),
    ).toBeVisible()
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })

  it("opens a stored relay selection once eligibility arrives after mount", async () => {
    window.localStorage.setItem("oc-online-tab", "relay")
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")
    const { rerender } = render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen relayEligible={false} />
      </AppProviders>,
    )

    expect(
      await screen.findByText(translate("en", "gate.heading")),
    ).toBeVisible()

    rerender(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineInstallScreen relayEligible />
      </AppProviders>,
    )

    expect(
      await screen.findByText(translate("en", "relay.card.title")),
    ).toBeVisible()
    expect(
      screen.getByText(translate("en", "gate.heading")),
    ).not.toBeVisible()
  })

  it("shows the home tab when the stored selection is absent or unrecognized", async () => {
    const { AppProviders } = await import("@/app/providers")
    const { OnlineInstallScreen } = await import("@/components/online-gate")

    for (const storedValue of [null, "unexpected"] as const) {
      window.localStorage.clear()
      if (storedValue !== null) {
        window.localStorage.setItem("oc-online-tab", storedValue)
      }
      const view = render(
        <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
          <OnlineInstallScreen relayEligible />
        </AppProviders>,
      )

      expect(
        await screen.findByText(translate("en", "gate.heading")),
      ).toBeVisible()
      expect(
        screen.getByText(translate("en", "relay.card.title")),
      ).not.toBeVisible()
      view.unmount()
    }
  })

  it("does not persist a tab when the user never taps the online navigation", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem")
    try {
      const { AppProviders } = await import("@/app/providers")
      const { OnlineInstallScreen } = await import("@/components/online-gate")
      render(
        <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
          <OnlineInstallScreen relayEligible />
        </AppProviders>,
      )

      expect(
        await screen.findByText(translate("en", "gate.heading")),
      ).toBeVisible()
      expect(setItem.mock.calls.some(([key]) => key === "oc-online-tab")).toBe(false)
      expect(window.localStorage.getItem("oc-online-tab")).toBeNull()
    } finally {
      setItem.mockRestore()
    }
  })

  it("shows installation and eligible relay guidance while online and handles beforeinstallprompt", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    const controller = createBootController({
      fetchImpl: vi.fn(async () => ({
        status: 200,
        text: vi.fn(async () => "QR-CRYPT-REACHABLE"),
      })) as unknown as typeof fetch,
      readDecision: async () => ({
        wipeOnOnline: true,
        sensitiveDataExists: false,
        cleanOrigin: "confirmed-clean",
        maintenanceTokenArmed: false,
        resetChurnMb: 0,
        preferencesReadFailed: false,
      }),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(
      await screen.findByText(translate("en", "gate.heading")),
    ).toBeVisible()
    expect(
      screen.getByText(translate("en", "gate.mode.label")),
    ).toBeVisible()
    expect(
      screen.getByText(translate("en", "gate.description")),
    ).toBeVisible()
    const onlineNavigation = await screen.findByRole("navigation", {
      name: "Online navigation",
    })
    expect(onlineNavigation).toBeVisible()
    expect(
      screen.getByText(translate("en", "relay.card.title")),
    ).not.toBeVisible()
    expect(screen.getByRole("img", { name: /app icon/ })).toBeVisible()
    expect(screen.getByText("PWA installation status").parentElement).toHaveTextContent(
      "Not installed",
    )
    expect(screen.getByText("Offline-use readiness")).toBeVisible()
    expect(
      screen.queryByText("Switching to offline mode makes every feature available."),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Online", { exact: true })).toBeVisible()
    expect(screen.queryByLabelText("Plaintext")).not.toBeInTheDocument()

    const prompt = vi.fn(async () => undefined)
    const installEvent = new Event("beforeinstallprompt", {
      cancelable: true,
    }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: "accepted"; platform: string }>
    }
    Object.defineProperties(installEvent, {
      prompt: { value: prompt },
      userChoice: {
        value: Promise.resolve({ outcome: "accepted", platform: "web" }),
      },
    })
    act(() => window.dispatchEvent(installEvent))
    await user.click(await screen.findByRole("button", { name: "Install the PWA" }))
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText("PWA installation status").parentElement).toHaveTextContent(
        "Installed",
      ),
    )
    await user.click(screen.getByRole("button", { name: "Relay" }))
    expect(screen.getByText(translate("en", "relay.card.title"))).toBeVisible()
    expect(
      screen.getByText(translate("en", "gate.heading")),
    ).not.toBeVisible()
    controller.stop()
  })

  it("fires TransientClear on offline-to-online and restores children when offline", async () => {
    const { AppProviders, useTransientClear } = await import("@/app/providers")
    const { OnlineGate } = await import("@/components/online-gate")

    function NonceProbe() {
      const { nonce } = useTransientClear()
      return <p>Regular feature nonce={nonce}</p>
    }

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineGate>
          <NonceProbe />
        </OnlineGate>
      </AppProviders>,
    )
    expect(screen.getByText("Regular feature nonce=0")).toBeInTheDocument()

    act(() => setTestOnlineStatus(true, { emit: true }))
    expect(
      await screen.findByText(translate("en", "gate.heading")),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Regular feature nonce=/)).not.toBeInTheDocument()

    act(() => setTestOnlineStatus(false, { emit: true }))
    expect(await screen.findByText("Regular feature nonce=1")).toBeInTheDocument()
    expect(
      screen.queryByText(translate("en", "gate.heading")),
    ).not.toBeInTheDocument()
  })
})
