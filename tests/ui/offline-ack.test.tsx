import "./helpers/module-mocks"
import { useEffect } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBootController,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { useDisplayGate } from "@/app/display-gate"
import { AppProviders, useTransientClear } from "@/app/providers"
import { OfflineAckShell } from "@/components/offline-ack-shell"
import { fakeFeatures, getPreferences, useFakeRegisterSW } from "./helpers/fakes"
import { setTestOnlineStatus, stubReachabilityFetch } from "./helpers/network"
import { renderApp, resetUi } from "./helpers/render-app"

const ACK_TITLE = "オフラインへ切り替わりました — 続行前の確認"
const INSTALL_TITLE = "オンラインではPWAの導入のみ利用できます"

function response(body: string, status = 200): Response {
  return { status, text: vi.fn(async () => body) } as unknown as Response
}

function decision(overrides: Partial<BootDecisionSnapshot> = {}): BootDecisionSnapshot {
  return {
    wipeOnOnline: true,
    sensitiveDataExists: false,
    maintenanceTokenArmed: false,
    resetChurnMb: 0,
    preferencesReadFailed: false,
    ...overrides,
  }
}

async function flushDisplayProbe(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function acceptRisk(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    screen.getByRole("checkbox", {
      name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
    }),
  )
  await user.click(
    screen.getByRole("button", {
      name: "リスクを理解してオフライン機能を表示",
    }),
  )
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
}

