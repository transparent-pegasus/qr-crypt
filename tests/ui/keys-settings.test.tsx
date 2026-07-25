import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  PublicIdentityBundleV2,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  armMaintenanceToken,
  clearAllIdentities,
  clearAllKeys,
  confirmBundleFingerprint,
  createIdentity,
  createSymmetricKeyRecord,
  deleteKeyRecord,
  emitScannedPayload,
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
  fakeBundles,
  fakeIdentities,
  fakeKeys,
  fakePreferences,
  saveBundle,
  startQrScan,
  updatePreferences,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

describe("key management v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.requireSignature = false
    resetUi()
  })

  it("shows noun-form tabs and separated camera/paste import cards", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    for (const name of ["Create", "Import"]) {
      expect(await screen.findByRole("tab", { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(screen.getByRole("tab", { name: "Create" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByRole("tablist")).toHaveClass(
      "grid",
      "h-11",
      "w-full",
      "grid-cols-2",
    )
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveClass("h-9", "cursor-pointer", "px-1", "text-sm")
      await user.click(tab)
      expect(screen.getByRole("tabpanel")).toHaveClass("mt-6")
    }
    const cameraHeading = screen.getByRole("heading", { name: "Scan with the camera" })
    const pasteHeading = screen.getByRole("heading", {
      name: "Paste a payload",
    })
    const cameraCard = cameraHeading.parentElement?.parentElement
    const pasteCard = pasteHeading.parentElement?.parentElement
    expect(cameraCard).toBeInstanceOf(HTMLDivElement)
    expect(pasteCard).toBeInstanceOf(HTMLDivElement)
    expect(cameraCard).not.toBe(pasteCard)
    expect(
      within(cameraCard as HTMLDivElement).getByRole("button", {
        name: "Scan a key QR code",
      }),
    ).toBeInTheDocument()
    expect(
      within(pasteCard as HTMLDivElement).getByLabelText("Key payload"),
    ).toBeInTheDocument()
    const exampleCaption = screen.getByText(
      "Ask the other party to increase their screen brightness, hold the camera about 15–20 cm away, and keep it still until the image is in focus.",
    )
    const scanIcon = exampleCaption.parentElement!.querySelector(
      "svg.lucide-scan-line",
    )!
    expect(scanIcon).toHaveAttribute("aria-hidden", "true")
    expect(exampleCaption.parentElement!.querySelector("img")).toBeNull()
    expect(
      screen.queryByText(
        "Import a public-key bundle by scanning a QR code or pasting a payload above.",
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("There are no imported public-key bundles."),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("確認済みの相手")).not.toBeInTheDocument()
    expect(
      screen.getByText(/2 legacy RSA keys cannot be used with v2 and cannot be recovered/),
    ).toBeInTheDocument()
    expect(screen.queryByText("受信鍵B")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Delete legacy keys" }))
    await waitFor(() => expect(deleteKeyRecord).toHaveBeenCalledTimes(2))
    expect(fakeKeys.every((key) => key.kind === "symmetric")).toBe(true)
  })

  it("creates the selected key kind through the embedded type select", async () => {
    const user = userEvent.setup()
    const identityCount = fakeIdentities.length
    const symmetricCount = fakeKeys.filter((key) => key.kind === "symmetric").length
    await renderApp("/keys")

    // defaultAlgorithm=A256GCM in the fakes, so the default kind is symmetric key.
    expect(await screen.findByLabelText("Symmetric-key name")).toBeInTheDocument()
    expect(screen.queryByText("experimental · not independently audited")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create a symmetric key" })).toBeDisabled()
    await user.type(screen.getByLabelText("Symmetric-key name"), "新しい共通鍵")
    await user.click(screen.getByRole("button", { name: "Create a symmetric key" }))
    await waitFor(() => expect(createSymmetricKeyRecord).toHaveBeenCalledOnce())
    expect(fakeKeys.filter((key) => key.kind === "symmetric")).toHaveLength(
      symmetricCount + 1,
    )
    let dialog = await screen.findByRole("dialog", { name: "新しい共通鍵" })
    expect(within(dialog).getByText("AES-256-GCM")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(screen.getByRole("combobox", { name: "Type" }))
    await user.click(
      screen.getByRole("option", {
        name: "Post-quantum identity ML-KEM-1024 + ML-DSA-87",
      }),
    )
    expect(
      await screen.findByText("experimental · not independently audited"),
    ).toBeInTheDocument()
    const auditNote = screen.getByRole("note")
    expect(auditNote).toHaveClass(
      "inline-flex",
      "h-11",
      "w-full",
      "items-center",
      "justify-center",
      "gap-2",
    )
    expect(auditNote.tagName).toBe("DIV")
    await user.type(screen.getByLabelText("Post-quantum identity name"), "新しいPQ ID")
    await user.click(
      screen.getByRole("button", { name: "Create a post-quantum identity" }),
    )
    await waitFor(() => expect(createIdentity).toHaveBeenCalledOnce())
    expect(fakeIdentities).toHaveLength(identityCount + 1)
    dialog = await screen.findByRole("dialog", { name: "新しいPQ ID" })
    expect(within(dialog).getByText("3".repeat(64))).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    expect(screen.queryByText(/Create a maximum ID/)).not.toBeInTheDocument()
  })

  it("blocks immediately on OCI2 fingerprint comparison and can save unverified", async () => {
    const user = userEvent.setup()
    const originalCount = fakeBundles.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Import" }))
    await user.type(screen.getByLabelText("Key payload"), "OCI2:fake")
    await user.click(screen.getByRole("button", { name: "Read the key" }))

    const dialog = await screen.findByRole("dialog", {
      name: "Compare the fingerprint through another channel",
    })
    expect(within(dialog).getByText("9".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("7".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("8".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Verify and save" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(
      screen.getByRole("dialog", {
        name: "Compare the fingerprint through another channel",
      }),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "Save without verification" }))
    await waitFor(() => expect(saveBundle).toHaveBeenCalledTimes(1))
    expect(confirmBundleFingerprint).not.toHaveBeenCalled()
    expect(fakeBundles).toHaveLength(originalCount + 1)
    expect(fakeBundles[0]?.trust).toBe("unverified")
  })

  it("confers fingerprint-confirmed trust only after the explicit checkbox", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Import" }))
    await user.type(screen.getByLabelText("Key payload"), "OCI2:fake")
    await user.click(screen.getByRole("button", { name: "Read the key" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Compare the fingerprint through another channel",
    })
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I confirmed a match through another channel",
      }),
    )
    await user.click(within(dialog).getByRole("button", { name: "Verify and save" }))
    await waitFor(() => expect(confirmBundleFingerprint).toHaveBeenCalledTimes(1))
    expect(fakeBundles[0]?.trust).toBe("fingerprint-confirmed")
  })

  it("rejects a balanced OCI2 bundle before the fingerprint/import flow", async () => {
    const legacyBundle: PublicIdentityBundleV2 = {
      version: 2,
      type: "pq-public-identity",
      identityId: "B".repeat(22),
      kem: {
        algorithm: "ML-KEM-768",
        keyId: "K".repeat(22),
        publicKey: new Uint8Array(1184),
      },
      signing: {
        algorithm: "ML-DSA-65",
        keyId: "S".repeat(22),
        publicKey: new Uint8Array(1952),
      },
      createdAt: 1_700_000_000_000,
    }
    encodePublicIdentityBundleV2(legacyBundle)
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Import" }))
    await user.type(screen.getByLabelText("Key payload"), "OCI2:legacy-balanced")
    await user.click(screen.getByRole("button", { name: "Read the key" }))

    expect(
      await screen.findByText("This cryptographic algorithm is not supported."),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", {
        name: "Compare the fingerprint through another channel",
      }),
    ).not.toBeInTheDocument()
    expect(saveBundle).not.toHaveBeenCalled()
  })

  it("rejects balanced OCP2 and OCS2 single keys before exposing fingerprints", async () => {
    const legacyKem: KemPublicKeyEnvelopeV2 = {
      version: 2,
      type: "pq-kem-public-key",
      identityId: "B".repeat(22),
      algorithm: "ML-KEM-768",
      keyId: "K".repeat(22),
      publicKey: new Uint8Array(1184),
      createdAt: 1_700_000_000_000,
    }
    const legacyDsa: DsaPublicKeyEnvelopeV2 = {
      version: 2,
      type: "pq-dsa-public-key",
      identityId: "B".repeat(22),
      algorithm: "ML-DSA-65",
      keyId: "S".repeat(22),
      publicKey: new Uint8Array(1952),
      createdAt: 1_700_000_000_000,
    }
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Import" }))
    const input = screen.getByLabelText("Key payload")

    encodeKemPublicKeyEnvelopeV2(legacyKem)
    await user.type(input, "OCP2:legacy-balanced")
    await user.click(screen.getByRole("button", { name: "Read the key" }))
    expect(
      await screen.findByText("This cryptographic algorithm is not supported."),
    ).toBeInTheDocument()
    expect(screen.queryByText("A single key was read")).not.toBeInTheDocument()

    await user.clear(input)
    encodeDsaPublicKeyEnvelopeV2(legacyDsa)
    await user.type(input, "OCS2:legacy-balanced")
    await user.click(screen.getByRole("button", { name: "Read the key" }))
    expect(
      await screen.findByText("This cryptographic algorithm is not supported."),
    ).toBeInTheDocument()
    expect(screen.queryByText("A single key was read")).not.toBeInTheDocument()
  })

  it("keeps single-frame OCK1 camera import behind a secret-key confirmation", async () => {
    const user = userEvent.setup()
    const originalCount = fakeKeys.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Import" }))
    expect(startQrScan).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Scan a key QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () => emitScannedPayload("OCK1:imported-key-000001"))

    const dialog = await screen.findByRole("dialog", { name: "Import a symmetric key" })
    const save = within(dialog).getByRole("button", { name: "Save the symmetric key" })
    expect(save).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I trust the channel used to share this key",
      }),
    )
    await user.click(save)
    await waitFor(() => expect(fakeKeys).toHaveLength(originalCount + 1))
  })
})

