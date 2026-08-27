import "./helpers/module-mocks/feature-detection"
import "./helpers/module-mocks/pwa"
import "./helpers/module-mocks/preferences"
import "./helpers/module-mocks/qr-scanner"
import "./helpers/module-mocks/key-records"
import "./helpers/module-mocks/pq-records"
import "./helpers/module-mocks/boot"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/boot/wipe-coordinator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/boot/wipe-coordinator")>()),
  performUserRequestedReset: vi.fn(),
}))
vi.mock("@/lib/reload", () => ({ reloadApplication: vi.fn() }))

import { resetDefaultBootControllerForTesting } from "@/app/boot/boot-controller"
import { performUserRequestedReset } from "@/app/boot/wipe-coordinator"
import { translate } from "@/i18n/messages"
import { reloadApplication } from "@/lib/reload"
import {
  DELETE_ALL_CONFIRMATION,
  DISABLE_WIPE_CONFIRMATION,
  KEEP_KEYS_CONFIRMATION,
} from "@/pages/settings-confirmations"
import { env } from "@/schemas/env-schema"
import {
  fakePreferences,
  updatePreferences,
} from "./helpers/fakes/preferences"
import {
  clearAllKeys,
  fakeKeys,
} from "./helpers/fakes/key-records"
import {
  clearAllIdentities,
  fakeIdentities,
} from "./helpers/fakes/pq-records"
import { armMaintenanceToken } from "./helpers/fakes/boot"
import { expectSingleAlertCancelWithoutClose } from "./helpers/dialog-assertions"
import { renderApp, resetUi } from "./helpers/render-app"

function en(key: Parameters<typeof translate>[1]): string {
  return translate("en", key)
}

async function runResetAllLocalData(user: UserEvent): Promise<void> {
  await user.click(
    await screen.findByRole("button", {
      name: en("settings.resetAllData"),
    }),
  )
  await user.type(
    screen.getByLabelText(en("settings.confirmationLabel")),
    DELETE_ALL_CONFIRMATION,
  )
  await user.click(
    screen.getByRole("button", {
      name: en("settings.delete.execute"),
    }),
  )
}

