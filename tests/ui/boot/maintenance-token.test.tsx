import "../helpers/module-mocks/feature-detection"
import "../helpers/module-mocks/pwa"
import "../helpers/module-mocks/preferences"
import "../helpers/module-mocks/qr-scanner"
import "../helpers/module-mocks/key-records"
import "../helpers/module-mocks/pq-records"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as boot from "@/app/boot/boot-controller"
import { isMessageKey, translate } from "@/i18n/messages"
import { KEEP_KEYS_CONFIRMATION } from "@/pages/settings-confirmations"
import {
  closeDb,
  deleteEntireDatabase,
  getDb,
  resetDatabaseAccessBarrierForTesting,
  STORE_APP_METADATA,
} from "@/storage/database"
import { decision } from "../../helpers/boot-fixtures"
import { deferred } from "../../helpers/deferred"
import { renderApp, resetUi } from "../helpers/render-app"

// The contract fixes these two keys before the independently authored catalogs
// exist. A missing translation must fail a visible-text assertion in RED.
function armedNotice(): string {
  const key = "settings.maintenance.armedNotice"
  return isMessageKey(key) ? translate("en", key) : key
}

function disarmLabel(): string {
  const key = "settings.maintenance.disarm"
  return isMessageKey(key) ? translate("en", key) : key
}

function offlineController() {
  return boot.createBootController({
    fetchImpl: async () => {
      throw new TypeError("offline")
    },
    readConnectivityHint: () => "offline",
    // Isolate display/boot admission from the UI token reader. Tests below can
    // fail or delay that reader without manufacturing a destructive boot event.
    readDecision: async () => decision(),
  })
}

async function openSettings(): Promise<void> {
  await renderApp("/settings", { bootController: offlineController() })
  await screen.findByRole("heading", { name: "Settings" })
}

