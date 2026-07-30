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
import {
  OCK1_SYMMETRIC_KEY,
  OCM1_MESSAGE_33,
  OCM1_MESSAGE_44,
} from "../fixtures/relay-v1"
import { deferred, type Deferred } from "../helpers/deferred"

const scanStart = vi.hoisted(() => vi.fn())
const scanStop = vi.hoisted(() => vi.fn())
const copyText = vi.hoisted(() => vi.fn(async () => undefined))
const renderQr = vi.hoisted(() => vi.fn())
const probeWebAssemblyRuntime = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>(),
)
const readerModuleState = vi.hoisted(() =>
  vi.fn<() => "idle" | "preparing" | "ready" | "failed">(),
)
const warmQrReader = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock("@/qr/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/decode")>()),
  readerModuleState,
  startQrScan: scanStart,
  warmQrReader,
}))

vi.mock("@/qr/export-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/export-image")>()),
  copyTextToClipboard: copyText,
}))

vi.mock("@/qr/encode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/encode")>()),
  renderQrDataUrl: renderQr,
}))

vi.mock("@/lib/feature-detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feature-detect")>()),
  probeWebAssemblyRuntime,
}))

vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: () => ({ offlineReady: [false, vi.fn()] }),
}))

import { FeatureSupportProvider } from "@/app/providers"
import { OnlineRelay } from "@/components/online-relay"
import { LanguageProvider } from "@/i18n"
import { translate } from "@/i18n/messages"
import { TRANSFER_TIMEOUT_MINUTES_DEFAULT } from "@/lib/limits"
import { decodeFramePayload, encodeFrameToPayload } from "@/qr/payload-v2"
import type { QrFrameV2 } from "@/schemas/domain"

const TRANSFER_ID = new Uint8Array(16).fill(0x11)

function frame(frameIndex: number, overrides: Partial<QrFrameV2> = {}): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: Uint8Array.from(TRANSFER_ID),
    artifactType: "pq-message",
    frameIndex,
    frameCount: 2,
    totalByteLength: 2,
    chunk: new Uint8Array([frameIndex + 1]),
    ...overrides,
  }
}

function payload(frameIndex: number, overrides: Partial<QrFrameV2> = {}): string {
  return encodeFrameToPayload(frame(frameIndex, overrides))
}

async function startCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: translate("en", "relay.capture.open") }),
  )
  await user.click(
    await screen.findByRole("button", {
      name: translate("en", "relay.capture.startCamera"),
    }),
  )
  await waitFor(() => expect(scanText).not.toBeNull())
}

