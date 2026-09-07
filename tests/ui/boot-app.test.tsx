import "./helpers/module-mocks/feature-detection"
import "./helpers/module-mocks/pwa"
import "./helpers/module-mocks/preferences"
import "./helpers/module-mocks/qr-scanner"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBootController,
  type BootController,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import { createAppRouter } from "@/app/router"
import { translate } from "@/i18n/messages"
import type { BestEffortResetReport } from "@/storage/best-effort-reset"
import { decision, response } from "../helpers/boot-fixtures"
import { getPreferences } from "./helpers/fakes/preferences"
import { expectLanguageField, renderApp, resetUi } from "./helpers/render-app"
import { setTestOnlineStatus } from "./helpers/network"

describe("App boot gate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it.each(["Home", "Relay"] as const)(
    "keeps the online %s usable across failed display polls after admission",
    async (tab) => {
      // Keep IndexedDB and user interaction callbacks on their native timers.
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
      setTestOnlineStatus(true)
      const user = userEvent.setup()
      const openDatabase = vi.spyOn(indexedDB, "open")
      const routerFactory = vi.fn(createAppRouter)
      const reloadPage = vi.fn()
      const quarantine = vi.fn(async () => undefined)
      const performWipe = vi.fn(async () => ({ ok: true, failedSteps: [] }))
      let failDisplayProbes = false
      let failedProbes = 0
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input), window.location.href)
        if (
          failDisplayProbes &&
          init?.method === "HEAD" &&
          url.pathname === "/manifest.webmanifest" &&
          url.searchParams.has("reach")
        ) {
          failedProbes += 1
          throw new TypeError("display probe unavailable")
        }
        return response("QR-CRYPT-REACHABLE")
      })
      vi.stubGlobal("fetch", fetchImpl)
      const controller = createBootController({
        fetchImpl,
        readDecision: async () => decision(),
        quarantine,
        performWipe,
      })
      const endRelaySession = vi.spyOn(controller, "endRelaySession")
      const rendered = await renderApp("/encrypt", {
        bootController: controller,
        reloadPage,
        routerFactory,
      })
      try {
        const navigation = await screen.findByRole("navigation", {
          name: "Online navigation",
        })
        const home = screen.getByRole("heading", { name: "Install the PWA" })
        expect(home).toBeVisible()
        expect(navigation).toBeVisible()
        expect(controller.getState()).toMatchObject({
          kind: "network-confirmed",
          relayEligibility: "eligible",
        })
        if (tab === "Relay") {
          await user.click(screen.getByRole("button", { name: "Relay" }))
          await user.click(screen.getByRole("button", { name: "Text → QR" }))
          expect(
            screen.getByRole("dialog", { name: "Turn relay text into QR" }),
          ).toBeVisible()
          fireEvent.change(screen.getByLabelText("Relay text"), {
            target: { value: "relay-session-draft" },
          })
        }
        const activeView =
          tab === "Home"
            ? home
            : screen.getByRole("dialog", { name: "Turn relay text into QR" })

        failDisplayProbes = true
        // Include even the offline cadence so BASE reaches the UI assertions
        // after multiple actual failures, rather than failing on a poll count.
        for (let poll = 1; poll <= 3; poll += 1) {
          await act(async () => vi.advanceTimersByTimeAsync(15_000))
          expect(failedProbes).toBeGreaterThanOrEqual(poll)
        }

        expect(navigator.onLine).toBe(true)
        expect
          .soft(screen.queryByText("Network connection detected"))
          .not.toBeInTheDocument()
        expect
          .soft(screen.queryByRole("navigation", { name: "Main navigation" }))
          .not.toBeInTheDocument()
        expect.soft(routerFactory).not.toHaveBeenCalled()
        expect.soft(getPreferences).not.toHaveBeenCalled()
        expect
          .soft(openDatabase.mock.calls.map(([name]) => name))
          .not.toContain("qr-crypt")
        expect.soft(quarantine).not.toHaveBeenCalled()
        expect.soft(performWipe).not.toHaveBeenCalled()
        expect.soft(reloadPage).not.toHaveBeenCalled()
        expect.soft(endRelaySession).not.toHaveBeenCalledWith("display-offline")
        expect.soft(controller.getState()).toMatchObject({
          kind: "network-confirmed",
          relayEligibility: "eligible",
        })
        expect.soft(navigation).toBeVisible()
        expect(activeView).toBeVisible()
        if (tab === "Home") {
          await user.click(screen.getByRole("button", { name: "Relay" }))
          expect(screen.getByRole("button", { name: "Text → QR" })).toBeEnabled()
        } else {
          expect(screen.getByLabelText("Relay text")).toHaveValue("relay-session-draft")
          await user.click(screen.getByRole("button", { name: "Close" }))
          await user.click(screen.getByRole("button", { name: "Top" }))
          expect(home).toBeVisible()
        }
      } finally {
        rendered.unmount()
        controller.stop()
        openDatabase.mockRestore()
        vi.useRealTimers()
      }
    },
  )

  it("respects the injected controller's refusal when opening the relay", async () => {
    setTestOnlineStatus(true)
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      readDecision: async () => decision(),
    })
    const acquireRelaySession = vi.fn<(signal: AbortSignal) => Promise<null>>(
      async () => null,
    )
    const rendered = await renderApp("/encrypt", {
      bootController: { ...controller, acquireRelaySession },
    })
    try {
      const user = userEvent.setup()
      await user.click(await screen.findByRole("button", { name: "Relay" }))
      await user.click(screen.getByRole("button", { name: "Text → QR" }))
      expect(acquireRelaySession).toHaveBeenCalledWith(expect.any(AbortSignal))
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    } finally {
      rendered.unmount()
      controller.stop()
    }
  })

  it("renders the language field on a boot status screen", async () => {
    setTestOnlineStatus(true)
    const controller = createBootController({
      fetchImpl: vi.fn(async () => response("QR-CRYPT-REACHABLE")),
      performWipe: vi.fn(() => new Promise<BestEffortResetReport>(() => undefined)),
      readDecision: async () => decision({ sensitiveDataExists: true }),
    })
    await renderApp("/encrypt", { bootController: controller })
    await screen.findByText("Resetting local data")
    controller.stop()

    expectLanguageField()
  })

  it("renders the language field on the unsupported-browser screen", async () => {
    await renderApp("/encrypt", {
      detectFeatures: () => ({
        webCrypto: false,
        indexedDb: true,
        camera: true,
        serviceWorker: true,
      }),
    })
    await screen.findByText("UNSUPPORTED_BROWSER")

    expectLanguageField()
  })

  it("[acceptance 1] cold offline mounts Router without acknowledgement", async () => {
    let resolveFetch: ((value: Response) => void) | undefined
    const controller = createBootController({
      fetchImpl: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await renderApp("/encrypt", { bootController: controller })

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(getPreferences).not.toHaveBeenCalled()
    await act(async () => resolveFetch?.(response("not-the-sentinel")))

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

    expect(await screen.findByText(translate("en", "gate.heading"))).toBeVisible()
    expect(
      await screen.findByRole("navigation", { name: "Online navigation" }),
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Relay" }))
    expect(await screen.findByText(translate("en", "relay.card.title"))).toBeVisible()
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
    await user.click(await screen.findByRole("button", { name: "Relay" }))
    expect(await screen.findByText(translate("en", "relay.card.title"))).toBeVisible()
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
      fetchImpl: vi.fn(async () => response("not-the-sentinel")),
      readConnectivityHint: () => "offline",
      readDecision: async () => decision(),
    })
    await renderApp("/encrypt", { bootController: controller })

    await screen.findByText(translate("en", "gate.heading"))
    // Display-online while offline-confirmed schedules a reconciliation probe;
    // wait for that episode to settle back on offline-confirmed.
    await waitFor(() =>
      expect(controller.getState()).toEqual({ kind: "offline-confirmed" }),
    )
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

  it("shows the network-suspected lock with no way back but reload", async () => {
    const controller = createBootController({
      fetchImpl: vi.fn(async () => Promise.reject(new TypeError("offline"))),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
    })
    await renderApp("/encrypt", { bootController: controller })
    // Title is "Network connection detected" (no "was") — match the catalogue.
    expect(
      await screen.findByText(translate("en", "boot.networkSuspected.title")),
    ).toBeVisible()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByRole("button", { name: /retry|continue/i })).toBeNull()
    expect(screen.getByRole("button", { name: /reload/i })).toBeVisible()
    controller.stop()
  })

  it.each([
    ["deployment-unverified", "boot.deploymentUnverified.title"],
    ["deployment-failed", "boot.deploymentFailed.title"],
  ] as const)("shows the %s block with its own copy", async (reason, titleKey) => {
    // The two deployment refusals must not share copy: "unverified" is the
    // normal state of a fresh or wiped origin and must not accuse the server,
    // while "failed" means the server really did answer with wrong headers.
    // Pin the reason through a fixed-state stub so this screen test does not
    // depend on Task 5's deployment-verdict probe path. Cache getState's return
    // so useSyncExternalStore does not loop.
    const blockedState = {
      kind: "blocked" as const,
      reason,
    }
    const bootController: BootController = {
      acquire() {},
      acquireRelaySession: async () => null,
      addTransientResetHandler() {
        return () => undefined
      },
      endRelaySession() {},
      enterQuarantine() {},
      getState: () => blockedState,
      nudgeDisplayOffline: () => false,
      probe: async () => undefined,
      refreshRelayEligibility: async () => false,
      beginUserRequestedReset() {},
      reportResetFailure() {},
      registerRelaySessionEndHandler() {
        return () => undefined
      },
      release() {},
      start() {},
      stop() {},
      subscribe() {
        return () => undefined
      },
    }
    await renderApp("/encrypt", { bootController })
    expect(await screen.findByText(translate("en", titleKey))).toBeVisible()
  })

  it("never mounts the router while blocked", async () => {
    const controller = createBootController({
      fetchImpl: vi.fn(async () => Promise.reject(new TypeError("offline"))),
      readConnectivityHint: () => "online",
      readDecision: async () => decision(),
    })
    await renderApp("/encrypt", { bootController: controller })
    await screen.findByText(translate("en", "boot.networkSuspected.title"))
    expect(screen.queryByRole("navigation")).toBeNull()
    controller.stop()
  })
})
