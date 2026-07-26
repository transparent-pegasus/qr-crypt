import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const scanStart = vi.hoisted(() => vi.fn())
const scanStop = vi.hoisted(() => vi.fn())
const copyText = vi.hoisted(() => vi.fn(async () => undefined))
const renderQr = vi.hoisted(() => vi.fn())

vi.mock("@/qr/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/decode")>()),
  startQrScan: scanStart,
}))

vi.mock("@/qr/export-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/export-image")>()),
  copyTextToClipboard: copyText,
}))

vi.mock("@/qr/encode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/encode")>()),
  renderQrDataUrl: renderQr,
}))

vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: () => ({ offlineReady: [false, vi.fn()] }),
}))

import { FeatureSupportProvider } from "@/app/providers"
import {
  OnlineRelay,
  parseRelayFrameSet,
  parseRelayText,
  RELAY_TEXT_MAX_CHARS,
} from "@/components/online-relay"
import { encodePublicIdentityBundleV2 } from "@/crypto/pq/canonical-cbor"
import { LanguageProvider } from "@/i18n"
import {
  FRAME_BYTES_MAX,
  PROTOCOL_MAX_FRAMES,
  TRANSFER_TIMEOUT_MINUTES_DEFAULT,
} from "@/lib/limits"
import { TransferAssembler } from "@/qr/multipart/assemble"
import { splitIntoFrames } from "@/qr/multipart/split"
import { decodeFramePayload, encodeFrameToPayload } from "@/qr/payload-v2"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"

const TRANSFER_ID = new Uint8Array(16).fill(0x11)
const PAYLOAD_HASH = new Uint8Array(32).fill(0x22)

function frame(frameIndex: number, overrides: Partial<QrFrameV2> = {}): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: Uint8Array.from(TRANSFER_ID),
    artifactType: "pq-message",
    frameIndex,
    frameCount: 2,
    totalByteLength: 2,
    payloadSha256: Uint8Array.from(PAYLOAD_HASH),
    chunk: new Uint8Array([frameIndex + 1]),
    ...overrides,
  }
}