function playbackPayloads(marker: number): readonly [string, string] {
  const overrides = {
    transferId: new Uint8Array(16).fill(marker),
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
  probeWebAssemblyRuntime.mockResolvedValue(true)
  readerModuleState.mockReturnValue("ready")
  warmQrReader.mockImplementation(() => Promise.resolve())
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

describe("online relay UI", () => {
  it("does not pull the reader before the user opens capture, then gates the camera on it", async () => {
    readerModuleState.mockReturnValue("idle")
    const preparation = deferred<void>()
    warmQrReader.mockReturnValueOnce(preparation.promise)
    const user = userEvent.setup()
    renderRelay()

    // The online gate must not fetch the reader at runtime until the user asks
    // for the camera; tests/e2e/offline-pwa.spec.ts pins that as a contract.
    expect(warmQrReader).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.capture.open"),
      }),
    )
    expect(warmQrReader).toHaveBeenCalled()

    const startCamera = await screen.findByRole("button", {
      name: translate("en", "relay.capture.startCamera"),
    })
    expect(startCamera).toBeDisabled()
    expect(scanStart).not.toHaveBeenCalled()

    await act(async () => preparation.resolve())

    await waitFor(() => expect(startCamera).toBeEnabled())
    expect(scanStart).not.toHaveBeenCalled()
  })

  it("shows preparation failure and reload inside the open capture dialog", async () => {
    readerModuleState.mockReturnValue("idle")
    const preparation = deferred<void>()
    void preparation.promise.catch(() => undefined)
    warmQrReader.mockReturnValueOnce(preparation.promise)
    const user = userEvent.setup()
    renderRelay()

    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.capture.open"),
      }),
    )
    const dialog = await screen.findByRole("dialog", {
      name: translate("en", "relay.capture.title"),
    })
    expect(
      within(dialog).getByText(
        translate("en", "scanner.status.readerLoading"),
      ),
    ).toBeInTheDocument()

    await act(async () => {
      preparation.reject(new Error("reader preparation failed"))
      await preparation.promise.catch(() => undefined)
    })

    await waitFor(() =>
      expect(
        within(dialog).getByText(
          translate("en", "scanner.reader.reloadHint"),
        ),
      ).toBeInTheDocument(),
    )
    expect(
      within(dialog).getByRole("button", {
        name: translate("en", "scanner.button.reload"),
      }),
    ).toBeEnabled()
    expect(scanStart).not.toHaveBeenCalled()
  })

  it("keeps one trailing close and Escape dismissal in both dialogs", async () => {
    renderRelay()
    const user = userEvent.setup()

    for (const [triggerName, dialogName] of [
      ["QR → text", translate("en", "relay.capture.title")],
      ["Text → QR", translate("en", "relay.playback.title")],
    ] as const) {
      await user.click(screen.getByRole("button", { name: triggerName }))
      const dialog = await screen.findByRole("dialog", { name: dialogName })
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )

    await screen.findByRole("img")
    await waitFor(() =>
      expect(timeout.mock.calls.some(([, delay]) => delay === 1_000)).toBe(true),
    )
    expect(
      screen.queryByRole("switch", { name: "Compatibility mode" }),
    ).toBeNull()
  })

  it("renders exactly one QR for a pasted OCM1 message, with no transport controls", async () => {
    const user = userEvent.setup()
    renderQr.mockResolvedValue(dataUrl("ocm1"))
    renderRelay()
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.open") }),
    )

    const message = OCM1_MESSAGE_33
    await enterRelayText(
      user,
      await screen.findByLabelText(translate("en", "relay.playback.input.label")),
      message,
    )
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.show") }),
    )

    await waitFor(() =>
      expect(renderQr).toHaveBeenCalledWith(
        message,
        expect.objectContaining({ ecLevel: "Q" }),
      ),
    )
    const images = await screen.findAllByRole("img")
    expect(images).toHaveLength(1)
    for (const control of ["animatedQr.prev", "animatedQr.next", "animatedQr.pause", "animatedQr.play"] as const) {
      expect(
        screen.queryByRole("button", { name: translate("en", control) }),
      ).toBeNull()
    }
    expect(
      screen.getByText(translate("en", "relay.playback.noDownloadControls")),
    ).toBeInTheDocument()
  })

  it("refuses relay text that mixes an OCM1 message with a frame", async () => {
    const user = userEvent.setup()
    renderRelay()
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.open") }),
    )

    await enterRelayText(
      user,
      await screen.findByLabelText(translate("en", "relay.playback.input.label")),
      `${OCM1_MESSAGE_44}\n${payload(0)}`,
    )
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.show") }),
    )

    expect(
      await screen.findByText(translate("en", "relay.error.kindMismatch")),
    ).toBeInTheDocument()
    expect(renderQr).not.toHaveBeenCalled()
  })

  it("reports a second OCM1 message as a cardinality error", async () => {
    const user = userEvent.setup()
    renderRelay()
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.open") }),
    )

    await enterRelayText(
      user,
      await screen.findByLabelText(translate("en", "relay.playback.input.label")),
      `${OCM1_MESSAGE_33}\n${OCM1_MESSAGE_44}`,
    )
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.show") }),
    )

    expect(
      await screen.findByText(translate("en", "relay.error.messageCount")),
    ).toBeInTheDocument()
    expect(renderQr).not.toHaveBeenCalled()
  })

  it("refuses a canonical OCK1 at playback and renders nothing", async () => {
    const user = userEvent.setup()
    renderRelay()
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.open") }),
    )

    await enterRelayText(
      user,
      await screen.findByLabelText(translate("en", "relay.playback.input.label")),
      OCK1_SYMMETRIC_KEY,
    )
    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.playback.show") }),
    )

    expect(
      await screen.findByText(translate("en", "relay.error.prefix")),
    ).toBeInTheDocument()
    expect(renderQr).not.toHaveBeenCalled()
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
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
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
    expect(
      screen.getByLabelText(translate("en", "relay.capture.video.ariaLabel")),
    ).toHaveAttribute("autoplay")
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
      screen.getByText(translate("en", "relay.error.mismatch")),
    ).toBeInTheDocument()
    act(() => scanText?.(first))

    const output = screen.getByLabelText("Relay text")
    expect(output).toHaveValue(`${first}\n${second}`)
    expect(scanStop).toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Copy relay text" }))
    expect(copyText).toHaveBeenCalledWith(`${first}\n${second}`)
  })

  it("completes capture from one OCM1 scan, stops the camera, and copies exactly that text", async () => {
    const user = userEvent.setup()
    renderRelay()
    await startCapture(user)

    const message = OCM1_MESSAGE_33
    act(() => scanText?.(message))

    const output = await screen.findByLabelText(
      translate("en", "relay.capture.output.label"),
    )
    expect(output).toHaveValue(message)
    expect(scanStop).toHaveBeenCalled()
    expect(
      screen.queryByText(/frames collected/),
    ).toBeNull()

    await user.click(
      screen.getByRole("button", { name: translate("en", "relay.capture.copy") }),
    )
    expect(copyText).toHaveBeenCalledWith(message)
  })

  it("refuses a frame after an OCM1 without discarding the message", async () => {
    const user = userEvent.setup()
    renderRelay()
    await startCapture(user)

    const message = OCM1_MESSAGE_33
    act(() => scanText?.(message))
    await screen.findByLabelText(translate("en", "relay.capture.output.label"))
    act(() => scanText?.(payload(0)))

    expect(
      await screen.findByText(translate("en", "relay.error.kindMismatch")),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(translate("en", "relay.capture.output.label")),
    ).toHaveValue(message)
  })

  it("refuses an OCM1 once a frame has been accepted", async () => {
    const user = userEvent.setup()
    renderRelay()
    await startCapture(user)

    act(() => scanText?.(payload(0)))
    await screen.findByText(
      translate("en", "relay.capture.progress", { collected: 1, total: 2 }),
    )
    act(() => scanText?.(OCM1_MESSAGE_44))

    expect(
      await screen.findByText(translate("en", "relay.error.kindMismatch")),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        translate("en", "relay.capture.progress", { collected: 1, total: 2 }),
      ),
    ).toBeInTheDocument()
  })

  it("refuses a malformed OCM1 with the message error and offers no output", async () => {
    const user = userEvent.setup()
    renderRelay()
    await startCapture(user)

    act(() => scanText?.("OCM1:AAAA"))

    expect(
      await screen.findByText(translate("en", "relay.error.invalidMessage")),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(translate("en", "relay.capture.output.label")),
    ).toBeNull()
    expect(copyText).not.toHaveBeenCalled()
  })

  it("clears captured message state when the session ends", async () => {
    const user = userEvent.setup()
    renderRelay()
    await startCapture(user)

    act(() => scanText?.(OCM1_MESSAGE_33))
    await screen.findByLabelText(translate("en", "relay.capture.output.label"))

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"))
    })

    await waitFor(() =>
      expect(
        screen.queryByLabelText(translate("en", "relay.capture.output.label")),
      ).toBeNull(),
    )
  })

  it.each([
    ["OCP2", "OCP2:AA", translate("en", "relay.error.prefix")],
    ["OCS2", "OCS2:AA", translate("en", "relay.error.prefix")],
    ["OCI2", "OCI2:AA", translate("en", "relay.error.prefix")],
    ["OCM2", "OCM2:AA", translate("en", "relay.error.prefix")],
    [
      "OCM1-after-frames",
      OCM1_MESSAGE_44,
      translate("en", "relay.error.kindMismatch"),
    ],
    [
      "malformed-OCM1-after-frames",
      "OCM1:AA",
      translate("en", "relay.error.invalidMessage"),
    ],
    ["OCK1", OCK1_SYMMETRIC_KEY, translate("en", "relay.error.prefix")],
    [
      "foreign",
      "https://example.invalid/",
      translate("en", "relay.error.prefix"),
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
      screen.getByText(translate("en", "relay.error.timeout")),
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
    expect(renderQr).toHaveBeenCalledTimes(2)
    await user.clear(input)
    await enterRelayText(user, input, `${newerFirst}\n${newerSecond}`)
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
    await user.clear(input)
    await enterRelayText(user, input, `${newerFirst}\n${newerSecond}`)
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )

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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, 
      screen.getByLabelText("Relay text"),
      `${reopenedFirst}\n${reopenedSecond}`,
    )
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )

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
    expect(
      screen.getByText(translate("en", "relay.card.title")),
    ).toBeInTheDocument()
  })

  it("ignores a deferred render rejection after eligibility loss", async () => {
    const pendingRender = deferred<string>()
    deferPreflight(pendingRender)
    const [first, second] = playbackPayloads(0x81)
    const rendered = renderRelay()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Text → QR" }))
    await enterRelayText(user, screen.getByLabelText("Relay text"), `${first}\n${second}`)
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )

    rendered.rerender(relayElement({ eligible: false }))
    expect(
      screen.queryByText(translate("en", "relay.card.title")),
    ).not.toBeInTheDocument()
    await act(async () => {
      pendingRender.reject(new Error("ineligible render failure"))
      await pendingRender.promise.catch(() => undefined)
    })
    rendered.rerender(relayElement({ eligible: true }))

    expect(
      screen.getByText(translate("en", "relay.card.title")),
    ).toBeInTheDocument()
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )

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
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "relay.playback.show"),
      }),
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "There is too much data to generate a QR code at this error-correction level.",
      ),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("hostile render detail")
  })
})
