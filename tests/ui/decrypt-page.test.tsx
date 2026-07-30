import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppError, messageFor } from "@/crypto/errors"
import { formatDateTime } from "@/features/presentation"
import { translate } from "@/i18n/messages"
import type {
  MlKemMessageEnvelopeV2,
  PqPublicBundleRecord,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { deferred } from "../helpers/deferred"
import {
  deferNextMultipartAdd,
  decryptWithAesKey,
  decryptPqMessage,
  emitScannedPayload,
  encryptPq,
  fakeBundles,
  fakeIdentities,
  fakePqCreatedAt,
  fakePqDecrypt,
  fakePqMessageId,
  findBundleBySigningKeyId,
  findIdentityByKemKeyId,
  markIdentityUsed,
  markKeyUsed,
  multipartPayload,
  recordReceipt,
  startQrScan,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

const defaultQrMaxFrames = env.qrMaxFrames
const fakePqMessageIdHex = Array.from(fakePqMessageId, (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("")
let clearRealReceipts: (() => void) | undefined

async function preparePqPayload(
  signed: boolean,
): Promise<MlKemMessageEnvelopeV2> {
  const identity = fakeIdentities[0]!
  const storedBundle = fakeBundles[0]!
  const envelope = await encryptPq({
    recipient: {
      ...storedBundle,
      kem: {
        ...storedBundle.kem,
        keyId: identity.kem.keyId,
      },
    },
    plaintext: Uint8Array.of(1),
    sign: signed ? { identity } : undefined,
    now: fakePqCreatedAt,
  })
  fakePqDecrypt.kind = signed ? "signed-valid" : "unsigned"
  return envelope
}

describe("decrypt page v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    clearRealReceipts?.()
    clearRealReceipts = undefined
    env.qrMaxFrames = defaultQrMaxFrames
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetUi()
  })

  it("does not persist during scan decryption success", async () => {
    const user = userEvent.setup()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    expect(startQrScan).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Scan a ciphertext QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())
    await act(async () => emitScannedPayload("OCM1:sym-key-00000001"))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Scan a ciphertext QR code" }),
      ).not.toBeInTheDocument(),
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    expect(within(dialog).getByText("復号済み平文")).toBeInTheDocument()
    expect(
      within(dialog).getByText(/held only in memory and is not stored/),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByText(/Saved key QR|Save key QR/),
    ).not.toBeInTheDocument()
  })

  it("gates already-received plaintext behind a labelled replay alert", async () => {
    const user = userEvent.setup()
    const firstSeenAt = 1_724_000_000_000
    recordReceipt.mockReturnValueOnce({
      kind: "already-received",
      firstSeenAt,
    })
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    const dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    const replayTitle = translate("en", "encrypt.result.replay.title")
    const replayAlert = within(dialog).getByRole("alert", {
      name: replayTitle,
    })
    expect(replayAlert).toHaveTextContent(
      translate("en", "encrypt.result.replay.body", {
        time: formatDateTime(firstSeenAt, "en"),
      }),
    )
    expect(within(dialog).queryByText("復号済み平文")).not.toBeInTheDocument()

    await user.click(
      within(dialog).getByRole("button", {
        name: translate("en", "encrypt.result.replay.reveal"),
      }),
    )
    expect(within(dialog).getByText("復号済み平文")).toBeInTheDocument()
  })

  it("refuses a reused message id from a signed PQ payload without opening a result dialog", async () => {
    const user = userEvent.setup()
    await preparePqPayload(true)
    recordReceipt.mockReturnValueOnce({
      kind: "message-id-reused",
      firstSeenAt: 1_724_000_000_000,
    })
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:signed-reused-id" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    await waitFor(() => expect(recordReceipt).toHaveBeenCalledOnce())
    expect(decryptPqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
        }),
      }),
    )
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument()
    })
    const reusedMessage = messageFor(
      "MESSAGE_ID_REUSED" as Parameters<typeof messageFor>[0],
      "en",
    )
    expect(await screen.findByText(reusedMessage)).toBeInTheDocument()
  })

  it("zeroizes the exact PQ plaintext buffer after a reused message-id refusal", async () => {
    const user = userEvent.setup()
    const plaintext = Uint8Array.of(91, 17, 203, 44, 5, 188)
    await preparePqPayload(true)
    decryptPqMessage.mockImplementationOnce(async ({ resolveSigningKey }) => {
      const senderSigningKeyId = fakeBundles[0]!.signing.keyId
      await resolveSigningKey(senderSigningKeyId)
      return {
        kind: "signed-valid",
        plaintext,
        messageId: fakePqMessageId.slice(),
        createdAt: fakePqCreatedAt,
        senderSigningKeyId,
      }
    })
    recordReceipt.mockReturnValueOnce({
      kind: "message-id-reused",
      firstSeenAt: 1_724_000_000_000,
    })
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:zeroize-reused-id" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    expect(
      await screen.findByText(messageFor("MESSAGE_ID_REUSED", "en")),
    ).toBeInTheDocument()
    expect(plaintext).toEqual(new Uint8Array(plaintext.byteLength))
  })

  it("uses the real receipt cache to gate a second decryption of the same payload", async () => {
    const user = userEvent.setup()
    const actualReceiptCache =
      await vi.importActual<typeof import("@/features/receipt-cache")>(
        "@/features/receipt-cache",
      )
    actualReceiptCache.clearReceipts()
    clearRealReceipts = actualReceiptCache.clearReceipts
    recordReceipt.mockImplementation(actualReceiptCache.recordReceipt)
    await preparePqPayload(true)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:real-receipt-cache" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    let dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    expect(within(dialog).getByText("署名済みPQ復号結果")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument(),
    )

    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    expect(
      within(dialog).getByRole("alert", {
        name: translate("en", "encrypt.result.replay.title"),
      }),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByText("署名済みPQ復号結果"),
    ).not.toBeInTheDocument()
    expect(recordReceipt).toHaveBeenCalledTimes(2)
  })

  it("shows sender-reported time without a replay alert for first-seen PQ plaintext", async () => {
    const user = userEvent.setup()
    await preparePqPayload(true)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:first-seen" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    await waitFor(() => expect(recordReceipt).toHaveBeenCalledOnce())
    const dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    expect(
      within(dialog).queryByRole("alert", {
        name: translate("en", "encrypt.result.replay.title"),
      }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).getByText(
        translate("en", "encrypt.result.senderCreatedAt", {
          time: formatDateTime(fakePqCreatedAt, "en"),
        }),
      ),
    ).toBeInTheDocument()
  })

  it("does not record a receipt when decryption throws or the signing key is unknown", async () => {
    const user = userEvent.setup()
    decryptWithAesKey.mockRejectedValueOnce(new AppError("DECRYPTION_FAILED"))
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    expect(
      await screen.findByText(messageFor("DECRYPTION_FAILED", "en")),
    ).toBeInTheDocument()
    expect(recordReceipt).not.toHaveBeenCalled()

    await preparePqPayload(true)
    fakePqDecrypt.kind = "signed-key-unknown"
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:unknown-signer" },
    })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    expect(await screen.findByText("SIGNING_KEY_NOT_FOUND")).toBeInTheDocument()
    expect(recordReceipt).not.toHaveBeenCalled()
  })

  it("records exact AES, signed PQ, and unsigned PQ receipt subjects", async () => {
    const user = userEvent.setup()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    const input = screen.getByLabelText("Ciphertext payload")
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })

    fireEvent.change(input, {
      target: { value: "OCM1:sym-key-00000001" },
    })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    let dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument(),
    )

    await preparePqPayload(true)
    fireEvent.change(input, {
      target: { value: "OCM2:signed" },
    })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument(),
    )

    await preparePqPayload(false)
    fireEvent.change(input, {
      target: { value: "OCM2:unsigned" },
    })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    await screen.findByRole("dialog", {
      name: "Decryption complete",
    })

    expect(recordReceipt.mock.calls).toEqual([
      [
        {
          kind: "aes",
          recipientKeyId: "sym-key-00000001",
          envelopeHash: "0000000000000000000000000000000000000000000000000000000000000015",
        },
        expect.any(Number),
      ],
      [
        {
          kind: "pq-signed",
          senderFingerprint: fakeBundles[0]!.signing.fingerprint,
          recipientKemKeyId: fakeIdentities[0]!.kem.keyId,
          messageIdHex: fakePqMessageIdHex,
          envelopeHash: "0000000000000000000000000000000000000000000000000000000000001b17",
        },
        expect.any(Number),
      ],
      [
        {
          kind: "pq-unsigned",
          recipientKemKeyId: fakeIdentities[0]!.kem.keyId,
          messageIdHex: fakePqMessageIdHex,
          envelopeHash: "0000000000000000000000000000000000000000000000000000000000000987",
        },
        expect.any(Number),
      ],
    ])
    expect(
      new Set(recordReceipt.mock.calls.map(([subject]) => subject.envelopeHash)).size,
    ).toBe(3)
  })

  it("distinguishes signature validity from person trust and hides unknown-signer plaintext", async () => {
    const user = userEvent.setup()
    const unverifiedSender: PqPublicBundleRecord = {
      ...fakeBundles[0]!,
      trust: "unverified",
    }
    delete unverifiedSender.trustConfirmedAt
    fakeBundles.splice(0, fakeBundles.length, unverifiedSender)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    await waitFor(() => expect(decryptPqMessage).toHaveBeenCalledOnce())
    expect(
      await screen.findByText("The signature is valid for this key"),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        (_content, element) =>
          element?.textContent ===
          `${translate("en", "encrypt.result.identityCheck.label")} ${translate(
            "en",
            "encrypt.result.identityCheck.unverified",
          )}`,
      ),
    ).toBeInTheDocument()
    const identityWarningTitle = translate(
      "en",
      "encrypt.result.identityUnconfirmed.title",
    )
    expect(
      screen.getByText(identityWarningTitle, { exact: true }),
    ).toBeInTheDocument()
    const warning = screen.getByRole("alert", {
      name: identityWarningTitle,
    })
    expect(
      within(warning).getByText(
        translate("en", "encrypt.result.identityUnconfirmed.body"),
        { exact: true },
      ),
    ).toBeInTheDocument()

    const dialog = screen.getByRole("dialog", { name: "Decryption complete" })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument()
    })
    fakePqDecrypt.kind = "signed-key-unknown"
    await user.click(screen.getByRole("button", { name: "Decrypt" }))
    expect(await screen.findByText("SIGNING_KEY_NOT_FOUND")).toBeInTheDocument()
    expect(screen.queryByText("署名済みPQ復号結果")).not.toBeInTheDocument()
  })

  it("keeps a revoked signer unknown to the resolver without exposing plaintext", async () => {
    const user = userEvent.setup()
    const revokedSender: PqPublicBundleRecord = {
      ...fakeBundles[0]!,
      revokedAt: 1_724_000_000_000,
    }
    fakeBundles.splice(0, fakeBundles.length, revokedSender)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:revoked-signer" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    expect(
      await screen.findByText("SIGNING_KEY_NOT_FOUND"),
    ).toBeInTheDocument()
    expect(findBundleBySigningKeyId).toHaveBeenCalledWith(
      revokedSender.signing.keyId,
    )
    expect(decryptPqMessage).toHaveBeenCalledOnce()
    expect(recordReceipt).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("dialog", { name: "Decryption complete" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("署名済みPQ復号結果")).not.toBeInTheDocument()
  })

  it("resolves the signing key from storage, not from the cached list", async () => {
    const user = userEvent.setup()
    const confirmed = fakeBundles[0]!
    const staleShadow: PqPublicBundleRecord = {
      ...confirmed,
      recordId: "S".repeat(22),
      trust: "unverified",
      importedAt: confirmed.importedAt + 60_000,
    }
    delete staleShadow.trustConfirmedAt
    fakeBundles.splice(0, fakeBundles.length, staleShadow, confirmed)
    findBundleBySigningKeyId.mockResolvedValue(confirmed)

    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    await waitFor(() => expect(decryptPqMessage).toHaveBeenCalledOnce())

    expect(findBundleBySigningKeyId).toHaveBeenCalledWith(confirmed.signing.keyId)
    expect(
      screen.getByText(translate("en", "encrypt.result.identityCheck.confirmed"), {
        exact: false,
      }),
    ).toBeInTheDocument()
  })

  it("labels unsigned plaintext and suppresses it after a signature failure", async () => {
    const user = userEvent.setup()
    fakePqDecrypt.kind = "unsigned"
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    expect(await screen.findByText("Unsigned")).toBeInTheDocument()
    expect(screen.getByText("PQ復号済み平文")).toBeInTheDocument()

    const dialog = screen.getByRole("dialog", { name: "Decryption complete" })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument()
    })
    decryptPqMessage.mockRejectedValueOnce(new AppError("SIGNATURE_INVALID"))
    await user.click(decryptButton)
    expect(
      await screen.findByText(messageFor("SIGNATURE_INVALID", "en")),
    ).toBeInTheDocument()
    expect(screen.queryByText("PQ復号済み平文")).not.toBeInTheDocument()
  })

  it("re-resolves the recipient from storage and refuses a discarded generation", async () => {
    const user = userEvent.setup()
    const cachedIdentity = fakeIdentities[0]!
    findIdentityByKemKeyId.mockResolvedValueOnce(undefined)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())

    await user.click(decryptButton)

    expect(
      await screen.findByText(messageFor("KEY_NOT_FOUND", "en")),
    ).toBeInTheDocument()
    expect(findIdentityByKemKeyId).toHaveBeenCalledWith(cachedIdentity.kem.keyId)
    expect(decryptPqMessage).not.toHaveBeenCalled()
  })

  it("refuses a storage-resolved recipient from a non-active suite", async () => {
    const user = userEvent.setup()
    const cachedIdentity = fakeIdentities[0]!
    findIdentityByKemKeyId.mockResolvedValueOnce({
      ...cachedIdentity,
      profile: "balanced",
      kem: { ...cachedIdentity.kem, algorithm: "ML-KEM-768" },
      signing: { ...cachedIdentity.signing, algorithm: "ML-DSA-65" },
    })
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())

    await user.click(decryptButton)

    expect(
      await screen.findByText(messageFor("KEY_NOT_FOUND", "en")),
    ).toBeInTheDocument()
    expect(findIdentityByKemKeyId).toHaveBeenCalledWith(cachedIdentity.kem.keyId)
    expect(decryptPqMessage).not.toHaveBeenCalled()
  })

  it("decrypts with and marks the freshly resolved recipient", async () => {
    const user = userEvent.setup()
    const cachedIdentity = fakeIdentities[0]!
    const freshIdentity = {
      ...cachedIdentity,
      id: "F".repeat(22),
      name: "resolved-from-storage",
    }
    findIdentityByKemKeyId.mockResolvedValueOnce(freshIdentity)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())

    await user.click(decryptButton)

    await waitFor(() =>
      expect(decryptPqMessage).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: freshIdentity }),
      ),
    )
    expect(findIdentityByKemKeyId).toHaveBeenCalledWith(cachedIdentity.kem.keyId)
    expect(markIdentityUsed).toHaveBeenCalledWith(
      freshIdentity.id,
      expect.any(Number),
    )
  })

  it("opens the result modal when a multipart transfer completes", async () => {
    const user = userEvent.setup()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    await user.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())

    await act(async () =>
      emitScannedPayload(
        multipartPayload("decrypt-transfer", 0, 1, "pq-message"),
      ),
    )

    expect(
      await screen.findByRole("dialog", { name: "Decryption complete" }),
    ).toBeInTheDocument()
  })

  it("R1 consumes a multipart completion delivered after the scanner closes", async () => {
    const user = userEvent.setup()
    const finalAdd = deferred<void>()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    const scannerTrigger = screen.getByRole("button", {
      name: "Scan a ciphertext QR code",
    })
    await user.click(scannerTrigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () => {
      emitScannedPayload(multipartPayload("post-close-decrypt", 0, 2, "pq-message"))
    })
    deferNextMultipartAdd(finalAdd.promise)
    act(() => {
      emitScannedPayload(multipartPayload("post-close-decrypt", 1, 2, "pq-message"))
    })
    await user.click(
      within(
        screen.getByRole("dialog", {
          name: "Scan a ciphertext QR code",
        }),
      ).getByRole("button", { name: "Close" }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Scan a ciphertext QR code",
        }),
      ).not.toBeInTheDocument(),
    )

    await act(async () => {
      finalAdd.resolve()
      await finalAdd.promise
    })

    expect(
      await screen.findByText(
        "All multi-frame QR frames passed SHA-256 integrity checking and were imported.",
        {},
        { timeout: 2_500 },
      ),
    ).toBeInTheDocument()
    const postCloseResult = await screen
      .findByRole(
        "dialog",
        { name: "Decryption complete" },
        { timeout: 2_500 },
      )
      .catch(() => null)
    if (postCloseResult !== null) {
      await user.click(
        within(postCloseResult).getByRole("button", { name: "Close" }),
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Decryption complete" }),
        ).not.toBeInTheDocument(),
      )
    }

    const postCloseResultOpened = postCloseResult !== null
    decryptPqMessage.mockClear()
    await user.click(scannerTrigger)
    const reopenedScanner = await screen.findByRole("dialog", {
      name: "Scan a ciphertext QR code",
    })
    await user.click(
      within(reopenedScanner).getByRole("button", { name: "Close" }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Scan a ciphertext QR code",
        }),
      ).not.toBeInTheDocument(),
    )

    const unrelatedCloseResult = await screen
      .findByRole(
        "dialog",
        { name: "Decryption complete" },
        { timeout: 1_000 },
      )
      .catch(() => null)
    expect({
      postCloseResultOpened,
      decryptCallsAfterUnrelatedClose: decryptPqMessage.mock.calls.length,
      resultOpenedAfterUnrelatedClose: unrelatedCloseResult !== null,
    }).toEqual({
      postCloseResultOpened: true,
      decryptCallsAfterUnrelatedClose: 0,
      resultOpenedAfterUnrelatedClose: false,
    })
  }, 10_000)

  it("shows the invalid-payload alert and no modal for unparseable input", async () => {
    const user = userEvent.setup()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    await user.type(screen.getByLabelText("Ciphertext payload"), "not-a-payload")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      translate("en", "encrypt.decrypt.invalidTitle"),
    )
    expect(
      screen.queryByRole("dialog", { name: "Decryption complete" }),
    ).not.toBeInTheDocument()
  })

  it("shows key-not-found and no modal when a scanned payload has no stored key", async () => {
    const user = userEvent.setup()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    await user.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())

    await act(async () => emitScannedPayload("OCM1:sym-key-99999999"))

    expect(await screen.findByText("KEY_NOT_FOUND")).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "Decryption complete" }),
    ).not.toBeInTheDocument()
  })

  it("discards the decrypted plaintext when the modal closes", async () => {
    const user = userEvent.setup()
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    const dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Decryption complete" }),
      ).not.toBeInTheDocument()
    })
    expect(screen.queryByText("復号済み平文")).not.toBeInTheDocument()
  })

  it("F2 never stacks scanner and decryption result dialogs while marking key use", async () => {
    const user = userEvent.setup()
    const pendingMark = deferred<void>()
    markKeyUsed.mockReturnValueOnce(pendingMark.promise)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    await user.click(screen.getByRole("button", { name: "Scan a ciphertext QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())

    let maximumDialogCount = document.querySelectorAll('[role="dialog"]').length
    const dialogObserver = new MutationObserver(() => {
      maximumDialogCount = Math.max(
        maximumDialogCount,
        document.querySelectorAll('[role="dialog"]').length,
      )
    })
    dialogObserver.observe(document.body, { childList: true, subtree: true })

    await act(async () => {
      emitScannedPayload("OCM1:sym-key-00000001")
    })
    await waitFor(() => expect(markKeyUsed).toHaveBeenCalledOnce())
    await act(async () => {
      await Promise.resolve()
    })
    maximumDialogCount = Math.max(
      maximumDialogCount,
      document.querySelectorAll('[role="dialog"]').length,
    )
    const resultAppearedBeforeMarkSettled =
      screen.queryByRole("dialog", { name: "Decryption complete" }) !== null

    await act(async () => {
      pendingMark.resolve()
      await pendingMark.promise
    })
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Scan a ciphertext QR code" }),
      ).not.toBeInTheDocument(),
    )
    const result = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    dialogObserver.disconnect()

    expect(within(result).getByText("復号済み平文")).toBeInTheDocument()
    expect({
      maximumDialogCount,
      resultAppearedBeforeMarkSettled,
    }).toEqual({
      maximumDialogCount: 1,
      resultAppearedBeforeMarkSettled: false,
    })
  })

  it("F1 keeps the scanner and the decrypt button closed while crypto is in flight", async () => {
    const user = userEvent.setup()
    const defaultDecryptWithAesKey = decryptWithAesKey.getMockImplementation()!
    const pendingDecryption =
      deferred<Awaited<ReturnType<typeof defaultDecryptWithAesKey>>>()
    decryptWithAesKey.mockReturnValueOnce(pendingDecryption.promise)
    await renderApp("/decrypt")
    await screen.findByRole("heading", { name: "Scan with the camera" })
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    await waitFor(() => expect(decryptWithAesKey).toHaveBeenCalledOnce())

    const busyState = {
      scannerDisabled: screen
        .getByRole("button", { name: "Scan a ciphertext QR code" })
        .hasAttribute("disabled"),
      payloadDisabled: screen
        .getByLabelText("Ciphertext payload")
        .hasAttribute("disabled"),
      decryptDisabled: screen
        .getByRole("button", { name: "Decrypting…" })
        .hasAttribute("disabled"),
    }

    const decryptedBytes = await defaultDecryptWithAesKey()
    await act(async () => {
      pendingDecryption.resolve(decryptedBytes)
      await pendingDecryption.promise
    })
    await screen.findByRole("dialog", { name: "Decryption complete" })
    expect(decryptWithAesKey).toHaveBeenCalledOnce()

    expect(busyState).toEqual({
      scannerDisabled: true,
      payloadDisabled: true,
      decryptDisabled: true,
    })
  })
})
