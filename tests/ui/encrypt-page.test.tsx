import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppError, messageFor } from "@/crypto/errors"
import {
  FRAME_BYTES_MAX,
  maximumSymmetricPlaintextBytesForPayloadCapacity,
} from "@/lib/limits"
import { decodeFramePayload } from "@/qr/payload-v2"
import { translate } from "@/i18n/messages"
import type {
  MlKemMessageEnvelopeV2,
  PqPublicBundleRecord,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { deferred } from "../helpers/deferred"
import {
  encryptWithAesKey,
  encryptPq,
  exportQrFramePayloads,
  fakeBundles,
  fakeIdentities,
  fakePreferences,
  renderQrDataUrl,
  splitIntoFrames,
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

    expect(labels).toContain(`Verified: ${confirmedBundle.kem.keyId}`)
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
    const renderCallsBeforeReencrypt = renderQrDataUrl.mock.calls.length

    await user.click(within(result).getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Encryption complete" }),
      ).not.toBeInTheDocument()
    })
    await user.type(screen.getByLabelText("Plaintext"), "fresh transfer")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    const freshResult = await screen.findByRole("dialog", {
      name: "Encryption complete",
    })
    await waitFor(() =>
      expect(renderQrDataUrl.mock.calls.length).toBeGreaterThan(
        renderCallsBeforeReencrypt,
      ),
    )

    expect(splitIntoFrames).toHaveBeenCalledTimes(2)
    await user.click(within(freshResult).getByRole("button", { name: "Pause" }))
    const freshPayload = renderQrDataUrl.mock.calls.at(-1)?.[0]
    expect(freshPayload).toMatch(/^OCF2:/)
    expect(freshPayload!.split(":")[1]).not.toBe(initialTransferId)
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
    const {
      frameIndex: compatibleFrameIndex,
      frameCount: compatibleFrameCount,
      artifactType: compatibleArtifactType,
    } = decodeFramePayload(renderQrDataUrl.mock.calls[renderCallsBeforeResolve]![0])
    expect({
      frameIndex: compatibleFrameIndex,
      frameCount: compatibleFrameCount,
      artifactType: compatibleArtifactType,
    }).toEqual({
      frameIndex: 0,
      frameCount: compatibleFrames.length,
      artifactType: "pq-message",
    })
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

  it("F1 keeps every encryption entry point closed while crypto is in flight", async () => {
    const user = userEvent.setup()
    const defaultEncryptWithAesKey = encryptWithAesKey.getMockImplementation()!
    const pendingEncryption =
      deferred<Awaited<ReturnType<typeof defaultEncryptWithAesKey>>>()
    encryptWithAesKey.mockReturnValueOnce(pendingEncryption.promise)
    await renderApp("/encrypt")
    await chooseSelectOption(user, "Key", "共通鍵A")
    await user.type(screen.getByLabelText("Plaintext"), "single-flight encryption")
    await user.click(screen.getByRole("button", { name: "Encrypt" }))
    await waitFor(() => expect(encryptWithAesKey).toHaveBeenCalledOnce())

    // Decryption now lives on its own route, so a second operation cannot be
    // started from here at all; what this asserts is that the encrypt page
    // refuses to start a second encryption over the first.
    const busyState = {
      plaintextDisabled: screen.getByLabelText("Plaintext").hasAttribute("disabled"),
      encryptDisabled: screen
        .getByRole("button", { name: "Encrypting…" })
        .hasAttribute("disabled"),
      clearDisabled: screen
        .getByRole("button", { name: "Clear plaintext" })
        .hasAttribute("disabled"),
    }

    const encryptionArgs = encryptWithAesKey.mock.calls[0]![0]
    const encrypted = await defaultEncryptWithAesKey(encryptionArgs)
    await act(async () => {
      pendingEncryption.resolve(encrypted)
      await pendingEncryption.promise
    })
    await screen.findByRole("dialog", { name: "Encryption complete" })
    expect(encryptWithAesKey).toHaveBeenCalledOnce()

    expect(busyState).toEqual({
      plaintextDisabled: true,
      encryptDisabled: true,
      clearDisabled: true,
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