describe("settings page", () => {
  beforeEach(resetUi)
  afterEach(() => {
    resetUi()
    // The terminal boot state is a module singleton; leaving it engaged would
    // make every later test in this file start from a dead application.
    resetDefaultBootControllerForTesting()
  })

  it("shows both environment-selected background auto-clear delays", async () => {
    const originalNormalSeconds = env.autoClearSeconds
    const originalFallbackSeconds = env.autoClearFallbackSeconds
    env.autoClearSeconds = 17
    env.autoClearFallbackSeconds = 211
    try {
      await renderApp("/settings")
      expect(
        await screen.findByText(
          "When enabled, plaintext is cleared 17 seconds after the app moves to the background. If the WebAssembly runtime required by the QR reader is unavailable, it is cleared after 211 seconds instead.",
        ),
      ).toBeInTheDocument()
    } finally {
      env.autoClearSeconds = originalNormalSeconds
      env.autoClearFallbackSeconds = originalFallbackSeconds
    }
  })

  it("persists remaining numeric boundaries and shows the reset warning", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const transferTimeout = await screen.findByLabelText(/Scan-state lifetime/)
    expect(transferTimeout).toHaveAttribute("min", "5")
    expect(transferTimeout).toHaveAttribute("max", "120")
    fireEvent.change(transferTimeout, { target: { value: "4" } })
    expect(updatePreferences).not.toHaveBeenCalledWith({ transferTimeoutMinutes: 4 })
    fireEvent.change(transferTimeout, { target: { value: "120" } })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ transferTimeoutMinutes: 120 }),
    )
    expect(screen.queryByText("Settings saved")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Advanced: reset churn/ }))
    const resetChurn = screen.getByLabelText(/reset churn/)
    expect(resetChurn).toHaveAttribute("min", "0")
    expect(resetChurn).toHaveAttribute("max", "512")
    fireEvent.change(resetChurn, { target: { value: "512" } })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ resetChurnMb: 512 }),
    )
    expect(screen.getByText(/Churn does not guarantee erasure/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /JavaScript implementation does not guarantee resistance to side channels/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Physical erasure is not guaranteed/)).toBeInTheDocument()
  })

  it("does not write wipeOnOnline=false until the typed confirmation completes", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const wipe = await screen.findByRole("switch", {
      name: "Reset local data after confirmed online connectivity",
    })

    await user.click(wipe)

    expect(updatePreferences).not.toHaveBeenCalledWith({ wipeOnOnline: false })
    expect(wipe).toBeChecked()
    expect(screen.queryByText("Local data will remain")).not.toBeInTheDocument()

    const dialog = await screen.findByRole("alertdialog")
    const confirmation = within(dialog).getByLabelText("Confirmation text")
    const acknowledge = within(dialog).getByRole("checkbox")
    const confirm = within(dialog).getByRole("button", { name: /disable/i })
    expect(confirm).toBeDisabled()

    await user.type(confirmation, DISABLE_WIPE_CONFIRMATION)
    expect(confirm).toBeDisabled()
    await user.click(acknowledge)
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ wipeOnOnline: false }),
    )
    expect(await screen.findByText("Local data will remain")).toBeInTheDocument()
  })

  it("wrong phrase or unchecked box keeps the confirm button inert and cancel leaves the switch on", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const wipe = await screen.findByRole("switch", {
      name: "Reset local data after confirmed online connectivity",
    })

    await user.click(wipe)

    const dialog = await screen.findByRole("alertdialog")
    const confirmation = within(dialog).getByLabelText("Confirmation text")
    const acknowledge = within(dialog).getByRole("checkbox")
    const confirm = within(dialog).getByRole("button", { name: /disable/i })

    await user.type(confirmation, "WRONG")
    await user.click(acknowledge)
    expect(confirm).toBeDisabled()

    await user.clear(confirmation)
    await user.type(confirmation, DISABLE_WIPE_CONFIRMATION)
    await user.click(acknowledge)
    expect(confirm).toBeDisabled()
    expect(updatePreferences).not.toHaveBeenCalledWith({ wipeOnOnline: false })

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }))

    expect(updatePreferences).not.toHaveBeenCalledWith({ wipeOnOnline: false })
    expect(wipe).toBeChecked()
    expect(screen.queryByText("Local data will remain")).not.toBeInTheDocument()
  })

  it("re-enabling writes immediately without a dialog and keeps later disarm guarded", async () => {
    fakePreferences.wipeOnOnline = false
    const user = userEvent.setup()
    await renderApp("/settings")
    const wipe = await screen.findByRole("switch", {
      name: "Reset local data after confirmed online connectivity",
    })

    // The hook paints the fail-safe default (on) before the stored preference
    // loads, so wait for that load instead of asserting the first frame.
    expect(await screen.findByText("Local data will remain")).toBeInTheDocument()
    expect(wipe).not.toBeChecked()

    await user.click(wipe)

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ wipeOnOnline: true }),
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText("Local data will remain")).not.toBeInTheDocument(),
    )

    updatePreferences.mockClear()
    await user.click(wipe)

    expect(updatePreferences).not.toHaveBeenCalledWith({ wipeOnOnline: false })
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
  })

  it("clears only a stale preference save error after a successful save", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const transferTimeout = await screen.findByLabelText(/Scan-state lifetime/)
    const saveError = "Settings could not be saved. Check the device storage."
    updatePreferences.mockRejectedValueOnce(new Error("storage failed"))

    fireEvent.change(transferTimeout, { target: { value: "20" } })
    expect(await screen.findByText(saveError)).toBeInTheDocument()

    fireEvent.change(transferTimeout, { target: { value: "30" } })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ transferTimeoutMinutes: 30 }),
    )
    await waitFor(() => expect(screen.queryByText(saveError)).not.toBeInTheDocument())

    clearAllKeys.mockRejectedValueOnce(new Error("delete failed"))
    await user.click(screen.getByRole("button", { name: "Delete all keys" }))
    const dialog = await screen.findByRole("alertdialog", { name: "Delete all keys" })
    expectSingleAlertCancelWithoutClose(dialog)
    await user.type(
      within(dialog).getByLabelText("Confirmation text"),
      DELETE_ALL_CONFIRMATION,
    )
    await user.click(within(dialog).getByRole("button", { name: "Run logical deletion" }))
    const deleteError = "Data could not be deleted. Check the device storage."
    expect(await screen.findByText(deleteError)).toBeInTheDocument()

    fireEvent.change(transferTimeout, { target: { value: "40" } })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ transferTimeoutMinutes: 40 }),
    )
    expect(screen.getByText(deleteError)).toBeInTheDocument()
  })

  it("offers neither retired post-quantum preference control", async () => {
    await renderApp("/settings")
    await screen.findByLabelText("Default cryptographic algorithm")
    expect(
      screen.queryByRole("combobox", { name: /post-quantum profile/iu }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("switch", { name: "Require a signature" }),
    ).not.toBeInTheDocument()
  })

  it("offers only symmetric and signed post-quantum algorithms", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const algorithm = await screen.findByLabelText("Default cryptographic algorithm")
    await user.click(algorithm)
    expect(
      screen.queryByRole("option", {
        name: "Public-key ML-KEM-1024 + AES-256-GCM",
      }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Shared-key AES-256-GCM",
      "Public-key ML-KEM-1024 + ML-DSA-87 + AES-256-GCM",
    ])
  })

  it("switches the settings language and persists the selection", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument()
    await user.click(screen.getByLabelText("Language"))
    await user.click(screen.getByRole("option", { name: "日本語" }))

    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument()
    expect(window.localStorage.getItem("oc-lang")).toBe("ja")
    expect(document.documentElement.lang).toBe("ja")

    await user.click(screen.getByLabelText("言語"))
    await user.click(screen.getByRole("option", { name: "English" }))

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
    expect(window.localStorage.getItem("oc-lang")).toBe("en")
    expect(document.documentElement.lang).toBe("en")
  })

  it("arms the one-shot maintenance token only after strong offline confirmation", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const button = await screen.findByRole("button", {
      name: "Keep keys across the next online transition only",
    })
    expect(button).toBeEnabled()
    await user.click(button)
    const dialog = await screen.findByRole("alertdialog", {
      name: "Keep keys across the next online transition only",
    })
    expectSingleAlertCancelWithoutClose(dialog)
    const action = within(dialog).getByRole("button", { name: "Arm maintenance token" })
    expect(action).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText("Confirmation text"),
      KEEP_KEYS_CONFIRMATION,
    )
    await user.click(within(dialog).getByRole("checkbox", { name: /applies once/ }))
    expect(action).toBeEnabled()
    await user.click(action)
    await waitFor(() => expect(armMaintenanceToken).toHaveBeenCalledTimes(1))
  })

  it("clears symmetric keys and post-quantum identities together", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    expect(fakeKeys.length).toBeGreaterThan(0)
    expect(fakeIdentities.length).toBeGreaterThan(0)

    await user.click(await screen.findByRole("button", { name: "Delete all keys" }))
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete all keys",
    })
    const action = within(dialog).getByRole("button", { name: "Run logical deletion" })
    expect(action).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText("Confirmation text"),
      DELETE_ALL_CONFIRMATION,
    )
    await user.click(action)

    await waitFor(() => {
      expect(clearAllKeys).toHaveBeenCalledOnce()
      expect(clearAllIdentities).toHaveBeenCalledOnce()
    })
    expect(fakeKeys).toHaveLength(0)
    expect(fakeIdentities).toHaveLength(0)
  })

  it("routes Reset all local data through the coordinator with stored churn and reloads on success", async () => {
    const user = userEvent.setup()
    fakePreferences.resetChurnMb = 64
    vi.mocked(performUserRequestedReset).mockResolvedValue({
      ok: true,
      failedSteps: [],
    })
    await renderApp("/settings")

    await runResetAllLocalData(user)

    expect(performUserRequestedReset).toHaveBeenCalledWith({
      resetChurnMb: 64,
      resetTransient: expect.any(Function),
    })
    expect(reloadApplication).toHaveBeenCalledTimes(1)
  })

  it("publishes a durable terminal RESET_FAILED gate on partial failure", async () => {
    const user = userEvent.setup()
    vi.mocked(performUserRequestedReset).mockResolvedValue({
      ok: false,
      failedSteps: ["database", "database-verification"],
    })
    await renderApp("/settings")

    await runResetAllLocalData(user)

    // The terminal state belongs to the boot controller, not to this page: the
    // coordinator already engaged the one-way barrier, so the Router and its
    // navigation must be gone, not merely covered.
    expect(await screen.findByText("RESET_FAILED")).toBeInTheDocument()
    expect(screen.getByText(en("errors.RESET_FAILED"))).toBeInTheDocument()
    expect(screen.getByText(en("boot.partialFailure.retryHint"))).toBeInTheDocument()
    expect(screen.getByText("database, database-verification")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: en("settings.resetAllData") }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(reloadApplication).not.toHaveBeenCalled()
  })

  it("no longer clears oc-* localStorage inline (the coordinator owns it)", async () => {
    const user = userEvent.setup()
    vi.mocked(performUserRequestedReset).mockResolvedValue({
      ok: true,
      failedSteps: [],
    })
    await renderApp("/settings")
    window.localStorage.setItem("oc-canary", "1")

    await runResetAllLocalData(user)

    expect(window.localStorage.getItem("oc-canary")).toBe("1")
  })
})