describe("offline acknowledgement shell", () => {
  beforeEach(() => {
    resetUi()
    setVisibility("visible")
  })

  afterEach(() => {
    resetUi()
    setVisibility("visible")
    document.documentElement.style.removeProperty("zoom")
    vi.restoreAllMocks()
  })

  it("uses the exact risk wording, no positive safety claim, and remains keyboard reachable", async () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 320 },
      innerHeight: { configurable: true, value: 568 },
    })
    document.documentElement.style.setProperty("zoom", "2")
    const user = userEvent.setup()
    const onContinue = vi.fn(() => true)
    render(<OfflineAckShell generation={1} onContinue={onContinue} />)

    const heading = screen.getByRole("heading", { name: ACK_TITLE })
    const shell = screen.getByRole("main", { name: ACK_TITLE })
    const checkbox = screen.getByRole("checkbox", {
      name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
    })
    const button = screen.getByRole("button", {
      name: "リスクを理解してオフライン機能を表示",
    })

    expect(heading).toHaveFocus()
    expect(shell).toHaveClass("max-h-dvh", "overflow-y-auto")
    expect(shell.className).toContain("safe-area-inset-top")
    expect(shell).toHaveTextContent(
      "完全に安全にメッセージの暗号化を行う方法はありません",
    )
    expect(shell).toHaveTextContent("完全な安全を本アプリが保証するものではありません")
    expect(shell).toHaveTextContent(
      "このチェックは端末の安全性を検証・回復するものではありません",
    )
    expect(shell).not.toHaveTextContent("完全に安全です")
    expect(shell).not.toHaveTextContent("完全な安全を保証します")
    expect(button).toBeDisabled()

    await user.tab()
    expect(checkbox).toHaveFocus()
    await user.keyboard(" ")
    expect(button).toBeEnabled()
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(onContinue).toHaveBeenCalledWith(1)
  })

  it("[acceptance 2] keeps Router, child render/effect, and preferences at zero until ack", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    let renders = 0
    let effects = 0

    function MountProbe() {
      renders += 1
      const { nonce } = useTransientClear()
      useEffect(() => {
        effects += 1
      }, [])
      return <p>MountProbe nonce={nonce}</p>
    }

    const routerFactory = vi.fn(() =>
      createMemoryRouter([{ path: "*", element: <MountProbe /> }], {
        initialEntries: ["/encrypt"],
      }),
    )
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      readDecision: async () => decision(),
    })

    await renderApp("/encrypt", {
      bootController: controller,
      routerFactory,
    })
    await screen.findByText(INSTALL_TITLE)
    await screen.findByText("オンライン", { exact: true })

    act(() => setTestOnlineStatus(false, { emit: true }))
    await screen.findByRole("heading", { name: ACK_TITLE })
    expect(routerFactory).not.toHaveBeenCalled()
    expect(renders).toBe(0)
    expect(effects).toBe(0)
    expect(getPreferences).not.toHaveBeenCalled()

    await acceptRisk(user)
    expect(await screen.findByText("MountProbe nonce=1")).toBeInTheDocument()
    await waitFor(() => expect(effects).toBe(1))
    expect(routerFactory).toHaveBeenCalledTimes(1)
    expect(renders).toBe(1)
    controller.stop()
  })

  it("[acceptance 3] invalidates stale actions and unchecked state on a new generation", async () => {
    const actions = new Map<number, () => boolean>()

    function AckHarness() {
      const display = useDisplayGate()
      if (display.online) return <p>online snapshot</p>
      if (!display.ackPending) return <p>cold or accepted</p>
      const generation = display.offlineGeneration
      actions.set(generation, () => display.acceptOfflineRisk(generation))
      return (
        <OfflineAckShell
          key={generation}
          generation={generation}
          onContinue={display.acceptOfflineRisk}
        />
      )
    }

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <AckHarness />
      </AppProviders>,
    )

    act(() => setTestOnlineStatus(true, { emit: true }))
    expect(await screen.findByText("online snapshot")).toBeInTheDocument()
    act(() => setTestOnlineStatus(false, { emit: true }))
    await screen.findByRole("heading", { name: ACK_TITLE })

    const user = userEvent.setup()
    await user.click(
      screen.getByRole("checkbox", {
        name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
      }),
    )
    expect(
      screen.getByRole("button", {
        name: "リスクを理解してオフライン機能を表示",
      }),
    ).toBeEnabled()

    act(() => setTestOnlineStatus(true, { emit: true }))
    expect(await screen.findByText("online snapshot")).toBeInTheDocument()
    act(() => setTestOnlineStatus(false, { emit: true }))
    await screen.findByRole("heading", { name: ACK_TITLE })

    expect(screen.getByRole("checkbox")).not.toBeChecked()
    expect(
      screen.getByRole("button", {
        name: "リスクを理解してオフライン機能を表示",
      }),
    ).toBeDisabled()
    expect(actions.has(2)).toBe(true)
    expect(actions.get(1)?.()).toBe(false)
    expect(screen.getByRole("heading", { name: ACK_TITLE })).toBeInTheDocument()
  })

  it.each([
    ["wipeOnOnline=OFF", false],
    ["maintenance token", true],
  ])(
    "[acceptance 4] %s mounts the application only after ack",
    async (_label, maintenanceTokenArmed) => {
      setTestOnlineStatus(true)
      const user = userEvent.setup()
      const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
      const consumeMaintenanceToken = vi.fn(async () => true)
      const controller = createBootController({
        consumeMaintenanceToken,
        fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
        performWipe,
        readDecision: async () =>
          decision({
            maintenanceTokenArmed,
            sensitiveDataExists: true,
            wipeOnOnline: maintenanceTokenArmed,
          }),
      })

      await renderApp("/encrypt", { bootController: controller })
      await screen.findByText(INSTALL_TITLE)
      await screen.findByText("オンライン", { exact: true })
      expect(getPreferences).not.toHaveBeenCalled()

      act(() => setTestOnlineStatus(false, { emit: true }))
      await screen.findByRole("heading", { name: ACK_TITLE })
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
      expect(getPreferences).not.toHaveBeenCalled()

      await acceptRisk(user)
      expect(
        await screen.findByRole("navigation", { name: "メインナビゲーション" }),
      ).toBeInTheDocument()
      await waitFor(() => expect(getPreferences).toHaveBeenCalled())
      expect(performWipe).not.toHaveBeenCalled()
      expect(consumeMaintenanceToken).toHaveBeenCalledTimes(maintenanceTokenArmed ? 1 : 0)
      controller.stop()
    },
  )

  it("[acceptance 5] combines wiped result with ack and only offers full reload", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    const reloadPage = vi.fn()
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe: vi.fn(async () => ({ ok: true, failedSteps: [] })),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })

    await renderApp("/encrypt", { bootController: controller, reloadPage })
    await screen.findByText("オンラインを検出したため、ローカルデータを初期化しました")
    await flushDisplayProbe()
    act(() => setTestOnlineStatus(false, { emit: true }))

    const shell = await screen.findByRole("main", { name: ACK_TITLE })
    expect(shell).toHaveTextContent(
      "オンラインを検出したため、ローカルデータを初期化しました",
    )
    expect(shell).toHaveTextContent("論理削除を試行しました(物理消去は未保証)")
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(getPreferences).not.toHaveBeenCalled()

    const reloadButton = screen.getByRole("button", {
      name: "再読み込みして続行",
    })
    expect(reloadButton).toBeDisabled()
    await user.click(screen.getByRole("checkbox"))
    await user.click(reloadButton)
    expect(reloadPage).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(getPreferences).not.toHaveBeenCalled()
    controller.stop()
  })

  it("[acceptance 6] gives partial failure no acknowledgement or resume path", async () => {
    setTestOnlineStatus(true)
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe: vi.fn(async () => ({
        ok: false,
        failedSteps: ["database-verification"],
      })),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })

    await renderApp("/encrypt", { bootController: controller })
    expect(await screen.findByText("RESET_FAILED")).toBeInTheDocument()
    await flushDisplayProbe()
    act(() => setTestOnlineStatus(false, { emit: true }))

    expect(await screen.findByText("RESET_FAILED")).toBeInTheDocument()
    expect(
      screen.getByText(/このタブを閉じてください。.*端末を完全フォーマット/),
    ).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(getPreferences).not.toHaveBeenCalled()
    controller.stop()
  })

  it("[acceptance 7] display-only probe edges do not add sentinel probes or wipes", async () => {
    setTestOnlineStatus(false)
    const sentinelFetch = vi.fn(async () => response("offline", 503))
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: sentinelFetch,
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })

    await renderApp("/encrypt", { bootController: controller })
    expect(
      await screen.findByRole("navigation", { name: "メインナビゲーション" }),
    ).toBeInTheDocument()
    expect(sentinelFetch).toHaveBeenCalledTimes(1)

    stubReachabilityFetch(true)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(await screen.findByText(INSTALL_TITLE)).toBeInTheDocument()

    stubReachabilityFetch(false)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(await screen.findByRole("heading", { name: ACK_TITLE })).toBeInTheDocument()
    expect(sentinelFetch).toHaveBeenCalledTimes(1)
    expect(performWipe).not.toHaveBeenCalled()
    controller.stop()
  })
})
