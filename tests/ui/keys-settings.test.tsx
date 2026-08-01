import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/app/boot/wipe-coordinator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/boot/wipe-coordinator")>()),
  performUserRequestedReset: vi.fn(),
}))
vi.mock("@/lib/reload", () => ({ reloadApplication: vi.fn() }))
import { performUserRequestedReset } from "@/app/boot/wipe-coordinator"
import { translate } from "@/i18n/messages"
import { reloadApplication } from "@/lib/reload"
import { buildV2Payload } from "@/qr/payload-v2"
import { resetDefaultBootControllerForTesting } from "@/app/boot/boot-controller"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  PublicIdentityBundleV2,
  StoredKeyRecord,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { deferred } from "../helpers/deferred"
import {
  armMaintenanceToken,
  buildSymmetricKeyEnvelopeV2,
  clearAllIdentities,
  clearAllKeys,
  confirmBundleFingerprint,
  createIdentity,
  createSymmetricKeyRecord,
  emitScannedPayload,
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
  encodeSymmetricKeyEnvelopeV2,
  fakeBundles,
  fakeIdentities,
  fakeKeys,
  fakePreferences,
  decodeSymmetricKeyEnvelopeV2,
  importSymmetricKeyRecordV2,
  multipartPayload,
  renderQrDataUrl,
  saveBundle,
  saveKeyRecord,
  setNextMultipartArtifactBytes,
  splitIntoFrames,
  startQrScan,
  updatePreferences,
} from "./helpers/fakes"
import { expectSingleAlertCancelWithoutClose } from "./helpers/dialog-assertions"
import { renderApp, resetUi } from "./helpers/render-app"

function en(key: Parameters<typeof translate>[1]): string {
  return translate("en", key)
}

function ock2SourceRecord(): StoredKeyRecord {
  return {
    ...fakeKeys[0]!,
    id: "Y".repeat(22),
    name: "OCK2 source key",
    fingerprint: "ab".repeat(32),
    status: "active",
  }
}

async function prepareOck2Artifact(source: StoredKeyRecord): Promise<{
  artifactBytes: Uint8Array
  payload: string
}> {
  const envelope = await buildSymmetricKeyEnvelopeV2(source)
  const artifactBytes = encodeSymmetricKeyEnvelopeV2(envelope)
  return {
    artifactBytes,
    payload: buildV2Payload("symmetric-key", artifactBytes),
  }
}

async function runResetAllLocalData(user: UserEvent): Promise<void> {
  await user.click(
    await screen.findByRole("button", {
      name: en("settings.resetAllData"),
    }),
  )
  await user.type(screen.getByLabelText(en("settings.confirmationLabel")), "DELETE ALL")
  await user.click(
    screen.getByRole("button", {
      name: en("settings.delete.execute"),
    }),
  )
}

