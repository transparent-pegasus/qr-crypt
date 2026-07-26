import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppError, messageFor } from "@/crypto/errors"
import {
  FRAME_BYTES_MAX,
  maximumSymmetricPlaintextBytesForPayloadCapacity,
} from "@/lib/limits"
import type { MlKemMessageEnvelopeV2 } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  emitScannedPayload,
  encryptWithAesKey,
  encryptPq,
  decryptPqMessage,
  fakeBundles,
  fakeIdentities,
  fakePqDecrypt,
  isQrReaderModuleUsable,
  prepareQrReaderModule,
  renderQrDataUrl,
  setQrReaderModuleUsable,
  splitIntoFrames,
  startQrScan,
  subscribeQrReaderModuleState,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

const defaultQrMaxFrames = env.qrMaxFrames

vi.doMock("@/qr/decode", () => ({
  isQrReaderModuleUsable,
  prepareQrReaderModule,
  startQrScan,
  subscribeQrReaderModuleState,
}))

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string | RegExp,
) {
  await user.click(await screen.findByLabelText(label))
  await user.click(await screen.findByRole("option", { name: option }))
}

describe("encrypt page v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.qrMaxFrames = defaultQrMaxFrames
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

    const result = await screen.findByRole("region", { name: "Encryption result" })
    expect(within(result).getByText("Encryption is complete")).toBeInTheDocument()
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

  it("keeps the PQ transfer ID stable across Encrypt and Decrypt tabs", async () => {
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

    const result = await screen.findByRole("region", { name: "Encryption result" })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    await user.click(within(result).getByRole("button", { name: "Pause" }))
    const initialPayload = renderQrDataUrl.mock.calls.at(-1)?.[0]
    expect(initialPayload).toMatch(/^OCF2:/)
    const initialTransferId = initialPayload!.split(":")[1]
    const renderCallsBeforeTabSwitch = renderQrDataUrl.mock.calls.length

    await user.click(screen.getByRole("tab", { name: "Decrypt" }))
    expect(
      screen.queryByRole("region", { name: "Encryption result" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Encrypt" }))
    await screen.findByRole("region", { name: "Encryption result" })
    await waitFor(() =>
      expect(renderQrDataUrl.mock.calls.length).toBeGreaterThan(
        renderCallsBeforeTabSwitch,
      ),
    )

    expect(splitIntoFrames).toHaveBeenCalledTimes(1)
    const resumedPayload = renderQrDataUrl.mock.calls.at(-1)?.[0]
    expect(resumedPayload).toMatch(/^OCF2:/)
    expect(resumedPayload!.split(":")[1]).toBe(initialTransferId)
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
    await user.click(await screen.findByRole("button", { name: "Decrypt" }))
    expect(await screen.findByText("復号済み平文")).toBeInTheDocument()
    expect(screen.getByText(/held only in memory and is not stored/)).toBeInTheDocument()
    expect(screen.queryByText(/Saved key QR|Save key QR/)).not.toBeInTheDocument()
  })

  it("distinguishes signature validity from person trust and hides unknown-signer plaintext", async () => {
    const user = userEvent.setup()
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
    expect(screen.getByText(/Identity verified/)).toBeInTheDocument()

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

    decryptPqMessage.mockRejectedValueOnce(new AppError("SIGNATURE_INVALID"))
    await user.click(decryptButton)
    expect(
      await screen.findByText(messageFor("SIGNATURE_INVALID", "en")),
    ).toBeInTheDocument()
    expect(screen.queryByText("PQ復号済み平文")).not.toBeInTheDocument()
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
    await screen.findByRole("region", { name: "Encryption result" })
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
    const result = await screen.findByRole("region", { name: "Encryption result" })
    expect(within(result).getByText("Encryption is complete")).toBeInTheDocument()
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

  it.each([
    {
      label: "wasm reader usable",
      wasmReaderUsable: true,
      frameBytes: 1_000,
      dwellMs: 200,
    },
    {
      label: "wasm reader unusable",
      wasmReaderUsable: false,
      frameBytes: 100,
      dwellMs: 2_000,
    },
  ])(
    "selects the automatic display profile when the $label",
    async ({ wasmReaderUsable, frameBytes, dwellMs }) => {
      const firstQrRender = (() => {
        let resolve!: (value: string) => void
        const promise = new Promise<string>((resolvePromise) => {
          resolve = resolvePromise
        })
        return { promise, resolve }
      })()
      setQrReaderModuleUsable(wasmReaderUsable)
      renderQrDataUrl.mockImplementationOnce(() => firstQrRender.promise)
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
      const user = userEvent.setup()
      await renderApp("/encrypt")
      await chooseSelectOption(
        user,
        "Cryptographic algorithm",
        /Post-quantum ML-KEM-1024 \+ AES/,
      )
      await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
      await user.type(screen.getByLabelText("Plaintext"), "profile selection")
      await user.click(screen.getByRole("button", { name: "Encrypt" }))

      const result = await screen.findByRole("region", { name: "Encryption result" })
      await waitFor(() =>
        expect(splitIntoFrames).toHaveBeenLastCalledWith(
          expect.objectContaining({
            artifactType: "pq-message",
            frameBytes,
          }),
        ),
      )

      const timeout = vi.spyOn(window, "setTimeout")
      firstQrRender.resolve("data:image/png;base64,cHJvZmlsZQ==")
      await waitFor(() => expect(within(result).getByRole("img")).toBeInTheDocument())
      expect(timeout.mock.calls.some(([, delay]) => delay === dwellMs)).toBe(true)
      timeout.mockRestore()
    },
  )

  it("raises the unusable-reader fallback density and shows the clamp notice", async () => {
    const artifactByteLength = 12_801
    setQrReaderModuleUsable(false)
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
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(
      user,
      "Cryptographic algorithm",
      /Post-quantum ML-KEM-1024 \+ AES/,
    )
    await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
    await user.type(screen.getByLabelText("Plaintext"), "fallback clamp")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))

    const result = await screen.findByRole("region", { name: "Encryption result" })
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 200,
        }),
      ),
    )
    expect(
      within(result).getByText("Frame density was raised so this transfer fits."),
    ).toHaveAttribute("role", "status")
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
})
