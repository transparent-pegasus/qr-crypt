import "./helpers/module-mocks"
import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBootController,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { translate } from "@/i18n/messages"
import type { BestEffortResetReport } from "@/storage/best-effort-reset"
import { getPreferences } from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"
import { setTestOnlineStatus } from "./helpers/network"

function response(body: string, status = 200): Response {
  return { status, text: vi.fn(async () => body) } as unknown as Response
}

function decision(overrides: Partial<BootDecisionSnapshot> = {}): BootDecisionSnapshot {
  const snapshot = {
    wipeOnOnline: true,
    sensitiveDataExists: false,
    maintenanceTokenArmed: false,
    resetChurnMb: 0,
    preferencesReadFailed: false,
    ...overrides,
  }
  return {
    ...snapshot,
    cleanOrigin:
      overrides.cleanOrigin ??
      (snapshot.sensitiveDataExists ? "dirty" : "confirmed-clean"),
  }
}

describe("App boot gate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("[acceptance 1] cold offline mounts Router without acknowledgement", async () => {
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
      await screen.findByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", {
        name: "Confirm before continuing",
      }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(getPreferences).toHaveBeenCalled())
    controller.stop()
  })

  it("keeps the install route and skips wipe when no sensitive data exists", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe,
      readDecision: async () => decision({ sensitiveDataExists: false }),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(
      await screen.findByText(translate("en", "gate.heading")),
    ).toBeVisible()
    expect(
      await screen.findByRole("navigation", { name: "Online navigation" }),
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Relay" }))
    expect(
      await screen.findByText(translate("en", "relay.card.title")),
    ).toBeVisible()
    expect(performWipe).not.toHaveBeenCalled()
    controller.stop()
  })

  it("keeps the relay absent while the destructive decision is pending", async () => {
    setTestOnlineStatus(true)
    const user = userEvent.setup()
    let resolveDecision: ((value: BootDecisionSnapshot) => void) | undefined
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: () =>
        new Promise((resolve) => {
          resolveDecision = resolve
        }),
    })
    await renderApp("/encrypt", { bootController: controller })

    await screen.findByText(translate("en", "gate.heading"))
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    resolveDecision?.(decision())
    await user.click(
      await screen.findByRole("button", { name: "Relay" }),
    )
    expect(
      await screen.findByText(translate("en", "relay.card.title")),
    ).toBeVisible()
    controller.stop()
  })

  it.each([
    [
      "maintenance-token survival",
      {
        maintenanceTokenArmed: true,
        sensitiveDataExists: true,
        wipeOnOnline: true,
      },
    ],
    ["wipeOnOnline=false with rows", { sensitiveDataExists: true, wipeOnOnline: false }],
    [
      "indeterminate cleanliness",
      {
        cleanOrigin: "indeterminate" as const,
        sensitiveDataExists: false,
      },
    ],
  ])("keeps the relay absent after %s", async (_label, overrides) => {
    setTestOnlineStatus(true)
    const controller = createBootController({
      consumeMaintenanceToken: vi.fn(async () => true),
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: async () => decision(overrides),
    })
    await renderApp("/encrypt", { bootController: controller })

    await screen.findByText(translate("en", "gate.heading"))
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    controller.stop()
  })

  it("does not expose the relay in the transient offline-confirmed plus display-online render", async () => {
    setTestOnlineStatus(true)
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("offline", 503)),
      readDecision: async () => decision(),
    })
    await renderApp("/encrypt", { bootController: controller })

    await screen.findByText(translate("en", "gate.heading"))
    expect(controller.getState()).toEqual({ kind: "offline-confirmed" })
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    controller.stop()
  })

  it("removes the relay before a destructive wipe remains pending", async () => {
    setTestOnlineStatus(true)
    let finishWipe: ((report: BestEffortResetReport) => void) | undefined
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe: vi.fn(
        () =>
          new Promise<BestEffortResetReport>((resolve) => {
            finishWipe = resolve
          }),
      ),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(await screen.findByText("Resetting local data")).toBeInTheDocument()
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    finishWipe?.({ ok: true, failedSteps: [] })
    await screen.findByText(
      "Local data was reset after an online connection was detected",
    )
    controller.stop()
  })

  it("shows RESET_FAILED without the relay after a partial failure", async () => {
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe: vi.fn(async () => ({
        ok: false,
        failedSteps: ["database-verification"],
      })),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(await screen.findByText("RESET_FAILED")).toBeInTheDocument()
    // Naming the steps that failed is the only actionable detail this terminal
    // screen can offer; the settings-originated reset reports into it too.
    expect(screen.getByText("database-verification")).toBeInTheDocument()
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    controller.stop()
  })
})
