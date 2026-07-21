import "./helpers/module-mocks"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeFeatures, useFakeRegisterSW } from "./helpers/fakes"
import { setTestOnlineStatus } from "./helpers/network"
import { renderApp, resetUi } from "./helpers/render-app"

describe("OnlineGate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("shows only installation guidance while online and handles beforeinstallprompt", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    await renderApp("/encrypt")

    expect(
      await screen.findByText("オンラインではPWAの導入のみ利用できます"),
    ).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /アプリアイコン/ })).toBeInTheDocument()
    expect(screen.getByText("PWAインストール状態").parentElement).toHaveTextContent(
      "未インストール",
    )
    expect(screen.getByText("オフライン利用準備状態")).toBeInTheDocument()
    expect(
      screen.getByText("オフライン（機内モード）に切り替えると全機能が利用できます。"),
    ).toBeInTheDocument()
    expect(screen.getByText("オンライン", { exact: true })).toBeInTheDocument()
    expect(screen.queryByLabelText("平文")).not.toBeInTheDocument()
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
    await user.click(await screen.findByRole("button", { name: "PWAをインストール" }))
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText("PWAインストール状態").parentElement).toHaveTextContent(
        "インストール済み",
      ),
    )
  })

  it("fires TransientClear on offline-to-online and restores children when offline", async () => {
    const { AppProviders, useTransientClear } = await import("@/app/providers")
    const { OnlineGate } = await import("@/components/online-gate")

    function NonceProbe() {
      const { nonce } = useTransientClear()
      return <p>通常機能 nonce={nonce}</p>
    }

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <OnlineGate>
          <NonceProbe />
        </OnlineGate>
      </AppProviders>,
    )
    expect(screen.getByText("通常機能 nonce=0")).toBeInTheDocument()

    act(() => setTestOnlineStatus(true, { emit: true }))
    expect(
      await screen.findByText("オンラインではPWAの導入のみ利用できます"),
    ).toBeInTheDocument()
    expect(screen.queryByText(/通常機能 nonce=/)).not.toBeInTheDocument()

    act(() => setTestOnlineStatus(false, { emit: true }))
    expect(await screen.findByText("通常機能 nonce=1")).toBeInTheDocument()
    expect(
      screen.queryByText("オンラインではPWAの導入のみ利用できます"),
    ).not.toBeInTheDocument()
  })
})
