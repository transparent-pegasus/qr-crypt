import "./helpers/module-mocks/feature-detection"
import "./helpers/module-mocks/pwa"
import "./helpers/module-mocks/preferences"
import "./helpers/module-mocks/crypto-runtime"
import "./helpers/module-mocks/symmetric-crypto"
import "./helpers/module-mocks/pq-crypto"
import "./helpers/module-mocks/qr-codec"
import "./helpers/module-mocks/qr-scanner"
import "./helpers/module-mocks/key-records"
import "./helpers/module-mocks/pq-records"
import "./helpers/module-mocks/browser-effects"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetDefaultBootControllerForTesting } from "@/app/boot/boot-controller"
import { formatFingerprint } from "@/features/presentation"
import { translate } from "@/i18n/messages"
import { buildV2Payload } from "@/qr/wire-codec"
import type {
  PublicIdentityBundleV2,
  StoredKeyRecord,
} from "@/schemas/domain"
import { deferred } from "../helpers/deferred"
import {
  buildSymmetricKeyEnvelopeV2,
  createSymmetricKeyRecord,
  importSymmetricKeyRecordV2,
} from "./helpers/fakes/symmetric-crypto"
import {
  buildPublicBundle,
  createIdentity,
} from "./helpers/fakes/pq-crypto"
import {
  decodePayload,
  decodeSymmetricKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
  encodeSymmetricKeyEnvelopeV2,
  multipartPayload,
  renderQrDataUrl,
  setNextMultipartArtifactBytes,
  splitIntoFrames,
} from "./helpers/fakes/qr-codec"
import {
  emitScannedPayload,
  startQrScan,
} from "./helpers/fakes/qr-scanner"
import {
  fakeKeys,
  saveKeyRecord,
} from "./helpers/fakes/key-records"
import {
  confirmBundleFingerprint,
  fakeBundles,
  fakeIdentities,
  saveBundle,
} from "./helpers/fakes/pq-records"
import { renderApp, resetUi } from "./helpers/render-app"

function en(key: Parameters<typeof translate>[1]): string {
  return translate("en", key)
}

const unit = (n: number) => "n".repeat(n)