async function armFromSettings(user: UserEvent): Promise<void> {
  await user.click(
    screen.getByRole("button", {
      name: "Keep keys across the next online transition only",
    }),
  )
  const dialog = await screen.findByRole("alertdialog")
  await user.type(
    within(dialog).getByLabelText("Confirmation text"),
    KEEP_KEYS_CONFIRMATION,
  )
  await user.click(within(dialog).getByRole("checkbox", { name: /applies once/ }))
  await user.click(within(dialog).getByRole("button", { name: "Arm maintenance token" }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
}

async function settleUi(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function refreshOnVisibility(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
  fireEvent(document, new Event("visibilitychange"))
}

describe("offline maintenance-token state", () => {
  beforeEach(resetUi)
  afterEach(async () => {
    resetUi()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetDatabaseAccessBarrierForTesting()
    closeDb()
    await deleteEntireDatabase()
    Reflect.deleteProperty(document, "visibilityState")
  })

  it("shows a newly persisted armed token on every offline route and after reload", async () => {
    const user = userEvent.setup()
    await openSettings()

    await armFromSettings(user)

    await expect(boot.readBootDecision()).resolves.toMatchObject({
      maintenanceTokenArmed: true,
    })
    expect(await screen.findAllByText(armedNotice())).not.toHaveLength(0)
    for (const name of ["Encrypt", "Decrypt", "Keys", "Settings"]) {
      await user.click(screen.getByRole("link", { name }))
      await waitFor(() => expect(window.location.pathname).toBe(`/${name.toLowerCase()}`))
      expect(screen.getAllByText(armedNotice()).length).toBeGreaterThan(0)
    }

    resetUi({ clearStorage: false })
    closeDb()
    await renderApp("/decrypt", { bootController: offlineController() })
    expect(await screen.findAllByText(armedNotice())).not.toHaveLength(0)
  })

  it("loads a stored token, disarms it, and keeps the app usable and unarmed after reload", async () => {
    await boot.armMaintenanceToken()
    closeDb()
    const user = userEvent.setup()
    await openSettings()
    await screen.findAllByText(armedNotice())

    await user.click(screen.getByRole("button", { name: disarmLabel() }))

    await waitFor(() => expect(screen.queryAllByText(armedNotice())).toHaveLength(0))
    await expect(boot.readBootDecision()).resolves.toMatchObject({
      maintenanceTokenArmed: false,
    })
    expect(screen.getByRole("navigation")).toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: "Encrypt" }))
    expect(await screen.findByLabelText("Plaintext")).toBeEnabled()
    expect(screen.queryAllByText(armedNotice())).toHaveLength(0)

    resetUi({ clearStorage: false })
    closeDb()
    await openSettings()
    await settleUi()
    expect(screen.queryAllByText(armedNotice())).toHaveLength(0)
    await expect(boot.readBootDecision()).resolves.toMatchObject({
      maintenanceTokenArmed: false,
    })
  })

  it("does not clear the warning or announce success when persisted disarm fails", async () => {
    await boot.armMaintenanceToken()
    const user = userEvent.setup()
    await openSettings()
    await screen.findAllByText(armedNotice())
    const success = vi.spyOn(toast, "success")
    const remove = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => {
      throw new DOMException("storage unavailable", "UnknownError")
    })

    await user.click(screen.getByRole("button", { name: disarmLabel() }))

    await waitFor(() => expect(remove).toHaveBeenCalled())
    await settleUi()
    expect(screen.getAllByText(armedNotice()).length).toBeGreaterThan(0)
    expect(success).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: disarmLabel() })).toBeEnabled()
    await expect(boot.readBootDecision()).resolves.toMatchObject({
      maintenanceTokenArmed: true,
    })
  })

  it.each([
    ["focus", () => fireEvent.focus(window)],
    ["visibility", refreshOnVisibility],
  ] as const)(
    "refreshes shared route and settings state on %s",
    async (_label, refresh) => {
      const read = vi.spyOn(boot, "readBootDecision").mockResolvedValue(decision())
      const user = userEvent.setup()
      await openSettings()
      await waitFor(() => expect(read).toHaveBeenCalled())
      await settleUi()
      expect(screen.queryAllByText(armedNotice())).toHaveLength(0)

      read.mockResolvedValue(decision({ maintenanceTokenArmed: true }))
      refresh()

      await screen.findAllByText(armedNotice())
      expect(screen.getByRole("button", { name: disarmLabel() })).toBeEnabled()
      await user.click(screen.getByRole("link", { name: "Decrypt" }))
      expect(screen.getAllByText(armedNotice()).length).toBeGreaterThan(0)
      await user.click(screen.getByRole("link", { name: "Settings" }))
      expect(screen.getByRole("button", { name: disarmLabel() })).toBeEnabled()
    },
  )

  it.each(["rejected", "indeterminate"] as const)(
    "retains an armed warning when a refresh is %s rather than claiming unarmed",
    async (failure) => {
      const read = vi
        .spyOn(boot, "readBootDecision")
        .mockResolvedValue(decision({ maintenanceTokenArmed: true }))
      await openSettings()
      await screen.findAllByText(armedNotice())
      const before = read.mock.calls.length
      if (failure === "rejected") read.mockRejectedValue(new Error("read failed"))
      else
        read.mockResolvedValue(
          decision({
            cleanOrigin: "indeterminate",
            maintenanceTokenArmed: false,
            preferencesReadFailed: false,
          }),
        )

      fireEvent.focus(window)

      await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before))
      await settleUi()
      expect(screen.getAllByText(armedNotice()).length).toBeGreaterThan(0)
    },
  )

  it("discards an older unarmed read that completes after a newer armed read", async () => {
    const read = vi
      .spyOn(boot, "readBootDecision")
      .mockResolvedValue(decision({ maintenanceTokenArmed: true }))
    await openSettings()
    await screen.findAllByText(armedNotice())
    const stale = deferred<boot.BootDecisionSnapshot>()
    read.mockReturnValueOnce(stale.promise)
    const before = read.mock.calls.length
    fireEvent.focus(window)
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before))

    refreshOnVisibility()
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before + 1))
    await settleUi()
    await act(async () => {
      stale.resolve(decision({ maintenanceTokenArmed: false }))
    })

    expect(screen.getAllByText(armedNotice()).length).toBeGreaterThan(0)
  })

  it("rereads authoritative token storage on peer invalidation and shares the result across routes", async () => {
    const read = vi.spyOn(boot, "readBootDecision")
    const peer = new BroadcastChannel("qr-crypt-maintenance-token")
    const user = userEvent.setup()
    try {
      await openSettings()
      await waitFor(() => expect(read).toHaveBeenCalled())
      await settleUi()
      expect(screen.queryAllByText(armedNotice())).toHaveLength(0)

      // Write the persisted boundary directly, as another document would. The
      // invalidation deliberately carries no token state or sensitive data.
      const database = await getDb()
      await database.put(STORE_APP_METADATA, {
        key: "maintenance-token",
        value: { armedAt: 1_700_000_000_000 },
      })
      peer.postMessage({ type: "changed" })
      await screen.findAllByText(armedNotice())
      expect(screen.getByRole("button", { name: disarmLabel() })).toBeEnabled()

      const before = read.mock.calls.length
      peer.postMessage({ type: "changed" })
      await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before))
      await settleUi()
      expect(screen.getAllByText(armedNotice()).length).toBeGreaterThan(0)

      await database.delete(STORE_APP_METADATA, "maintenance-token")
      peer.postMessage({ type: "changed" })
      await waitFor(() => expect(screen.queryAllByText(armedNotice())).toHaveLength(0))
      await user.click(screen.getByRole("link", { name: "Decrypt" }))
      expect(await screen.findByLabelText("Ciphertext payload")).toBeInTheDocument()
      expect(screen.queryAllByText(armedNotice())).toHaveLength(0)
    } finally {
      peer.close()
    }
  })

  it("refreshes initial, focused, and visible state when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined)
    const read = vi
      .spyOn(boot, "readBootDecision")
      .mockResolvedValue(decision({ maintenanceTokenArmed: true }))
    await openSettings()
    await screen.findAllByText(armedNotice())

    read.mockResolvedValue(decision({ maintenanceTokenArmed: false }))
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryAllByText(armedNotice())).toHaveLength(0))

    read.mockResolvedValue(decision({ maintenanceTokenArmed: true }))
    refreshOnVisibility()
    expect(await screen.findAllByText(armedNotice())).not.toHaveLength(0)
  })
})