describe("key management v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.requireSignature = false
    resetUi()
    // The terminal boot state is a module singleton; leaving it engaged would
    // make every later test in this file start from a dead application.
    resetDefaultBootControllerForTesting()
  })

  it("puts key import in one modal with separated camera and paste cards", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    // Creation and import are actions on the key list now, not page-level tabs.
    expect(
      await screen.findByRole("button", { name: "Create a key" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Create" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Import" })).toBeNull()

    await user.click(screen.getByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
    const modal = await screen.findByRole("dialog", { name: "Import" })
    const cameraHeading = within(modal).getByRole("heading", {
      name: "Scan with the camera",
    })
    const pasteHeading = within(modal).getByRole("heading", {
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
    const exampleCaption = within(modal).getByText(
      "Ask the other party to increase their screen brightness, hold the camera about 15–20 cm away, and keep it still until the image is in focus.",
    )
    const scanIcon = within(cameraCard as HTMLDivElement)
      .getByRole("button", { name: "Scan a key QR code" })
      .querySelector("svg.lucide-scan-line")!
    expect(scanIcon).toHaveAttribute("aria-hidden", "true")
    expect(within(cameraCard as HTMLDivElement).queryByRole("img")).toBeNull()
    expect(exampleCaption.parentElement!.querySelector("img")).toBeNull()
    expect(
      screen.queryByText(
        "Import a public-key bundle by scanning a QR code or pasting a payload above.",
      ),
    ).not.toBeInTheDocument()
    // The legacy-RSA alert is gone with the keys page: no code path stores those kinds.
    expect(
      screen.queryByText(
        /legacy RSA keys cannot be used with v2 and cannot be recovered/,
      ),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete legacy keys" })).toBeNull()
  })

  it("creates the selected key kind through the embedded type select", async () => {
    const user = userEvent.setup()
    const identityCount = fakeIdentities.length
    const symmetricCount = fakeKeys.filter((key) => key.kind === "symmetric").length
    await renderApp("/keys")
    await user.click(await screen.findByRole("button", { name: "Create a key" }))

    // defaultAlgorithm=A256GCM in the fakes, so the default kind is symmetric key.
    expect(await screen.findByLabelText("Symmetric-key name")).toBeInTheDocument()
    expect(
      screen.queryByText("experimental · not independently audited"),
    ).not.toBeInTheDocument()
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

    // Closing the detail closes the whole modal, so creation restarts from the list.
    await user.click(await screen.findByRole("button", { name: "Create a key" }))
    await user.click(await screen.findByRole("combobox", { name: "Key type" }))
    await user.click(
      screen.getByRole("option", {
        name: "Post-quantum identity ML-KEM-1024 + ML-DSA-87",
      }),
    )
    expect(
      await screen.findByText("experimental · not independently audited"),
    ).toBeInTheDocument()
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

  it("opens every key QR fullscreen from /keys and persists fullscreen controls across remount", async () => {
    const user = userEvent.setup()
    const firstQrRender = deferred<string>()
    renderQrDataUrl.mockImplementationOnce(() => firstQrRender.promise)
    await renderApp("/keys")
    await user.click(await screen.findByRole("button", { name: "Create a key" }))

    await user.type(await screen.findByLabelText("Symmetric-key name"), "全画面共通鍵")
    await user.click(screen.getByRole("button", { name: "Create a symmetric key" }))
    let dialog = await screen.findByRole("dialog", { name: "全画面共通鍵" })
    await user.click(within(dialog).getByRole("button", { name: "Show secret-key QR" }))
    dialog = await screen.findByRole("dialog", { name: "Symmetric-key QR" })
    await user.click(
      within(dialog).getByRole("checkbox", { name: "I understand the risk" }),
    )
    const symmetricFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(symmetricFullscreenTriggers).toHaveLength(1)
    expect(symmetricFullscreenTriggers[0]).toBeDisabled()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(symmetricFullscreenTriggers[0]).toBeDisabled()
    firstQrRender.resolve("data:image/png;base64,ZmFrZQ==")
    await waitFor(() => expect(symmetricFullscreenTriggers[0]).toBeEnabled())
    await user.click(symmetricFullscreenTriggers[0]!)
    let fullscreen = await screen.findByRole("dialog", {
      name: /View Symmetric-key QR full screen/,
    })
    expect(within(fullscreen).getByText("Sensitive information")).toBeInTheDocument()
    await user.click(within(fullscreen).getByRole("button", { name: "Close" }))
    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    // Closing the detail closes the whole modal, so creation restarts from the list.
    await user.click(await screen.findByRole("button", { name: "Create a key" }))
    await user.click(await screen.findByRole("combobox", { name: "Key type" }))
    await user.click(
      screen.getByRole("option", {
        name: "Post-quantum identity ML-KEM-1024 + ML-DSA-87",
      }),
    )
    await user.type(
      await screen.findByLabelText("Post-quantum identity name"),
      "全画面PQ ID",
    )
    await user.click(
      screen.getByRole("button", { name: "Create a post-quantum identity" }),
    )
    dialog = await screen.findByRole("dialog", { name: "全画面PQ ID" })

    for (const [buttonName, title] of [
      ["Public-key bundle QR", /public-key bundle/],
      ["Encryption public-key QR", /encryption public key/],
      ["Signature-verification public-key QR", /signature-verification public key/],
    ] as const) {
      await user.click(within(dialog).getByRole("button", { name: buttonName }))
      const fullscreenTriggers = within(dialog).getAllByRole("button", {
        name: "View full screen",
      })
      expect(fullscreenTriggers).toHaveLength(1)
      await waitFor(() => expect(fullscreenTriggers[0]).toBeEnabled())
      await user.click(fullscreenTriggers[0]!)
      fullscreen = await screen.findByRole("dialog", {
        name: new RegExp(`View .*${title.source}.* full screen`),
      })
      expect(within(fullscreen).getByRole("img")).toBeInTheDocument()
      await user.click(within(fullscreen).getByRole("button", { name: "Close" }))
      await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    }

    await user.click(within(dialog).getByRole("button", { name: "Public-key bundle QR" }))
    expect(
      within(dialog).getAllByRole("button", { name: "View full screen" }),
    ).toHaveLength(1)
    expect(
      await within(dialog).findByRole("region", {
        name: /public-key bundle frame display/,
      }),
    ).toBeInTheDocument()
  })

  it("blocks immediately on OCI2 fingerprint comparison and can save unverified", async () => {
    const user = userEvent.setup()
    const originalCount = fakeBundles.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
    await user.type(screen.getByLabelText("Key payload"), "OCI2:fake")
    await user.click(screen.getByRole("button", { name: "Read the key" }))

    const dialog = await screen.findByRole("dialog", {
      name: "Compare the fingerprint through another channel",
    })
    expect(within(dialog).getByText("9".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("7".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("8".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Verify and save" })).toBeDisabled()
    expect(
      within(dialog).queryByRole("button", { name: "Close" }),
    ).toBeNull()
    expect(dialog.querySelector("svg.lucide-x")).toBeNull()
    await user.keyboard("{Escape}")
    expect(
      screen.getByRole("dialog", {
        name: "Compare the fingerprint through another channel",
      }),
    ).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole("button", { name: "Save without verification" }),
    )
    await waitFor(() => expect(saveBundle).toHaveBeenCalledTimes(1))
    expect(confirmBundleFingerprint).not.toHaveBeenCalled()
    expect(fakeBundles).toHaveLength(originalCount + 1)
    expect(fakeBundles[0]?.trust).toBe("unverified")
  })

  it("confers fingerprint-confirmed trust only after the explicit checkbox", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
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
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
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
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
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

  it("imports a shared OCK2 frame through multipart completion with the source fingerprint", async () => {
    const user = userEvent.setup()
    const source = ock2SourceRecord()
    fakeKeys[0] = source
    await renderApp("/keys")

    await user.click(await screen.findByText(source.name))
    let dialog = await screen.findByRole("dialog", { name: source.name })
    await user.click(
      within(dialog).getByRole("button", { name: "Show secret-key QR" }),
    )
    dialog = await screen.findByRole("dialog", { name: "Symmetric-key QR" })
    await user.click(
      within(dialog).getByRole("checkbox", { name: "I understand the risk" }),
    )
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledOnce())
    const sharedArtifactBytes =
      splitIntoFrames.mock.calls[0]![0].artifactBytes.slice()
    expect(splitIntoFrames.mock.calls[0]![0]).toMatchObject({
      artifactType: "symmetric-key",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Back to details" }),
    )
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    fakeKeys.splice(0)
    await user.click(screen.getByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
    setNextMultipartArtifactBytes(sharedArtifactBytes)
    await user.click(screen.getByRole("button", { name: "Scan a key QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())
    await act(async () =>
      emitScannedPayload(
        multipartPayload("ock2-import", 0, 1, "symmetric-key"),
      ),
    )

    dialog = await screen.findByRole("dialog", { name: "Import a symmetric key" })
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I trust the channel used to share this key",
      }),
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save the symmetric key" }),
    )

    await waitFor(() => expect(fakeKeys).toHaveLength(1))
    expect(fakeKeys[0]?.fingerprint).toBe(source.fingerprint)
    expect(decodeSymmetricKeyEnvelopeV2).toHaveBeenCalledWith(sharedArtifactBytes)
    expect(importSymmetricKeyRecordV2).toHaveBeenCalledOnce()
    expect(saveKeyRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: source.fingerprint }),
    )
  })

  it("imports a pasted bare OCK2 payload with the source fingerprint", async () => {
    const user = userEvent.setup()
    const source = ock2SourceRecord()
    const { payload } = await prepareOck2Artifact(source)
    fakeKeys.splice(0)
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))

    fireEvent.change(screen.getByLabelText("Key payload"), {
      target: { value: payload },
    })
    await user.click(screen.getByRole("button", { name: "Read the key" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Import a symmetric key",
    })
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I trust the channel used to share this key",
      }),
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save the symmetric key" }),
    )

    await waitFor(() => expect(fakeKeys).toHaveLength(1))
    expect(payload).toMatch(/^OCK2:/)
    expect(fakeKeys[0]?.fingerprint).toBe(source.fingerprint)
    expect(importSymmetricKeyRecordV2).toHaveBeenCalledOnce()
    expect(saveKeyRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: source.fingerprint }),
    )
  })

  it("rejects a trailing-byte non-canonical OCK2 on paste and multipart without storing it", async () => {
    const user = userEvent.setup()
    const source = ock2SourceRecord()
    const { artifactBytes } = await prepareOck2Artifact(source)
    const nonCanonicalBytes = new Uint8Array(artifactBytes.byteLength + 1)
    nonCanonicalBytes.set(artifactBytes)
    const payload = buildV2Payload("symmetric-key", nonCanonicalBytes)
    fakeKeys.splice(0)
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))

    fireEvent.change(screen.getByLabelText("Key payload"), {
      target: { value: payload },
    })
    await user.click(screen.getByRole("button", { name: "Read the key" }))
    expect(await screen.findByText(en("errors.INVALID_QR_PAYLOAD"))).toBeInTheDocument()
    expect(fakeKeys).toHaveLength(0)
    expect(saveKeyRecord).not.toHaveBeenCalled()

    decodeSymmetricKeyEnvelopeV2.mockClear()
    setNextMultipartArtifactBytes(nonCanonicalBytes)
    await user.click(screen.getByRole("button", { name: "Scan a key QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())
    await act(async () =>
      emitScannedPayload(
        multipartPayload("ock2-invalid", 0, 1, "symmetric-key"),
      ),
    )

    const scanner = await screen.findByRole("dialog", {
      name: "Scan a key QR code",
    })
    expect(
      await within(scanner).findByText(en("errors.INVALID_QR_PAYLOAD")),
    ).toBeInTheDocument()
    expect(decodeSymmetricKeyEnvelopeV2).toHaveBeenCalledWith(nonCanonicalBytes)
    expect(importSymmetricKeyRecordV2).not.toHaveBeenCalled()
    expect(saveKeyRecord).not.toHaveBeenCalled()
    expect(fakeKeys).toHaveLength(0)
  })

  it("keeps single-frame OCK1 camera import behind a secret-key confirmation", async () => {
    const user = userEvent.setup()
    const originalCount = fakeKeys.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
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

  it("persists remaining numeric boundaries and shows wipe/reset warnings", async () => {
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
      screen.getByText(
        /JavaScript implementation does not guarantee resistance to side channels/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Physical erasure is not guaranteed/)).toBeInTheDocument()
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
    await user.type(within(dialog).getByLabelText("Confirmation text"), "DELETE ALL")
    await user.click(within(dialog).getByRole("button", { name: "Run logical deletion" }))
    const deleteError = "Data could not be deleted. Check the device storage."
    expect(await screen.findByText(deleteError)).toBeInTheDocument()

    fireEvent.change(transferTimeout, { target: { value: "40" } })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ transferTimeoutMinutes: 40 }),
    )
    expect(screen.getByText(deleteError)).toBeInTheDocument()
  })

  it("enforces the environment signature floor", async () => {
    env.requireSignature = true
    fakePreferences.requireSignature = true
    await renderApp("/settings")
    const signature = await screen.findByRole("switch", { name: "Require a signature" })
    expect(signature).toBeChecked()
    expect(signature).toBeDisabled()
    expect(
      screen.getByText(
        /cannot be disabled because it is required by the environment configuration/,
      ),
    ).toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByLabelText("Default cryptographic algorithm"))
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
    expectSingleAlertCancelWithoutClose(dialog)
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