function pasteBundleWithName(name: string): void {
  decodePayload.mockReturnValueOnce({
    kind: "pq-public-identity" as const,
    envelope: buildPublicBundle({ ...fakeIdentities[0]!, name }),
  })
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

describe("keys page", () => {
  beforeEach(resetUi)
  afterEach(() => {
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
    expect(await screen.findByLabelText("Shared-key name")).toBeInTheDocument()
    expect(
      screen.queryByText("experimental · not independently audited"),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create a shared key" })).toBeDisabled()
    await user.type(screen.getByLabelText("Shared-key name"), "新しい共通鍵")
    await user.click(screen.getByRole("button", { name: "Create a shared key" }))
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
        name: "Public key ML-KEM-1024 + ML-DSA-87",
      }),
    )
    expect(
      await screen.findByText("experimental · not independently audited"),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText("Public-key name"), "新しいPQ ID")
    await user.click(
      screen.getByRole("button", { name: "Create a public key" }),
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

    await user.type(await screen.findByLabelText("Shared-key name"), "全画面共通鍵")
    await user.click(screen.getByRole("button", { name: "Create a shared key" }))
    let dialog = await screen.findByRole("dialog", { name: "全画面共通鍵" })
    await user.click(within(dialog).getByRole("button", { name: "Show secret-key QR" }))
    dialog = await screen.findByRole("dialog", { name: "Shared-key QR" })
    expect(within(dialog).queryByRole("alert")).toBeNull()
    expect(within(dialog).queryByRole("checkbox")).toBeNull()
    expect(within(dialog).queryByText("Sensitive information")).toBeNull()
    const copy = within(dialog).getByRole("button", { name: "Copy" })
    const download = within(dialog).getByRole("button", { name: "Download" })
    expect(copy).toBeEnabled()
    expect(download).toBeEnabled()
    expect(copy.parentElement).toBe(download.parentElement)
    expect(copy.nextElementSibling).toBe(download)
    const symmetricFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(symmetricFullscreenTriggers).toHaveLength(1)
    expect(symmetricFullscreenTriggers[0]).toBeDisabled()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(symmetricFullscreenTriggers[0]).toBeDisabled()
    firstQrRender.resolve("data:image/png;base64,ZmFrZQ==")
    await waitFor(() => expect(symmetricFullscreenTriggers[0]).toBeEnabled())
    expect(
      within(dialog).getByRole("img", { name: /Shared-key QR/ }),
    ).toBeInTheDocument()
    await user.click(symmetricFullscreenTriggers[0]!)
    let fullscreen = await screen.findByRole("dialog", {
      name: /View Shared-key QR full screen/,
    })
    const fullscreenButtons = within(fullscreen).getAllByRole("button")
    expect(fullscreenButtons).toHaveLength(1)
    expect(fullscreenButtons[0]).toHaveAccessibleName("Close")
    expect(fullscreenButtons[0]).toHaveClass("border-slate-300")
    await user.click(fullscreenButtons[0]!)
    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    // Closing the detail closes the whole modal, so creation restarts from the list.
    await user.click(await screen.findByRole("button", { name: "Create a key" }))
    await user.click(await screen.findByRole("combobox", { name: "Key type" }))
    await user.click(
      screen.getByRole("option", {
        name: "Public key ML-KEM-1024 + ML-DSA-87",
      }),
    )
    await user.type(
      await screen.findByLabelText("Public-key name"),
      "全画面PQ ID",
    )
    await user.click(
      screen.getByRole("button", { name: "Create a public key" }),
    )
    dialog = await screen.findByRole("dialog", { name: "全画面PQ ID" })

    await user.click(within(dialog).getByRole("button", { name: "Show public-key QR" }))
    expect(
      within(dialog).getByText(
        "This QR code contains the public keys used for encryption and signature verification.",
      ),
    ).toBeInTheDocument()
    const identityFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(identityFullscreenTriggers).toHaveLength(1)
    await waitFor(() => expect(identityFullscreenTriggers[0]).toBeEnabled())
    await user.click(identityFullscreenTriggers[0]!)
    fullscreen = await screen.findByRole("dialog", {
      name: /View .*public key.* full screen/,
    })
    expect(within(fullscreen).getByRole("img")).toBeInTheDocument()
    await user.click(within(fullscreen).getByRole("button", { name: "Close" }))
    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))

    await user.click(within(dialog).getByRole("button", { name: "Show public-key QR" }))
    expect(
      within(dialog).getAllByRole("button", { name: "View full screen" }),
    ).toHaveLength(1)
    expect(
      await within(dialog).findByRole("region", {
        name: /public key frame display/,
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

  it.each([
    { name: unit(80), expectStored: unit(80) },
    { name: unit(81), expectStored: undefined },
    { name: unit(100), expectStored: undefined },
    { name: "  padded  ", expectStored: "padded" },
    { name: "   ", expectStored: undefined },
    { name: "a\u0007b", expectStored: undefined },
  ])(
    "bundle import normalizes the wire name (case %#)",
    async ({ name, expectStored }) => {
      pasteBundleWithName(name)
      const user = userEvent.setup()
      await renderApp("/keys")
      await user.click(
        await screen.findByRole("tab", { name: "Other parties' keys" }),
      )
      await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
      await user.type(screen.getByLabelText("Key payload"), "OCI2:fake")
      await user.click(screen.getByRole("button", { name: "Read the key" }))

      const dialog = await screen.findByRole("dialog", {
        name: "Compare the fingerprint through another channel",
      })
      await user.click(
        within(dialog).getByRole("button", {
          name: "Save without verification",
        }),
      )

      await waitFor(() => expect(saveBundle).toHaveBeenCalledTimes(1))
      const saved = saveBundle.mock.calls[0]![0]
      if (expectStored === undefined) expect(saved.name).toBeUndefined()
      else expect(saved.name).toBe(expectStored)
    },
  )

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
    const legacyBundle = {
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
    } as unknown as PublicIdentityBundleV2
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

  it("rejects retired OCP2 and OCS2 single-key prefixes on paste", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
    const input = screen.getByLabelText("Key payload")

    for (const retired of ["OCP2:retired", "OCS2:retired"]) {
      await user.clear(input)
      await user.type(input, retired)
      await user.click(screen.getByRole("button", { name: "Read the key" }))
      expect(
        await screen.findByText("This QR code is not in this app's format."),
      ).toBeInTheDocument()
      expect(saveBundle).not.toHaveBeenCalled()
    }
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
    dialog = await screen.findByRole("dialog", { name: "Shared-key QR" })
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

    dialog = await screen.findByRole("dialog", { name: "Import a shared key" })
    expect(within(dialog).getByText(source.fingerprint)).toBeInTheDocument()
    expect(
      within(dialog).getByText(formatFingerprint(source.fingerprint), {
        exact: false,
      }),
    ).toBeInTheDocument()
    const save = within(dialog).getByRole("button", {
      name: "Save the shared key",
    })
    expect(save).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /fingerprint matches/i,
      }),
    )
    expect(save).toBeEnabled()
    await user.click(save)

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
      name: "Import a shared key",
    })
    expect(within(dialog).getByText(source.fingerprint)).toBeInTheDocument()
    expect(
      within(dialog).getByText(formatFingerprint(source.fingerprint), {
        exact: false,
      }),
    ).toBeInTheDocument()
    const save = within(dialog).getByRole("button", {
      name: "Save the shared key",
    })
    expect(save).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /fingerprint matches/i,
      }),
    )
    expect(save).toBeEnabled()
    await user.click(save)

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

  it("rejects a retired OCK1 payload at the multipart camera boundary", async () => {
    const user = userEvent.setup()
    const originalCount = fakeKeys.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))
    expect(startQrScan).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Scan a key QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () => emitScannedPayload("OCK1:imported-key-000001"))

    expect(
      await screen.findByText(
        "This QR code is not accepted (Not from this app). This screen can scan multi-frame QR.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "Import a shared key" }),
    ).not.toBeInTheDocument()
    expect(importSymmetricKeyRecordV2).not.toHaveBeenCalled()
    expect(fakeKeys).toHaveLength(originalCount)
  })
})
