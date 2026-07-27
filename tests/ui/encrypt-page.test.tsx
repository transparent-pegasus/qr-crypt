import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppError, messageFor } from "@/crypto/errors"
import {
  FRAME_BYTES_MAX,
  maximumSymmetricPlaintextBytesForPayloadCapacity,
} from "@/lib/limits"
import { translate } from "@/i18n/messages"
import type {
  MlKemMessageEnvelopeV2,
  PqPublicBundleRecord,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  deferNextMultipartAdd,
  emitScannedPayload,
  decryptWithAesKey,
  encryptWithAesKey,
  encryptPq,
  decryptPqMessage,
  exportQrFramePayloads,
  fakeBundles,
  fakeIdentities,
  fakePqDecrypt,
  fakePreferences,
  findIdentityByKemKeyId,
  markIdentityUsed,
  markKeyUsed,
  multipartPayload,
  renderQrDataUrl,
  splitIntoFrames,
  startQrScan,
  updatePreferences,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

const defaultQrMaxFrames = env.qrMaxFrames

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string | RegExp,
) {
  await user.click(await screen.findByLabelText(label))
  await user.click(await screen.findByRole("option", { name: option }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("encrypt page v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.qrMaxFrames = defaultQrMaxFrames
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetUi()
  })

  it("offers the three active suites and never exposes RSA", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByLabelText("Cryptographic algorithm"))
    expect(
      await screen.findByRole("option", { name: /Symmetric-key.*AES-256-GCM/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", {
        name: /^Post-quantum ML-KEM-1024 \+ AES-256-GCM$/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: /Signed post-quantum/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/RSA/)).not.toBeInTheDocument()
  })

  it("offers only fingerprint-confirmed bundles as encryption recipients", async () => {
    const user = userEvent.setup()
    const confirmedBundle: PqPublicBundleRecord = {
      ...fakeBundles[0]!,
    }
    delete confirmedBundle.name
    const unverifiedBundle: PqPublicBundleRecord = {
      ...fakeBundles[0]!,
      recordId: "U".repeat(22),
      identityId: "V".repeat(22),
      name: "Unverified display name",
      kem: {
        ...fakeBundles[0]!.kem,
        keyId: "W".repeat(22),
        fingerprint: "7".repeat(64),
      },
      signing: {
        ...fakeBundles[0]!.signing,
        keyId: "X".repeat(22),
        fingerprint: "8".repeat(64),
      },
      identityFingerprint: "9".repeat(64),
      trust: "unverified",
    }
    delete unverifiedBundle.trustConfirmedAt
    fakeBundles.splice(0, fakeBundles.length, confirmedBundle, unverifiedBundle)

    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await user.click(await screen.findByLabelText("Recipient ML-KEM public key"))
    const labels = (await screen.findAllByRole("option")).map(
      (option) => option.textContent ?? "",
    )

    expect(
      labels.some((label) => label.includes(confirmedBundle.kem.keyId)),
    ).toBe(true)
    expect(
      labels.some((label) => label.includes(unverifiedBundle.kem.keyId)),
    ).toBe(false)
  })

  it("explains why no recipient is selectable when every bundle is unverified", async () => {
    const user = userEvent.setup()
    const unverifiedBundle: PqPublicBundleRecord = {
      ...fakeBundles[0]!,
      trust: "unverified",
    }
    delete unverifiedBundle.trustConfirmedAt
    fakeBundles.splice(0, fakeBundles.length, unverifiedBundle)

    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )

    expect(
      await screen.findByText(
        translate("en", "encrypt.recipient.needsConfirmation"),
      ),
    ).toBeInTheDocument()
  })

  it("shows pending state, produces controllable OCF2 frames, and has no persistence UI", async () => {
    const user = userEvent.setup()
    let resolveEncryption: ((value: MlKemMessageEnvelopeV2) => void) | undefined
    encryptPq.mockImplementationOnce(
      () =>
        new Promise<MlKemMessageEnvelopeV2>((resolve) => {
          resolveEncryption = resolve
        }),
    )
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Cryptographic algorithm", /Signed post-quantum/)
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await chooseSelectOption(user, "My ML-DSA signing identity", "自分のPQ ID")
    await user.type(screen.getByLabelText("Plaintext"), "署名付き短文")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    expect(screen.getByRole("button", { name: "Encrypting…" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Encrypting…" }).closest("section"),
    ).toHaveAttribute("aria-busy", "true")

    await act(async () => {
      resolveEncryption?.({
        version: 2,
        type: "pq-message",
        suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
        recipientKemKeyId: fakeBundles[0]!.kem.keyId,
        kemCiphertext: new Uint8Array(1568),
        hkdfSalt: new Uint8Array(32),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(3_600),
      })
    })

    const result = await screen.findByRole("dialog", { name: "Encryption complete" })
    expect(within(result).getByText("Encryption complete")).toBeInTheDocument()
    expect(within(result).getByLabelText("Output name")).toBeInTheDocument()
    for (const label of [
      "Cryptographic suite",
      "Recipient key ID",
      "Sender signing key ID",
      "Total data size",
      "QR frame count",
      "Encrypted at",
      "Signature",
      "Post-quantum profile",
      "Whole-message SHA-256",
    ]) {
      expect(within(result).getByText(label)).toBeInTheDocument()
    }
    expect(within(result).getByText("maximum")).toBeInTheDocument()
    expect(within(result).getByRole("button", { name: "Pause" })).toBeInTheDocument()
    expect(within(result).getByRole("button", { name: "Next" })).toBeInTheDocument()
    expect(within(result).getAllByRole("button", { name: "Download" })).toHaveLength(1)
    expect(within(result).queryByRole("button", { name: /SVG/i })).toBeNull()
    expect(
      within(result).getByRole("button", { name: "View full screen" }),
    ).toBeInTheDocument()
    await user.click(within(result).getByRole("button", { name: "Next" }))
    expect(within(result).getByText(/^2 \/ /)).toBeInTheDocument()
    await user.click(within(result).getByRole("button", { name: "Pause" }))
    expect(within(result).getByRole("button", { name: "Play" })).toBeInTheDocument()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(renderQrDataUrl.mock.calls.at(-1)?.[0]).toMatch(/^OCF2:/)
    const fullscreen = within(result).getByRole("button", { name: "View full screen" })
    await waitFor(() => expect(fullscreen).toBeEnabled())
    await user.click(fullscreen)
    const fullscreenDialog = screen.getByRole("dialog", {
      name: /View Ciphertext 2 \/ .* full screen/,
    })
    expect(fullscreenDialog).toBeInTheDocument()
    expect(within(fullscreenDialog).getByRole("img")).toBeInTheDocument()
    expect(
      within(fullscreenDialog).getAllByRole("button", { name: "Close" }),
    ).toHaveLength(1)
    await user.click(within(fullscreenDialog).getByRole("button", { name: "Close" }))

    expect(within(result).queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    expect(
      within(result).queryByText(/Saved|Duplicate|Save key QR/),
    ).not.toBeInTheDocument()
  })

  it("discards the PQ result when the modal closes and re-encrypts with a fresh transfer ID", async () => {
    const user = userEvent.setup()
    const defaultSplitIntoFrames = splitIntoFrames.getMockImplementation()!
    splitIntoFrames.mockImplementationOnce(async (args) => {
      const frames = await defaultSplitIntoFrames(args)
      return frames.map((frame) => ({
        ...frame,
        transferId: new Uint8Array(16).fill(7),
      }))
    })

    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "stable transfer")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const result = await screen.findByRole("dialog", { name: "Encryption complete" })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    await user.click(within(result).getByRole("button", { name: "Pause" }))
    const initialPayload = renderQrDataUrl.mock.calls.at(-1)?.[0]
    expect(initialPayload).toMatch(/^OCF2:/)
    const initialTransferId = initialPayload!.split(":")[1]
    const renderCallsBeforeTabSwitch = renderQrDataUrl.mock.calls.length

    await user.click(within(result).getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Encryption complete" }),
      ).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole("tab", { name: "Decrypt" }))
    await user.click(screen.getByRole("tab", { name: "Encrypt" }))
    await user.type(screen.getByLabelText("Plaintext"), "fresh transfer")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    const freshResult = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    await waitFor(() =>
      expect(renderQrDataUrl.mock.calls.length).toBeGreaterThan(
        renderCallsBeforeTabSwitch,
      ),
    )

    expect(splitIntoFrames).toHaveBeenCalledTimes(2)
    await user.click(within(freshResult).getByRole("button", { name: "Pause" }))
    const freshPayload = renderQrDataUrl.mock.calls.at(-1)?.[0]
    expect(freshPayload).toMatch(/^OCF2:/)
    expect(freshPayload!.split(":")[1]).not.toBe(initialTransferId)
  })

  it("does not persist during scan decryption success", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
    expect(
      screen.getByRole("heading", { name: "Scan with the camera" }),
    ).toBeInTheDocument()
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

  it("distinguishes signature validity from person trust and hides unknown-signer plaintext", async () => {
    const user = userEvent.setup()
    const unverifiedSender: PqPublicBundleRecord = {
      ...fakeBundles[0]!,
      trust: "unverified",
    }
    delete unverifiedSender.trustConfirmedAt
    fakeBundles.splice(0, fakeBundles.length, unverifiedSender)
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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

  it("labels unsigned plaintext and suppresses it after a signature failure", async () => {
    const user = userEvent.setup()
    fakePqDecrypt.kind = "unsigned"
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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

  it("fails closed with the worker-unavailable user message", async () => {
    const user = userEvent.setup()
    encryptPq.mockRejectedValueOnce(new AppError("WORKER_UNAVAILABLE"))
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "worker failure")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    expect(
      await screen.findByText(messageFor("WORKER_UNAVAILABLE", "en")),
    ).toBeInTheDocument()
    expect(encryptPq).toHaveBeenCalledOnce()
    expect(screen.queryByText("Encryption is complete")).not.toBeInTheDocument()
  })

  it("rejects the smaller symmetric limit before encryption while accepting the same plaintext for PQ", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    const plaintext = screen.getByLabelText("Plaintext")
    const symmetricLimit = maximumSymmetricPlaintextBytesForPayloadCapacity(1_663)
    const symmetricOversizePlaintext = "a".repeat(4_097)

    expect(symmetricLimit).toBe(1_042)
    expect(symmetricLimit).toBeLessThan(env.maxPlaintextBytes)
    fireEvent.change(plaintext, { target: { value: symmetricOversizePlaintext } })
    expect(
      screen.getByText(`${symmetricOversizePlaintext.length} / ${symmetricLimit} bytes`),
    ).toBeInTheDocument()
    expect(screen.getByText("The plaintext limit has been exceeded")).toBeInTheDocument()
    expect(
      screen.getByText(
        `Shorten the UTF-8 text to no more than ${symmetricLimit} bytes.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Encrypt" })).toBeDisabled()
    expect(encryptWithAesKey).not.toHaveBeenCalled()

    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    expect(
      screen.getByText(
        `${symmetricOversizePlaintext.length} / ${env.maxPlaintextBytes} bytes`,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText("The plaintext limit has been exceeded")).toBeNull()
    const encryptButton = screen.getByRole("button", { name: "Encrypt" })
    expect(encryptButton).toBeEnabled()
    await user.click(encryptButton)
    await screen.findByRole("dialog", { name: "Encryption complete" })
    expect(encryptPq).toHaveBeenCalledOnce()
    expect(encryptPq.mock.calls[0]![0].plaintext).toHaveLength(
      symmetricOversizePlaintext.length,
    )
    expect(encryptWithAesKey).not.toHaveBeenCalled()
  })

  it("clears plaintext after symmetric success and exposes no SVG affordance", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    const plaintext = screen.getByLabelText("Plaintext")
    fireEvent.change(plaintext, { target: { value: "既定で消去される平文" } })
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    const result = await screen.findByRole("dialog", { name: "Encryption complete" })
    expect(within(result).getByText("Encryption complete")).toBeInTheDocument()
    expect(plaintext).toHaveValue("")
    expect(fakeIdentities).toHaveLength(1)
    expect(within(result).getAllByRole("button", { name: "Download" })).toHaveLength(1)
    expect(within(result).queryByRole("button", { name: /SVG/i })).toBeNull()
    const fullscreenButton = within(result).getByRole("button", {
      name: "View full screen",
    })
    await waitFor(() => expect(fullscreenButton).toBeEnabled())
    await user.click(fullscreenButton)
    const fullscreen = screen.getByRole("dialog", {
      name: /View Ciphertext QR full screen/,
    })
    expect(within(fullscreen).getByRole("img")).toBeInTheDocument()
  })

  it("defaults to 1000 bytes and 200 milliseconds without WebAssembly", async () => {
    vi.stubGlobal("WebAssembly", undefined)
    encryptPq.mockResolvedValueOnce({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
      recipientKemKeyId: fakeBundles[0]!.kem.keyId,
      kemCiphertext: new Uint8Array(1_568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(512),
    })
    const timeout = vi.spyOn(window, "setTimeout")
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "no wasm default")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const result = await screen.findByRole("dialog", { name: "Encryption complete" })
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 1_000,
        }),
      ),
    )
    await waitFor(() => expect(within(result).getByRole("img")).toBeInTheDocument())
    await waitFor(() =>
      expect(timeout.mock.calls.some(([, delay]) => delay === 200)).toBe(true),
    )
    expect(globalThis.WebAssembly).toBeUndefined()
    expect(
      within(result).getByRole("switch", { name: "Compatibility mode" }),
    ).not.toBeChecked()
    expect(fakePreferences).toMatchObject({
      frameBytes: 1_000,
      frameIntervalMs: 200,
    })
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  it("keeps fullscreen open while compatibility mode re-splits and restarts at frame one", async () => {
    encryptPq.mockResolvedValueOnce({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
      recipientKemKeyId: fakeBundles[0]!.kem.keyId,
      kemCiphertext: new Uint8Array(1_568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(32),
    })
    const defaultSplitIntoFrames = splitIntoFrames.getMockImplementation()!
    const compatibleSplit =
      deferred<Awaited<ReturnType<typeof defaultSplitIntoFrames>>>()
    let compatibleArgs:
      | Parameters<typeof defaultSplitIntoFrames>[0]
      | undefined
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "fullscreen compatibility")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const result = await screen.findByRole("dialog", { name: "Encryption complete" })
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 1_000,
        }),
      ),
    )
    await waitFor(() => expect(within(result).getByRole("img")).toBeInTheDocument())
    await user.click(within(result).getByRole("button", { name: "Pause" }))
    const fullscreenTrigger = within(result).getByRole("button", {
      name: "View full screen",
    })
    await waitFor(() => expect(fullscreenTrigger).toBeEnabled())
    await user.click(fullscreenTrigger)
    const fullscreen = screen.getByRole("dialog", {
      name: /View Ciphertext .* full screen/,
    })
    if (within(fullscreen).queryByText("1 / 2")) {
      await user.click(within(fullscreen).getByRole("button", { name: "Next" }))
    }
    expect(within(fullscreen).getByText("2 / 2")).toBeInTheDocument()

    splitIntoFrames.mockImplementationOnce((args) => {
      compatibleArgs = args
      return compatibleSplit.promise
    })
    await user.click(
      within(fullscreen).getByRole("switch", { name: "Compatibility mode" }),
    )

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        frameBytes: 100,
        frameIntervalMs: 2_000,
      }),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 100,
        }),
      ),
    )
    expect(
      screen.getByRole("dialog", {
        name: /View Ciphertext 2 \/ 2 full screen/,
      }),
    ).toBe(fullscreen)
    expect(within(fullscreen).getByRole("img")).toBeInTheDocument()

    const compatibleFrames = await defaultSplitIntoFrames(compatibleArgs!)
    const renderCallsBeforeResolve = renderQrDataUrl.mock.calls.length
    await act(async () => {
      compatibleSplit.resolve(compatibleFrames)
      await compatibleSplit.promise
    })

    await waitFor(() =>
      expect(
        within(fullscreen).getByText(`1 / ${compatibleFrames.length}`),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole("dialog", {
        name: new RegExp(
          `View Ciphertext 1 / ${compatibleFrames.length} full screen`,
        ),
      }),
    ).toBe(fullscreen)
    await waitFor(() =>
      expect(renderQrDataUrl.mock.calls.length).toBeGreaterThan(
        renderCallsBeforeResolve,
      ),
    )
    expect(renderQrDataUrl.mock.calls[renderCallsBeforeResolve]?.[0]).toContain(
      `:0:${compatibleFrames.length}:pq-message`,
    )
    expect(
      within(fullscreen).getAllByRole("button", { name: "Close" }),
    ).toHaveLength(1)
    expect(
      within(fullscreen).getByRole("switch", { name: "Compatibility mode" }),
    ).toBeChecked()
  })

  it("persists the compatible pair, re-splits at the raised density, and survives remount", async () => {
    const artifactByteLength = 12_801
    encryptPq.mockResolvedValue({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
      recipientKemKeyId: fakeBundles[0]!.kem.keyId,
      kemCiphertext: new Uint8Array(1_568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(artifactByteLength - 1_568 - 128),
    })
    const user = userEvent.setup()
    const mounted = await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "compatible clamp")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    let result = await screen.findByRole("dialog", { name: "Encryption complete" })
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 1_000,
        }),
      ),
    )
    const compatibility = within(result).getByRole("switch", {
      name: "Compatibility mode",
    })
    expect(compatibility).not.toBeChecked()
    await user.click(compatibility)

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        frameBytes: 100,
        frameIntervalMs: 2_000,
      }),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 200,
        }),
      ),
    )
    await waitFor(() =>
      expect(
        within(result).getByRole("switch", { name: "Compatibility mode" }),
      ).toBeChecked(),
    )
    expect(
      within(result).getByText(
        "Frame density could not be lowered further because this transfer must stay within the frame limit.",
      ),
    ).toHaveAttribute("role", "status")
    expect(
      updatePreferences.mock.calls
        .map(([patch]) => patch)
        .filter((patch) => "frameBytes" in patch || "frameIntervalMs" in patch),
    ).toEqual([{ frameBytes: 100, frameIntervalMs: 2_000 }])
    expect(fakePreferences).toMatchObject({
      frameBytes: 100,
      frameIntervalMs: 2_000,
    })

    mounted.unmount()
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "compatible remount")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    result = await screen.findByRole("dialog", { name: "Encryption complete" })
    await waitFor(() =>
      expect(
        within(result).getByRole("switch", { name: "Compatibility mode" }),
      ).toBeChecked(),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 200,
        }),
      ),
    )
    expect(
      within(result).getByText(
        "Frame density could not be lowered further because this transfer must stay within the frame limit.",
      ),
    ).toBeInTheDocument()
    expect(
      updatePreferences.mock.calls
        .map(([patch]) => patch)
        .filter((patch) => "frameBytes" in patch || "frameIntervalMs" in patch),
    ).toEqual([{ frameBytes: 100, frameIntervalMs: 2_000 }])
  })

  it("keeps a 1000-byte floor while compatible mode changes dwell to 2000 milliseconds", async () => {
    const artifactByteLength = 128_000
    encryptPq.mockResolvedValueOnce({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
      recipientKemKeyId: fakeBundles[0]!.kem.keyId,
      kemCiphertext: new Uint8Array(1_568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(artifactByteLength - 1_568 - 128),
    })
    const timeout = vi.spyOn(window, "setTimeout")
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "density floor")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const result = await screen.findByRole("dialog", { name: "Encryption complete" })
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 1_000,
        }),
      ),
    )
    await waitFor(() => expect(within(result).getByRole("img")).toBeInTheDocument())
    await waitFor(() =>
      expect(timeout.mock.calls.some(([, delay]) => delay === 200)).toBe(true),
    )
    const splitCallsAtDefault = splitIntoFrames.mock.calls.length
    await user.click(
      within(result).getByRole("switch", { name: "Compatibility mode" }),
    )

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        frameBytes: 100,
        frameIntervalMs: 2_000,
      }),
    )
    await waitFor(() =>
      expect(timeout.mock.calls.some(([, delay]) => delay === 2_000)).toBe(true),
    )
    expect(splitIntoFrames).toHaveBeenCalledTimes(splitCallsAtDefault)
    expect(
      within(result).getByText(
        "Frame density could not be lowered further because this transfer must stay within the frame limit.",
      ),
    ).toHaveAttribute("role", "status")
    expect(updatePreferences).not.toHaveBeenCalledWith({
      frameBytes: 1_000,
      frameIntervalMs: 2_000,
    })
  })

  it("fails through QR_TOO_LARGE when even the maximum density cannot fit", async () => {
    const frameCeiling = 10
    const artifactByteLength = frameCeiling * FRAME_BYTES_MAX + 1
    env.qrMaxFrames = frameCeiling
    encryptPq.mockResolvedValueOnce({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: fakeBundles[0]!.kem.keyId,
      kemCiphertext: new Uint8Array(1_568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(artifactByteLength - 1_568 - 128),
    })
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Cryptographic algorithm", /Signed post-quantum/)
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await chooseSelectOption(user, "My ML-DSA signing identity", "自分のPQ ID")
    await user.type(screen.getByLabelText("Plaintext"), "too large")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    expect(await screen.findByText(messageFor("QR_TOO_LARGE", "en"))).toBeInTheDocument()
    expect(screen.queryByText("Encryption is complete")).toBeNull()
    expect(splitIntoFrames).not.toHaveBeenCalled()
  })

  it("shows the AES result in a modal in the requested order", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    await user.type(screen.getByLabelText("Plaintext"), "AES modal slot order")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const dialog = await screen.findByRole("dialog", { name: "Encryption complete" })
    const order = within(dialog)
      .getAllByTestId(/^encrypt-result-/)
      .map((node) => node.dataset.testid)

    expect(order).toEqual([
      "encrypt-result-qr",
      "encrypt-result-payload",
      "encrypt-result-output",
      "encrypt-result-detail",
    ])
    expect(within(dialog).getAllByRole("button", { name: "Download" })).toHaveLength(1)
    expect(
      within(dialog).getByTestId("encrypt-result-output").querySelector("button"),
    ).toBeTruthy()
  })

  it("keeps the PQ transport controls with the QR, above the payload", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "PQ modal transport controls")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const dialog = await screen.findByRole("dialog", { name: "Encryption complete" })
    const qrSlot = within(dialog).getByTestId("encrypt-result-qr")

    expect(
      await within(qrSlot).findByRole("button", { name: "Pause" }),
    ).toBeInTheDocument()
    expect(within(qrSlot).getByRole("button", { name: "Next" })).toBeInTheDocument()
    expect(
      within(qrSlot).getByRole("switch", { name: "Compatibility mode" }),
    ).toBeInTheDocument()
    expect(within(qrSlot).getByText(/^1 \/ \d+$/)).toBeInTheDocument()
    expect(within(dialog).getAllByRole("button", { name: "Download" })).toHaveLength(1)
    expect(within(qrSlot).queryByRole("button", { name: "Download" })).toBeNull()
  })

  it("discards the result when the modal closes", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    await user.type(screen.getByLabelText("Plaintext"), "discard this AES result")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const dialog = await screen.findByRole("dialog", { name: "Encryption complete" })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Encryption complete" }),
      ).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/^OCM1:/)).not.toBeInTheDocument()
  })

  it("disables the PQ download until the frame split has frames", async () => {
    const user = userEvent.setup()
    const pendingSplit = deferred<Awaited<ReturnType<typeof splitIntoFrames>>>()
    splitIntoFrames.mockReturnValueOnce(pendingSplit.promise)
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "pending PQ frame split")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const dialog = await screen.findByRole("dialog", { name: "Encryption complete" })
    expect(within(dialog).getByRole("button", { name: "Download" })).toBeDisabled()
  })

  it("shows an export failure inside the modal", async () => {
    const user = userEvent.setup()
    exportQrFramePayloads.mockRejectedValueOnce(new AppError("QR_TOO_LARGE"))
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "PQ export failure")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const dialog = await screen.findByRole("dialog", { name: "Encryption complete" })
    const download = within(dialog).getByRole("button", { name: "Download" })
    await waitFor(() => expect(download).toBeEnabled())
    await user.click(download)

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      messageFor("QR_TOO_LARGE", "en"),
    )
  })

  it("opens the result modal when the decrypt button succeeds", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    const dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    expect(within(dialog).getByText("復号済み平文")).toBeInTheDocument()
  })

  it("opens the result modal immediately after a single QR read", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
    await user.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalled())

    await act(async () => emitScannedPayload("OCM1:sym-key-00000001"))

    const dialog = await screen.findByRole("dialog", {
      name: "Decryption complete",
    })
    expect(within(dialog).getByText("復号済み平文")).toBeInTheDocument()
  })

  it("opens the result modal when a multipart transfer completes", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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

  it("shows an alert and no modal when decryption throws", async () => {
    const user = userEvent.setup()
    decryptWithAesKey.mockRejectedValueOnce(new AppError("DECRYPTION_FAILED"))
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    expect(
      await screen.findByText(messageFor("DECRYPTION_FAILED", "en")),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "Decryption complete" }),
    ).not.toBeInTheDocument()
  })

  it("keeps signed-key-unknown on its own alert with no modal", async () => {
    const user = userEvent.setup()
    fakePqDecrypt.kind = "signed-key-unknown"
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)

    expect(await screen.findByText("SIGNING_KEY_NOT_FOUND")).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "Decryption complete" }),
    ).not.toBeInTheDocument()
  })

  it("discards the decrypted plaintext when the modal closes", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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

  it("F1 disables every operation entry point while crypto is in flight", async () => {
    const user = userEvent.setup()
    const defaultEncryptWithAesKey = encryptWithAesKey.getMockImplementation()!
    const defaultDecryptWithAesKey = decryptWithAesKey.getMockImplementation()!
    const pendingEncryption =
      deferred<Awaited<ReturnType<typeof defaultEncryptWithAesKey>>>()
    encryptWithAesKey.mockReturnValueOnce(pendingEncryption.promise)
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    await user.type(screen.getByLabelText("Plaintext"), "single-flight encryption")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    await waitFor(() => expect(encryptWithAesKey).toHaveBeenCalledOnce())

    const encryptTab = screen.getByRole("tab", { name: "Encrypt" })
    const decryptTab = screen.getByRole("tab", { name: "Decrypt" })
    const tabsDisabledDuringEncryption = [encryptTab, decryptTab].every((tab) =>
      tab.hasAttribute("disabled"),
    )
    let scannerDisabledDuringEncryption: boolean | null = null
    let decryptCallsStartedDuringEncryption = 0

    // The unfixed page permits this branch. Once the tab gate is fixed, it is
    // unreachable and the scanner gate is exercised below while decrypting.
    if (!decryptTab.hasAttribute("disabled")) {
      await user.click(decryptTab)
      const scannerTrigger = screen.getByRole("button", {
        name: "Scan a ciphertext QR code",
      })
      scannerDisabledDuringEncryption = scannerTrigger.hasAttribute("disabled")
      if (!scannerTrigger.hasAttribute("disabled")) {
        await user.click(scannerTrigger)
        await waitFor(() => expect(startQrScan).toHaveBeenCalled())
        await act(async () => {
          emitScannedPayload("OCM1:sym-key-00000001")
        })
        await waitFor(() => expect(decryptWithAesKey).toHaveBeenCalledOnce())
        decryptCallsStartedDuringEncryption = decryptWithAesKey.mock.calls.length
        await screen.findByRole("dialog", { name: "Decryption complete" })
      }
    }

    const encryptionArgs = encryptWithAesKey.mock.calls[0]![0]
    const encrypted = await defaultEncryptWithAesKey(encryptionArgs)
    await act(async () => {
      pendingEncryption.resolve(encrypted)
      await pendingEncryption.promise
    })

    const priorDecryptionResult = screen.queryByRole("dialog", {
      name: "Decryption complete",
    })
    if (priorDecryptionResult) {
      await user.click(
        within(priorDecryptionResult).getByRole("button", { name: "Close" }),
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Decryption complete" }),
        ).not.toBeInTheDocument(),
      )
    }
    const encryptionResult = screen.queryByRole("dialog", {
      name: "Encryption complete",
    })
    if (encryptionResult) {
      await user.click(within(encryptionResult).getByRole("button", { name: "Close" }))
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Encryption complete" }),
        ).not.toBeInTheDocument(),
      )
    }

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Decrypt" })).toBeEnabled(),
    )
    const currentDecryptTab = screen.getByRole("tab", { name: "Decrypt" })
    if (currentDecryptTab.getAttribute("data-state") !== "active") {
      await user.click(currentDecryptTab)
    }
    decryptWithAesKey.mockClear()
    const pendingDecryption =
      deferred<Awaited<ReturnType<typeof defaultDecryptWithAesKey>>>()
    decryptWithAesKey.mockReturnValueOnce(pendingDecryption.promise)
    fireEvent.change(screen.getByLabelText("Ciphertext payload"), {
      target: { value: "OCM1:sym-key-00000001" },
    })
    const decryptButton = screen.getByRole("button", { name: "Decrypt" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    await waitFor(() => expect(decryptWithAesKey).toHaveBeenCalledOnce())
    const scannerDisabledWhileDecrypting = screen
      .getByRole("button", { name: "Scan a ciphertext QR code" })
      .hasAttribute("disabled")

    const decryptedBytes = await defaultDecryptWithAesKey()
    await act(async () => {
      pendingDecryption.resolve(decryptedBytes)
      await pendingDecryption.promise
    })
    await screen.findByRole("dialog", { name: "Decryption complete" })

    expect({
      tabsDisabledDuringEncryption,
      scannerDisabledDuringBusy:
        scannerDisabledDuringEncryption ?? scannerDisabledWhileDecrypting,
      decryptCallsStartedDuringEncryption,
    }).toEqual({
      tabsDisabledDuringEncryption: true,
      scannerDisabledDuringBusy: true,
      decryptCallsStartedDuringEncryption: 0,
    })
  })

  it("F2 never stacks scanner and decryption result dialogs while marking key use", async () => {
    const user = userEvent.setup()
    const pendingMark = deferred<void>()
    markKeyUsed.mockReturnValueOnce(pendingMark.promise)
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "Decrypt" }))
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

  it("F3 isolates a replacement result from a dismissed export", async () => {
    const user = userEvent.setup()
    const staleExport = deferred<void>()
    exportQrFramePayloads.mockReturnValueOnce(staleExport.promise)
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "dismissed export")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const firstResult = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    const firstDownload = within(firstResult).getByRole("button", {
      name: "Download",
    })
    await waitFor(() => expect(firstDownload).toBeEnabled())
    await user.click(firstDownload)
    await waitFor(() => expect(exportQrFramePayloads).toHaveBeenCalledOnce())
    await waitFor(() => expect(firstDownload).toBeDisabled())
    await user.click(within(firstResult).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Encryption complete" }),
      ).not.toBeInTheDocument(),
    )

    const renderCallsBeforeReplacement = renderQrDataUrl.mock.calls.length
    await user.type(screen.getByLabelText("Plaintext"), "replacement result")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    const replacement = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    const replacementDownload = within(replacement).getByRole("button", {
      name: "Download",
    })
    await waitFor(() =>
      expect(
        within(replacement).getByRole("switch", { name: "Compatibility mode" }),
      ).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(renderQrDataUrl.mock.calls.length).toBeGreaterThan(
        renderCallsBeforeReplacement,
      ),
    )
    const replacementDownloadDisabledBeforeStaleRejection =
      replacementDownload.hasAttribute("disabled")
    const inheritedAlertBeforeStaleRejection =
      within(replacement).queryByRole("alert")?.textContent ?? null

    await act(async () => {
      staleExport.reject(new AppError("QR_TOO_LARGE"))
      await staleExport.promise.catch(() => undefined)
    })
    await waitFor(() => expect(replacementDownload).toBeEnabled())
    const inheritedAlertAfterStaleRejection =
      within(replacement).queryByRole("alert")?.textContent ?? null

    expect({
      replacementDownloadDisabledBeforeStaleRejection,
      inheritedAlertBeforeStaleRejection,
      inheritedAlertAfterStaleRejection,
    }).toEqual({
      replacementDownloadDisabledBeforeStaleRejection: false,
      inheritedAlertBeforeStaleRejection: null,
      inheritedAlertAfterStaleRejection: null,
    })
  })

  it("F4 renders a compatibility persistence failure inside the result dialog", async () => {
    const user = userEvent.setup()
    updatePreferences.mockRejectedValueOnce(new AppError("STORAGE_FAILED"))
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "compatibility failure")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const result = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    const compatibility = within(result).getByRole("switch", {
      name: "Compatibility mode",
    })
    await waitFor(() => expect(compatibility).toBeEnabled())
    await user.click(compatibility)
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        frameBytes: 100,
        frameIntervalMs: 2_000,
      }),
    )
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull())
    const alert = document.querySelector<HTMLElement>('[role="alert"]')!

    expect(
      result,
      "compatibility failure alert must be contained by the result dialog",
    ).toContainElement(alert)
    expect(alert).toHaveTextContent(messageFor("STORAGE_FAILED", "en"))
  })

  it("R2 isolates a replacement result from a stale compatibility update", async () => {
    const user = userEvent.setup()
    const staleUpdate = deferred<Awaited<ReturnType<typeof updatePreferences>>>()
    updatePreferences.mockReturnValueOnce(staleUpdate.promise)
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "stale compatibility")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const firstResult = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    const firstCompatibility = within(firstResult).getByRole("switch", {
      name: "Compatibility mode",
    })
    await waitFor(() => expect(firstCompatibility).toBeEnabled())
    await user.click(firstCompatibility)
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledOnce())
    await waitFor(() => expect(firstCompatibility).toBeDisabled())
    await user.click(within(firstResult).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Encryption complete" }),
      ).not.toBeInTheDocument(),
    )

    await user.type(screen.getByLabelText("Plaintext"), "replacement result")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    const replacement = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    const replacementCompatibility = within(replacement).getByRole("switch", {
      name: "Compatibility mode",
    })
    expect(within(replacement).queryByRole("alert")).not.toBeInTheDocument()
    await waitFor(() => expect(replacementCompatibility).toBeEnabled())

    await act(async () => {
      staleUpdate.reject(new AppError("STORAGE_FAILED"))
      await staleUpdate.promise.catch(() => undefined)
    })

    await waitFor(() => expect(replacementCompatibility).toBeEnabled())
    expect(within(replacement).queryByRole("alert")).not.toBeInTheDocument()
  })
})