describe("settings v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.requireSignature = false
    resetUi()
  })

  it("persists every numeric boundary and shows wipe/reset warnings", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const frameBytes = await screen.findByLabelText(/Raw data per frame/)
    const frameInterval = screen.getByLabelText(/Frame interval/)
    const transferTimeout = screen.getByLabelText(/Scan-state lifetime/)
    expect(frameBytes).toHaveAttribute("min", "200")
    expect(frameBytes).toHaveAttribute("max", "900")
    expect(frameInterval).toHaveAttribute("min", "1000")
    expect(frameInterval).toHaveAttribute("max", "3000")
    expect(frameInterval).toHaveAttribute("step", "500")
    expect(transferTimeout).toHaveAttribute("min", "1")
    expect(transferTimeout).toHaveAttribute("max", "120")
    fireEvent.change(frameBytes, { target: { value: "900" } })
    fireEvent.change(frameInterval, { target: { value: "2250" } })
    expect(updatePreferences).not.toHaveBeenCalledWith({ frameIntervalMs: 2_250 })
    fireEvent.change(frameInterval, { target: { value: "3000" } })
    fireEvent.change(transferTimeout, { target: { value: "120" } })
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({ frameBytes: 900 })
      expect(updatePreferences).toHaveBeenCalledWith({ frameIntervalMs: 3_000 })
      expect(updatePreferences).toHaveBeenCalledWith({ transferTimeoutMinutes: 120 })
    })

    const wipe = screen.getByRole("switch", {
      name: "Reset local data after confirmed online connectivity",
    })
    expect(wipe).toBeChecked()
    await user.click(wipe)
    expect(await screen.findByText("Local data will remain")).toBeInTheDocument()

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
      screen.getByText(/JavaScript implementation does not guarantee resistance to side channels/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Physical erasure is not guaranteed/)).toBeInTheDocument()
  })

  it("enforces the environment signature floor", async () => {
    env.requireSignature = true
    fakePreferences.requireSignature = true
    await renderApp("/settings")
    const signature = await screen.findByRole("switch", { name: "Require a signature" })
    expect(signature).toBeChecked()
    expect(signature).toBeDisabled()
    expect(
      screen.getByText(/cannot be disabled because it is required by the environment configuration/),
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByLabelText("Default cryptographic algorithm"))
    expect(
      screen.queryByRole("option", { name: /^Post-quantum ML-KEM/ }),
    ).not.toBeInTheDocument()
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
      name: "Keep keys for the next update only",
    })
    expect(button).toBeEnabled()
    await user.click(button)
    const dialog = await screen.findByRole("alertdialog", {
      name: "Keep keys for the next update only",
    })
    const action = within(dialog).getByRole("button", { name: "Arm maintenance token" })
    expect(action).toBeDisabled()
    await user.type(within(dialog).getByLabelText("Confirmation text"), "KEEP KEYS")
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
    await user.type(within(dialog).getByLabelText("Confirmation text"), "DELETE ALL")
    await user.click(action)

    await waitFor(() => {
      expect(clearAllKeys).toHaveBeenCalledOnce()
      expect(clearAllIdentities).toHaveBeenCalledOnce()
    })
    expect(fakeKeys).toHaveLength(0)
    expect(fakeIdentities).toHaveLength(0)
  })
})