function payload(frameIndex: number, overrides: Partial<QrFrameV2> = {}): string {
  return encodeFrameToPayload(frame(frameIndex, overrides))
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function playbackPayloads(marker: number): readonly [string, string] {
  const overrides = {
    transferId: new Uint8Array(16).fill(marker),
    payloadSha256: new Uint8Array(32).fill(marker),
  } satisfies Partial<QrFrameV2>
  return [payload(0, overrides), payload(1, overrides)]
}

function dataUrl(value: string): string {
  return `data:image/png;base64,${btoa(value)}`
}

function deferPreflight(render: Deferred<string>): void {
  renderQr
    .mockImplementationOnce(() => render.promise)
    .mockImplementationOnce(() => render.promise)
}

// Relay payloads are ~500 characters each. Typing them keystroke by keystroke
// costs one React render per character and pushed the slowest cases past the
// 5s default timeout on CI runners; a paste is one event and is also how relay
// text actually arrives.
async function enterRelayText(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  text: string,
): Promise<void> {
  await user.click(input)
  await user.paste(text)
}

function relayElement(props: Partial<React.ComponentProps<typeof OnlineRelay>> = {}) {
  return (
    <LanguageProvider initialLanguage="en">
      <FeatureSupportProvider
        features={{
          webCrypto: true,
          indexedDb: true,
          camera: true,
          serviceWorker: true,
        }}
      >
        <OnlineRelay eligible {...props} />
      </FeatureSupportProvider>
    </LanguageProvider>
  )
}

function renderRelay(props: Partial<React.ComponentProps<typeof OnlineRelay>> = {}) {
  return render(relayElement(props))
}

let scanText: ((text: string) => void) | null
let scanFailure: ((error: import("@/crypto/errors").AppError) => void) | null
let scanSignal: AbortSignal | undefined

beforeEach(() => {
  scanText = null
  scanFailure = null
  scanSignal = undefined
  renderQr.mockImplementation(async (value: string) => dataUrl(value))
  scanStart.mockImplementation(
    async (
      _video: HTMLVideoElement,
      onText: (text: string) => void,
      onError: (error: import("@/crypto/errors").AppError) => void,
      options?: { signal?: AbortSignal },
    ) => {
      scanText = onText
      scanFailure = onError
      scanSignal = options?.signal
      return { stop: scanStop }
    },
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  // reset, not clear: clearAllMocks leaves queued mockImplementationOnce
  // entries behind, so a test that fails mid-flight hands its unconsumed
  // deferred renders to the next test. beforeEach reinstalls both defaults.
  vi.resetAllMocks()
})

describe("relay frame-set parser", () => {
  it("joins out-of-order frames in index order and treats exact duplicates idempotently", () => {
    const first = payload(0)
    const second = payload(1)
    const parsed = parseRelayFrameSet([second, first, second])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.set.entries.keys()].sort()).toEqual([0, 1])

    const text = `${second}\r\n${first}\r\n`
    const roundTrip = parseRelayText(text)
    expect(roundTrip).toMatchObject({ ok: true })
    if (!roundTrip.ok) return
    expect(roundTrip.originals).toEqual([first, second])
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual([first, second])
  })

  it.each([
    ["OCP2:", "OCP2:AA"],
    ["OCS2:", "OCS2:AA"],
    ["OCI2:", "OCI2:AA"],
    ["OCM2:", "OCM2:AA"],
    ["v1", "OCM1:AA"],
    ["foreign", "https://example.invalid/"],
  ])("rejects the non-OCF2 %s prefix without changing state", (_label, input) => {
    const initial = parseRelayFrameSet([payload(0)])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(parseRelayFrameSet([input], initial.set)).toEqual({
      ok: false,
      code: "prefix",
    })
    expect(initial.set.entries.size).toBe(1)
  })

  it.each([
    "pq-kem-public-key",
    "pq-dsa-public-key",
    "pq-public-identity",
    "encrypted-seed-backup",
  ] satisfies V2ArtifactType[])("rejects outer artifact type %s", (artifactType) => {
    expect(parseRelayFrameSet([payload(0, { artifactType })])).toEqual({
      ok: false,
      code: "outer-type",
    })
  })

  it.each([
    [
      "transferId",
      {
        transferId: new Uint8Array(16).fill(0x33),
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    [
      "artifactType",
      {
        artifactType: "pq-public-identity",
      } satisfies Partial<QrFrameV2>,
      "outer-type",
    ],
    [
      "frameCount",
      {
        frameCount: 3,
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    [
      "totalByteLength",
      {
        totalByteLength: 3,
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    [
      "payloadSha256",
      {
        payloadSha256: new Uint8Array(32).fill(0x44),
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
  ] as const)("rejects a %s metadata mismatch atomically", (_label, overrides, code) => {
    const initial = parseRelayFrameSet([payload(0)])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const before = initial.set
    const result = parseRelayFrameSet([payload(1), payload(1, overrides)], before)
    expect(result).toEqual({ ok: false, code })
    expect(before.entries.size).toBe(1)
    expect(before.receivedByteLength).toBe(1)
  })

  it("rejects a conflicting occupied index without overwriting it", () => {
    const original = payload(0)
    const initial = parseRelayFrameSet([original])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const conflict = payload(0, { chunk: new Uint8Array([0x7f]) })
    expect(parseRelayFrameSet([conflict], initial.set)).toEqual({
      ok: false,
      code: "mismatch",
    })
    expect(initial.set.entries.get(0)?.original).toBe(original)
  })

  it.each([
    [
      "declared total above frame capacity",
      [payload(0, { totalByteLength: FRAME_BYTES_MAX * 2 + 1 })],
    ],
    [
      "single-frame chunk/total mismatch",
      [
        payload(0, {
          frameCount: 1,
          frameIndex: 0,
          totalByteLength: 2,
          chunk: new Uint8Array([1]),
        }),
      ],
    ],
    [
      "running sum above a too-small total",
      [payload(0, { totalByteLength: 1 }), payload(1, { totalByteLength: 1 })],
    ],
    [
      "completed sum below a declared total",
      [payload(0, { totalByteLength: 3 }), payload(1, { totalByteLength: 3 })],
    ],
  ])("rejects %s", (_label, inputs) => {
    expect(parseRelayFrameSet(inputs)).toEqual({
      ok: false,
      code: "length",
    })
  })

  it("rejects 129 non-empty lines and oversized raw text before decoding", () => {
    const valid = payload(0)
    expect(
      parseRelayText(
        Array.from({ length: PROTOCOL_MAX_FRAMES + 1 }, () => valid).join("\n"),
      ),
    ).toEqual({
      ok: false,
      code: "frame-count",
    })
    expect(parseRelayText("x".repeat(RELAY_TEXT_MAX_CHARS + 1))).toEqual({
      ok: false,
      code: "input-size",
    })
    expect(PROTOCOL_MAX_FRAMES).toBe(128)
    expect(RELAY_TEXT_MAX_CHARS).toBe(213_120)
  })

  it("accepts header-declared message frames around a public artifact but the offline assembler rejects the inner type", async () => {
    const keyId = "AAECAwQFBgcICQoLDA0ODw"
    const publicArtifact = encodePublicIdentityBundleV2({
      version: 2,
      type: "pq-public-identity",
      identityId: keyId,
      kem: {
        algorithm: "ML-KEM-1024",
        keyId,
        publicKey: new Uint8Array(1_568).fill(0x51),
      },
      signing: {
        algorithm: "ML-DSA-87",
        keyId,
        publicKey: new Uint8Array(2_592).fill(0x52),
      },
      createdAt: 1_700_000_000_000,
    })
    const relabeledFrames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: publicArtifact,
      frameBytes: 200,
    })
    const originals = relabeledFrames.map(encodeFrameToPayload)
    expect(parseRelayFrameSet(originals).ok).toBe(true)
    const roundTrip = parseRelayText(originals.join("\n"))
    expect(roundTrip.ok).toBe(true)
    if (!roundTrip.ok) return
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual(originals)
    expect(roundTrip.originals).toEqual(originals)

    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    let state = assembler.state()
    for (const original of originals) state = await assembler.add(original)
    expect(state).toEqual({ kind: "error", code: "INVALID_QR_PAYLOAD" })
  })
})

describe("online relay UI", () => {
  it("keeps both scrolling dialog bodies bounded with one trailing close and Escape dismissal", async () => {
    renderRelay()
    const user = userEvent.setup()

    for (const [triggerName, dialogName] of [
      ["QR → text", "QR frames to text"],
      ["Text → QR", "Turn relay text into QR frames"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: triggerName }))
      const dialog = await screen.findByRole("dialog", { name: dialogName })
      expect(dialog).toHaveClass(
        "grid",
        "grid-rows-[minmax(0,1fr)_auto]",
        "overflow-hidden",
      )
      expect(dialog.firstElementChild).toHaveClass(
        "min-h-0",
        "overflow-y-auto",
      )
      const closeControls = within(dialog).getAllByRole("button", {
        name: "Close",
      })
      expect(closeControls).toHaveLength(1)
      expect(Array.from(dialog.querySelectorAll("button")).at(-1)).toBe(
        closeControls[0],
      )

      await user.keyboard("{Escape}")
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    }
  })

  it("keeps relay playback on its own 1000 millisecond dwell without a compatibility switch", async () => {
    const timeout = vi.spyOn(window, "setTimeout")
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(
      user,
      screen.getByLabelText("Relay text"),
      `${payload(0)}\n${payload(1)}`,
    )
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))

    await screen.findByRole("img")
    await waitFor(() =>
      expect(timeout.mock.calls.some(([, delay]) => delay === 1_000)).toBe(true),
    )
    expect(
      screen.queryByRole("switch", { name: "Compatibility mode" }),
    ).toBeNull()
  })

  it("is absent when ineligible and requests no camera on mount or dialog open", async () => {
    const { rerender } = render(
      <LanguageProvider initialLanguage="en">
        <FeatureSupportProvider
          features={{
            webCrypto: true,
            indexedDb: true,
            camera: true,
            serviceWorker: true,
          }}
        >
          <OnlineRelay eligible={false} />
        </FeatureSupportProvider>
      </LanguageProvider>,
    )
    expect(screen.queryByText("OCF2 message-header QR relay")).not.toBeInTheDocument()
    expect(scanStart).not.toHaveBeenCalled()

    rerender(
      <LanguageProvider initialLanguage="en">
        <FeatureSupportProvider
          features={{
            webCrypto: true,
            indexedDb: true,
            camera: true,
            serviceWorker: true,
          }}
        >
          <OnlineRelay eligible />
        </FeatureSupportProvider>
      </LanguageProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(scanStart).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(scanStart).toHaveBeenCalledOnce()
  })

  it("keeps scanning after a mismatch and emits exact sorted text", async () => {
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    const first = payload(0)
    const second = payload(1)
    const hostile = payload(0, {
      transferId: new Uint8Array(16).fill(0x66),
    })

    act(() => scanText?.(second))
    act(() => scanText?.(second))
    act(() => scanText?.(hostile))
    expect(
      screen.getByText("The frame does not belong to the accepted frame set."),
    ).toBeInTheDocument()
    act(() => scanText?.(first))

    const output = screen.getByLabelText("Relay text")
    expect(output).toHaveValue(`${first}\n${second}`)
    expect(scanStop).toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Copy relay text" }))
    expect(copyText).toHaveBeenCalledWith(`${first}\n${second}`)
  })

  it.each([
    ["OCP2", "OCP2:AA", "Only canonical OCF2 frame strings are accepted."],
    ["OCS2", "OCS2:AA", "Only canonical OCF2 frame strings are accepted."],
    ["OCI2", "OCI2:AA", "Only canonical OCF2 frame strings are accepted."],
    ["OCM2", "OCM2:AA", "Only canonical OCF2 frame strings are accepted."],
    ["v1", "OCM1:AA", "Only canonical OCF2 frame strings are accepted."],
    [
      "foreign",
      "https://example.invalid/",
      "Only canonical OCF2 frame strings are accepted.",
    ],
    [
      "pq-kem-public-key",
      payload(1, { artifactType: "pq-kem-public-key" }),
      "The frame's outer header does not declare pq-message.",
    ],
    [
      "pq-dsa-public-key",
      payload(1, { artifactType: "pq-dsa-public-key" }),
      "The frame's outer header does not declare pq-message.",
    ],
    [
      "pq-public-identity",
      payload(1, { artifactType: "pq-public-identity" }),
      "The frame's outer header does not declare pq-message.",
    ],
    [
      "encrypted-seed-backup",
      payload(1, { artifactType: "encrypted-seed-backup" }),
      "The frame's outer header does not declare pq-message.",
    ],
  ])(
    "shows a fixed %s rejection without changing accepted capture progress",
    async (_label, hostile, expectedError) => {
      renderRelay()
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "QR → text" }))
      await user.click(screen.getByRole("button", { name: "Start camera" }))
      act(() => scanText?.(payload(0)))
      act(() => scanText?.(hostile))

      expect(screen.getByText(expectedError)).toBeInTheDocument()
      expect(screen.getByText("1 / 2 frames collected")).toBeInTheDocument()
      expect(scanStop).not.toHaveBeenCalled()
    },
  )

  it.each(["close", "pagehide", "hidden", "unmount"] as const)(
    "aborts startup and stops a live camera on %s",
    async (event) => {
      const rendered = renderRelay()
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "QR → text" }))
      await user.click(screen.getByRole("button", { name: "Start camera" }))
      await waitFor(() => expect(scanStart).toHaveBeenCalledOnce())
      await waitFor(() => expect(scanStop).not.toHaveBeenCalled())

      if (event === "close") {
        await user.click(screen.getByRole("button", { name: "Close" }))
      } else if (event === "pagehide") {
        act(() => window.dispatchEvent(new Event("pagehide")))
      } else if (event === "hidden") {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        })
        act(() => document.dispatchEvent(new Event("visibilitychange")))
      } else {
        rendered.unmount()
      }

      expect(scanSignal?.aborted).toBe(true)
      expect(scanStop).toHaveBeenCalled()
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      })
    },
  )

  it("aborts a pending camera acquisition on close", async () => {
    scanStart.mockImplementationOnce(
      (
        _video: HTMLVideoElement,
        _onText: (text: string) => void,
        _onError: (error: import("@/crypto/errors").AppError) => void,
        options?: { signal?: AbortSignal },
      ) => {
        scanSignal = options?.signal
        return new Promise(() => undefined)
      },
    )
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(scanSignal?.aborted).toBe(true)
    expect(scanStop).not.toHaveBeenCalled()
  })

  it("ends a live session on a terminal camera error", async () => {
    const { AppError } = await import("@/crypto/errors")
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    act(() => scanFailure?.(new AppError("CAMERA_NOT_AVAILABLE")))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText("The camera is unavailable.")).toBeInTheDocument()
    expect(scanSignal?.aborted).toBe(true)
    expect(scanStop).toHaveBeenCalled()
  })

  it("starts empty after a persisted BFCache pageshow and never reacquires automatically", async () => {
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    const callsBeforePageShow = scanStart.mock.calls.length
    act(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(scanStart).toHaveBeenCalledTimes(callsBeforePageShow)
    expect(scanStop).toHaveBeenCalled()
  })

  it("stops a live camera through the peer boundary before its barrier", async () => {
    let boundary:
      | ((reason: import("@/app/boot/boot-controller").RelaySessionEndReason) => void)
      | undefined
    const order: string[] = []
    scanStop.mockImplementationOnce(() => {
      order.push("camera-stop")
    })
    renderRelay({
      registerRelaySessionEndHandler(handler) {
        boundary = handler
        return () => {
          boundary = undefined
        }
      },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    act(() => {
      boundary?.("peer-wipe")
      order.push("barrier")
    })
    expect(scanSignal?.aborted).toBe(true)
    expect(scanStop).toHaveBeenCalled()
    expect(order).toEqual(["camera-stop", "barrier"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("aborts pending camera startup through the local boundary before its barrier", async () => {
    let boundary:
      | ((reason: import("@/app/boot/boot-controller").RelaySessionEndReason) => void)
      | undefined
    const order: string[] = []
    scanStart.mockImplementationOnce(
      (
        _video: HTMLVideoElement,
        _onText: (text: string) => void,
        _onError: (error: import("@/crypto/errors").AppError) => void,
        options?: { signal?: AbortSignal },
      ) => {
        scanSignal = options?.signal
        scanSignal?.addEventListener("abort", () => order.push("camera-abort"), {
          once: true,
        })
        return new Promise(() => undefined)
      },
    )
    renderRelay({
      registerRelaySessionEndHandler(handler) {
        boundary = handler
        return () => {
          boundary = undefined
        }
      },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))

    act(() => {
      boundary?.("local-wipe")
      order.push("barrier")
    })

    expect(scanSignal?.aborted).toBe(true)
    expect(order).toEqual(["camera-abort", "barrier"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it.each(["local-wipe", "peer-wipe"] as const)(
    "stops the settled scanner handoff through the %s boundary before its barrier",
    async (reason) => {
      let boundary:
        | ((reason: import("@/app/boot/boot-controller").RelaySessionEndReason) => void)
        | undefined
      let settleStartup: (() => void) | undefined
      const order: string[] = []
      scanStart.mockImplementationOnce(
        async (
          _video: HTMLVideoElement,
          _onText: (text: string) => void,
          _onError: (error: import("@/crypto/errors").AppError) => void,
          options?: { signal?: AbortSignal },
        ) => {
          scanSignal = options?.signal
          let stopped = false
          const handle = {
            stop() {
              if (stopped) return
              stopped = true
              scanSignal?.removeEventListener("abort", onAbort)
              scanStop()
              order.push("handle-stop")
            },
          }
          const onAbort = () => handle.stop()
          scanSignal?.addEventListener("abort", onAbort, { once: true })
          await new Promise<void>((resolve) => {
            settleStartup = resolve
          })
          return handle
        },
      )
      renderRelay({
        registerRelaySessionEndHandler(handler) {
          boundary = handler
          return () => {
            boundary = undefined
          }
        },
      })
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "QR → text" }))
      await user.click(screen.getByRole("button", { name: "Start camera" }))
      expect(settleStartup).toBeDefined()

      await act(async () => {
        // Resolving the scanner's inner await queues its return. Queuing the boundary
        // next puts it ahead of OnlineRelay's `.then`, which that return queues later.
        settleStartup?.()
        await new Promise<void>((resolve) => {
          queueMicrotask(() => {
            boundary?.(reason)
            order.push("barrier")
            resolve()
          })
        })
      })

      expect(scanSignal?.aborted).toBe(true)
      expect(scanStop).toHaveBeenCalledOnce()
      expect(order).toEqual(["handle-stop", "barrier"])
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    },
  )

  it("does not reopen after pagehide while an open-time proof is pending", async () => {
    let resolveRefresh: ((eligible: boolean) => void) | undefined
    const onEligibilityRefresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    renderRelay({ onEligibilityRefresh })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    expect(onEligibilityRefresh).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new Event("pagehide")))
    await act(async () => resolveRefresh?.(true))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(scanStart).not.toHaveBeenCalled()
  })

  it("stops both camera paths synchronously on eligibility loss", async () => {
    const rendered = renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "QR → text" }))
    await user.click(screen.getByRole("button", { name: "Start camera" }))

    rendered.rerender(relayElement({ eligible: false }))

    expect(scanSignal?.aborted).toBe(true)
    expect(scanStop).toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("clears capture state at the fixed transfer timeout", async () => {
    vi.useFakeTimers()
    renderRelay()
    act(() => {
      screen.getByRole("button", { name: "QR → text" }).click()
    })
    await act(async () => undefined)
    act(() => {
      screen.getByRole("button", { name: "Start camera" }).click()
    })
    await act(async () => undefined)
    act(() => scanText?.(payload(0)))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSFER_TIMEOUT_MINUTES_DEFAULT * 60_000)
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "The relay session timed out and its app-held frame references were cleared.",
      ),
    ).toBeInTheDocument()
    expect(scanStop).toHaveBeenCalled()
  })

  it("keeps a newer playback when an older render succeeds afterward", async () => {
    const olderRender = deferred<string>()
    const newerRender = deferred<string>()
    deferPreflight(olderRender)
    deferPreflight(newerRender)
    const [olderFirst, olderSecond] = playbackPayloads(0x31)
    const [newerFirst, newerSecond] = playbackPayloads(0x32)
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    const input = screen.getByLabelText("Relay text")

    await enterRelayText(user, input, `${olderFirst}\n${olderSecond}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    expect(renderQr).toHaveBeenCalledTimes(2)
    await user.clear(input)
    await enterRelayText(user, input, `${newerFirst}\n${newerSecond}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    expect(renderQr).toHaveBeenCalledTimes(4)

    await act(async () => {
      newerRender.resolve("newer-preflight")
      await newerRender.promise
    })
    expect(await screen.findByRole("img")).toHaveAttribute("src", dataUrl(newerFirst))

    await act(async () => {
      olderRender.resolve("older-preflight")
      await olderRender.promise
    })
    expect(screen.getByRole("img")).toHaveAttribute("src", dataUrl(newerFirst))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("keeps a newer playback when an older render rejects afterward", async () => {
    const olderRender = deferred<string>()
    const newerRender = deferred<string>()
    deferPreflight(olderRender)
    deferPreflight(newerRender)
    const [olderFirst, olderSecond] = playbackPayloads(0x41)
    const [newerFirst, newerSecond] = playbackPayloads(0x42)
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    const input = screen.getByLabelText("Relay text")

    await enterRelayText(user, input, `${olderFirst}\n${olderSecond}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    await user.clear(input)
    await enterRelayText(user, input, `${newerFirst}\n${newerSecond}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))

    await act(async () => {
      newerRender.resolve("newer-preflight")
      await newerRender.promise
    })
    expect(await screen.findByRole("img")).toHaveAttribute("src", dataUrl(newerFirst))

    await act(async () => {
      olderRender.reject(new Error("stale render failure"))
      await olderRender.promise.catch(() => undefined)
    })
    expect(screen.getByRole("img")).toHaveAttribute("src", dataUrl(newerFirst))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(
      screen.queryByText(
        "There is too much data to generate a QR code at this error-correction level.",
      ),
    ).not.toBeInTheDocument()
  })

  it("invalidates a pending playback render when the textarea is replaced", async () => {
    const pendingRender = deferred<string>()
    deferPreflight(pendingRender)
    const [first, second] = playbackPayloads(0x51)
    const [replacementFirst, replacementSecond] = playbackPayloads(0x52)
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    const input = screen.getByLabelText("Relay text")

    await enterRelayText(user, input, `${first}\n${second}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    await user.clear(input)
    await enterRelayText(user, input, `${replacementFirst}\n${replacementSecond}`)
    await act(async () => {
      pendingRender.resolve("stale-preflight")
      await pendingRender.promise
    })

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(
      screen.queryByText("This relay provides no app file-download controls."),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("ignores an old render rejection after closing and reopening playback", async () => {
    const closingRender = deferred<string>()
    const reopenedRender = deferred<string>()
    deferPreflight(closingRender)
    deferPreflight(reopenedRender)
    const [closingFirst, closingSecond] = playbackPayloads(0x61)
    const [reopenedFirst, reopenedSecond] = playbackPayloads(0x62)
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, 
      screen.getByLabelText("Relay text"),
      `${closingFirst}\n${closingSecond}`,
    )
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, 
      screen.getByLabelText("Relay text"),
      `${reopenedFirst}\n${reopenedSecond}`,
    )
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    await act(async () => {
      reopenedRender.resolve("reopened-preflight")
      await reopenedRender.promise
    })
    expect(await screen.findByRole("img")).toHaveAttribute("src", dataUrl(reopenedFirst))

    await act(async () => {
      closingRender.reject(new Error("closed render failure"))
      await closingRender.promise.catch(() => undefined)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("img")).toHaveAttribute("src", dataUrl(reopenedFirst))
    expect(
      screen.queryByText(
        "There is too much data to generate a QR code at this error-correction level.",
      ),
    ).not.toBeInTheDocument()
  })

  it("ignores a deferred render rejection after pagehide", async () => {
    const pendingRender = deferred<string>()
    deferPreflight(pendingRender)
    const [first, second] = playbackPayloads(0x71)
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, screen.getByLabelText("Relay text"), `${first}\n${second}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))

    act(() => window.dispatchEvent(new Event("pagehide")))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await act(async () => {
      pendingRender.reject(new Error("pagehide render failure"))
      await pendingRender.promise.catch(() => undefined)
    })

    expect(
      screen.queryByText(
        "There is too much data to generate a QR code at this error-correction level.",
      ),
    ).not.toBeInTheDocument()
    expect(screen.getByText("OCF2 message-header QR relay")).toBeInTheDocument()
  })

  it("ignores a deferred render rejection after eligibility loss", async () => {
    const pendingRender = deferred<string>()
    deferPreflight(pendingRender)
    const [first, second] = playbackPayloads(0x81)
    const rendered = renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, screen.getByLabelText("Relay text"), `${first}\n${second}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))

    rendered.rerender(relayElement({ eligible: false }))
    expect(screen.queryByText("OCF2 message-header QR relay")).not.toBeInTheDocument()
    await act(async () => {
      pendingRender.reject(new Error("ineligible render failure"))
      await pendingRender.promise.catch(() => undefined)
    })
    rendered.rerender(relayElement({ eligible: true }))

    expect(screen.getByText("OCF2 message-header QR relay")).toBeInTheDocument()
    expect(
      screen.queryByText(
        "There is too much data to generate a QR code at this error-correction level.",
      ),
    ).not.toBeInTheDocument()
  })

  it("accepts CRLF playback without exposing app file-download controls", async () => {
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    const first = payload(0)
    const second = payload(1)
    await enterRelayText(user, screen.getByLabelText("Relay text"), `${second}\r\n${first}\r\n`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    expect(
      await screen.findByText("This relay provides no app file-download controls."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull()
    expect(screen.queryByRole("button", { name: /SVG/i })).toBeNull()
    expect(decodeFramePayload(first).frameIndex).toBe(0)
  })

  it("reports missing playback indexes without changing the fixed rejection", async () => {
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, screen.getByLabelText("Relay text"), payload(1))
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))

    expect(
      screen.getByText(
        "The frame set is incomplete. Add every missing frame before playback.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("Missing frames: frame 1")).toBeInTheDocument()
  })

  it("treats QR render failure as terminal and clears playback state", async () => {
    renderQr.mockRejectedValueOnce(new Error("hostile render detail"))
    renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, screen.getByLabelText("Relay text"), `${payload(0)}\n${payload(1)}`)
    await user.click(screen.getByRole("button", { name: "Show QR frames" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "There is too much data to generate a QR code at this error-correction level.",
      ),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("hostile render detail")
  })
})
