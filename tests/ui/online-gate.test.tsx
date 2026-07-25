import "./helpers/module-mocks"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeFeatures, fakePwa, useFakeRegisterSW } from "./helpers/fakes"
import { setTestOnlineStatus } from "./helpers/network"
import { renderApp, resetUi } from "./helpers/render-app"
import { createBootController } from "@/app/boot/boot-controller"

describe("OnlineGate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("shows ready when a previously installed service worker is active", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
    fakePwa.offlineReady = false
    try {
      const { AppProviders } = await import("@/app/providers")
      const { OnlineInstallScreen } = await import("@/components/online-gate")
      render(
        <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
          <OnlineInstallScreen />
        </AppProviders>,
      )

      await waitFor(() =>
        expect(screen.getByText("Offline-use readiness").parentElement).toHaveTextContent(
          "Ready",
        ),
      )
    } finally {
      if (original) Object.defineProperty(navigator, "serviceWorker", original)
      else Reflect.deleteProperty(navigator, "serviceWorker")
    }
  })

  it("shows installation and eligible relay guidance while online and handles beforeinstallprompt", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    const controller = createBootController({
      fetchImpl: vi.fn(async () => ({
        status: 200,
        text: vi.fn(async () => "QRYPT-REACHABLE"),
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
      await screen.findByText("Install the PWA or relay ciphertext QR frames"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Online installation and ciphertext relay"),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Encryption, decryption, key creation, key lists, and settings remain offline-only. A clean origin may also relay header-declared message frames without using local keys.",
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText("Ciphertext QR relay")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /app icon/ })).toBeInTheDocument()
    expect(screen.getByText("PWA installation status").parentElement).toHaveTextContent(
      "Not installed",
    )
    expect(screen.getByText("Offline-use readiness")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Switch to offline mode, for example with airplane mode, to use offline features. A risk acknowledgement will appear when the state changes. On a compromised device, neither airplane mode nor an offline indicator can be trusted, so going offline does not guarantee that the device is safe.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Switching to offline mode makes every feature available."),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Online", { exact: true })).toBeInTheDocument()
    expect(screen.queryByLabelText("Plaintext")).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()

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
      await screen.findByText("Install the PWA or relay ciphertext QR frames"),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Regular feature nonce=/)).not.toBeInTheDocument()

    act(() => setTestOnlineStatus(false, { emit: true }))
    expect(await screen.findByText("Regular feature nonce=1")).toBeInTheDocument()
    expect(
      screen.queryByText("Install the PWA or relay ciphertext QR frames"),
    ).not.toBeInTheDocument()
  })
})
