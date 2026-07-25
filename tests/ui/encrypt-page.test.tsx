import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AppError, messageFor } from "@/crypto/errors"
import type { MlKemMessageEnvelopeV2 } from "@/schemas/domain"
import {
  emitScannedPayload,
  encryptPq,
  decryptPqMessage,
  fakeBundles,
  fakeIdentities,
  fakePreferences,
  fakePqDecrypt,
  renderQrDataUrl,
  splitIntoFrames,
  startQrScan,
  updatePreferences,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

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
  afterEach(resetUi)

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
    expect(within(result).getByRole("button", { name: "Next frame" })).toBeInTheDocument()
    expect(within(result).getByLabelText("Display speed")).toBeInTheDocument()
    expect(
      within(result).getByRole("button", { name: /Export all PNGs/ }),
    ).toBeInTheDocument()
    expect(within(result).getByRole("button", { name: /Export ZIP/ })).toBeInTheDocument()
    expect(
      within(result).getByRole("button", { name: "View full screen" }),
    ).toBeInTheDocument()
    await user.click(within(result).getByRole("button", { name: "Next frame" }))
    expect(within(result).getByText(/^2 \/ /)).toBeInTheDocument()
    await user.click(within(result).getByRole("button", { name: "Pause" }))
    expect(within(result).getByRole("button", { name: "Play" })).toBeInTheDocument()
    fireEvent.change(within(result).getByLabelText("Display speed"), {
      target: { value: "2500" },
    })
    expect(within(result).getByText("2500 ms")).toBeInTheDocument()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(renderQrDataUrl.mock.calls.at(-1)?.[0]).toMatch(/^OCF2:/)
    const fullscreen = within(result).getByRole("button", { name: "View full screen" })
    await waitFor(() => expect(fullscreen).toBeEnabled())
    await user.click(fullscreen)
    const fullscreenDialog = screen.getByRole("dialog", {
      name: /View Ciphertext 2 \/ .* full screen/,
    })
    expect(fullscreenDialog).toBeInTheDocument()
    expect(within(fullscreenDialog).getByLabelText("Frame density")).toBeInTheDocument()
    expect(within(fullscreenDialog).getByLabelText("Display speed")).toHaveValue("2500")
    const controlIds = Array.from(fullscreenDialog.querySelectorAll("input[id]")).map(
      (input) => input.id,
    )
    expect(new Set(controlIds).size).toBe(controlIds.length)
    const splitCallsBeforeSpeed = splitIntoFrames.mock.calls.length
    fireEvent.change(within(fullscreenDialog).getByLabelText("Display speed"), {
      target: { value: "3000" },
    })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ frameIntervalMs: 3_000 }),
    )
    expect(splitIntoFrames).toHaveBeenCalledTimes(splitCallsBeforeSpeed)
    fireEvent.change(within(fullscreenDialog).getByLabelText("Frame density"), {
      target: { value: "300" },
    })
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-message",
          frameBytes: 300,
        }),
      ),
    )
    expect(updatePreferences).toHaveBeenCalledWith({ frameBytes: 300 })
    updatePreferences.mockRejectedValueOnce(new Error("storage failed"))
    fireEvent.change(within(fullscreenDialog).getByLabelText("Display speed"), {
      target: { value: "2500" },
    })
    await waitFor(() =>
      expect(
        screen.getAllByText("Settings could not be saved. Check the device storage.")
          .length,
      ).toBeGreaterThan(0),
    )
    await user.click(
      within(fullscreenDialog).getAllByRole("button", { name: "Close" })[0]!,
    )

    expect(within(result).queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    expect(
      within(result).queryByText(/Saved|Duplicate|Save key QR/),
    ).not.toBeInTheDocument()
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

  it("keeps UTF-8 limits and clears plaintext after success", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    const plaintext = screen.getByLabelText("Plaintext")
    fireEvent.change(plaintext, { target: { value: "a".repeat(4097) } })
    expect(screen.getByText("The plaintext limit has been exceeded")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Encrypt" })).toBeDisabled()
    fireEvent.change(plaintext, { target: { value: "既定で消去される平文" } })
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    const result = await screen.findByRole("region", { name: "Encryption result" })
    expect(within(result).getByText("Encryption is complete")).toBeInTheDocument()
    expect(plaintext).toHaveValue("")
    expect(fakeIdentities).toHaveLength(1)
    const fullscreenButton = within(result).getByRole("button", {
      name: "View full screen",
    })
    await waitFor(() => expect(fullscreenButton).toBeEnabled())
    await user.click(fullscreenButton)
    const fullscreen = screen.getByRole("dialog", {
      name: /View Ciphertext QR full screen/,
    })
    expect(within(fullscreen).getByRole("img")).toBeInTheDocument()
    expect(within(fullscreen).queryByLabelText("Frame density")).toBeNull()
    expect(within(fullscreen).queryByLabelText("Display speed")).toBeNull()
  })

  it.each([
    { caseName: "signed-empty", artifactBytes: 6_613, plaintext: "x" },
    {
      caseName: "signed-maximum",
      artifactBytes: 10_711,
      plaintext: "x".repeat(4_096),
    },
  ])(
    "clamps a stored 100B density before the first $caseName split",
    async ({ artifactBytes, plaintext }) => {
      fakePreferences.frameBytes = 100
      encryptPq.mockResolvedValueOnce({
        version: 2,
        type: "pq-message",
        suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
        recipientKemKeyId: fakeBundles[0]!.kem.keyId,
        kemCiphertext: new Uint8Array(1_568),
        hkdfSalt: new Uint8Array(32),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(artifactBytes - 1_568 - 128),
      })
      const user = userEvent.setup()
      await renderApp("/encrypt")
      await chooseSelectOption(user, "Cryptographic algorithm", /Signed post-quantum/)
      await chooseSelectOption(user, "Recipient ML-KEM public key", /確認済みの相手/)
      await chooseSelectOption(user, "My ML-DSA signing identity", "自分のPQ ID")
      fireEvent.change(screen.getByLabelText("Plaintext"), {
        target: { value: plaintext },
      })
      await user.click(screen.getByRole("button", { name: "Encrypt" }))

      await screen.findByRole("region", { name: "Encryption result" })
      await waitFor(() =>
        expect(splitIntoFrames).toHaveBeenLastCalledWith(
          expect.objectContaining({
            artifactType: "pq-message",
            frameBytes: 200,
          }),
        ),
      )
      expect(updatePreferences).not.toHaveBeenCalledWith({ frameBytes: 200 })
    },
  )

  it("fails through QR_TOO_LARGE when even the maximum density cannot fit", async () => {
    fakePreferences.frameBytes = 100
    encryptPq.mockResolvedValueOnce({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: fakeBundles[0]!.kem.keyId,
      kemCiphertext: new Uint8Array(1_568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(56_305),
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
