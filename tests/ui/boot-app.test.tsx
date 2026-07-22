import "./helpers/module-mocks"
import { act, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBootController,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { getPreferences } from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"
import { setTestOnlineStatus } from "./helpers/network"

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

describe("App boot gate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("does not mount Router or usePreferences before offline-confirmed", async () => {
    let resolveFetch: ((value: Response) => void) | undefined
    const controller = createBootController({
      fetchImpl: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
      readDecision: async () => decision(),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(getPreferences).not.toHaveBeenCalled()
    await act(async () => resolveFetch?.(response("offline", 503)))

    expect(
      await screen.findByRole("navigation", { name: "メインナビゲーション" }),
    ).toBeInTheDocument()
    await waitFor(() => expect(getPreferences).toHaveBeenCalled())
    controller.stop()
  })

  it("keeps the install route and skips wipe when no sensitive data exists", async () => {
    setTestOnlineStatus(true)
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: false }),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(
      await screen.findByText("オンラインではPWAの導入のみ利用できます"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(performWipe).not.toHaveBeenCalled()
    controller.stop()
  })

  it("shows the reset completion copy after a successful wipe", async () => {
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QRYPT-REACHABLE")),
      performWipe: vi.fn(async () => ({ ok: true, failedSteps: [] })),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(
      await screen.findByText("オンラインを検出したため、ローカルデータを初期化しました"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("論理削除を試行しました(物理消去は未保証)"),
    ).toBeInTheDocument()
    controller.stop()
  })

  it("shows RESET_FAILED and honest deletion wording after a partial failure", async () => {
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
    expect(
      screen.getByText("ローカルデータの初期化中に一部の操作が完了しませんでした。"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("論理削除を試行しました(物理消去は未保証)"),
    ).toBeInTheDocument()
    controller.stop()
  })
})
