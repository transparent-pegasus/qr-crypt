import "./helpers/module-mocks"
import { StrictMode, useState, type ComponentProps } from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QrScannerModal } from "@/components/qr-scanner-modal"
import { QrScannerPanel } from "@/components/qr-scanner-panel"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AppError, messageFor } from "@/crypto/errors"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import { translate } from "@/i18n/messages"
import type { QrScanHandle } from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import { deferred } from "../helpers/deferred"
import {
  emitScannedPayload,
  multipartPayload,
  probeWebAssemblyRuntime,
  readerModuleState,
  scannerStop,
  startQrScan,
  warmQrReader,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

type PanelProps = ComponentProps<typeof QrScannerPanel>
type HasRetiredSingleProps = "singleTargets" extends keyof PanelProps
  ? true
  : "onSingleScan" extends keyof PanelProps
    ? true
    : false
const HAS_RETIRED_SINGLE_PROPS: HasRetiredSingleProps = false

function frameOnlyProps(
  session = new MultipartScanSession(5),
  onComplete: PanelProps["multipart"]["onComplete"] = vi.fn(),
) {
  return { multipart: { session, onComplete } }
}

function completedSession(): MultipartScanSession {
  const session = new MultipartScanSession(5)
  vi.spyOn(session, "state").mockReturnValue({
    kind: "complete",
    transferId: Uint8Array.of(1),
    artifactType: "sym-message",
    artifactBytes: Uint8Array.of(2),
  })
  return session
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
}

describe("QrScannerPanel frame scanning and camera lifecycle", () => {
  beforeEach(() => {
    setVisibility("visible")
    resetUi()
  })
  afterEach(() => {
    vi.useRealTimers()
    setVisibility("visible")
    resetUi()
  })

  it("has no single-payload props", () => {
    expect(HAS_RETIRED_SINGLE_PROPS).toBe(false)
  })

  it("keeps scanning disabled until the reader is ready", async () => {
    readerModuleState.mockReturnValue("idle")
    const preparation = deferred<void>()
    warmQrReader.mockReturnValue(preparation.promise)
    const user = userEvent.setup()
    render(<QrScannerPanel {...frameOnlyProps()} />)

    const startButton = screen.getByRole("button", {
      name: translate("en", "scanner.button.start"),
    })
    expect(startButton).toBeDisabled()
    expect(
      screen.getByText(translate("en", "scanner.status.readerLoading")),
    ).toBeInTheDocument()
    expect(startQrScan).not.toHaveBeenCalled()

    await act(async () => preparation.resolve())

    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
  })

  it("cleans up a pending reader gate when unmounted", async () => {
    readerModuleState.mockReturnValue("idle")
    vi.useFakeTimers()
    const preparation = deferred<void>()
    void preparation.promise.catch(() => undefined)
    warmQrReader.mockReturnValue(preparation.promise)
    const view = render(<QrScannerPanel {...frameOnlyProps()} />)

    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()

    expect(vi.getTimerCount()).toBe(0)
    await act(async () => {
      preparation.reject(new Error("late reader preparation failure"))
      await preparation.promise.catch(() => undefined)
    })
    expect(probeWebAssemblyRuntime).not.toHaveBeenCalled()
    expect(startQrScan).not.toHaveBeenCalled()
  })

  it("auto-starts only when the reader was ready at mount", async () => {
    readerModuleState.mockReturnValue("idle")
    const preparation = deferred<void>()
    warmQrReader.mockReturnValue(preparation.promise)
    const pending = render(<QrScannerPanel {...frameOnlyProps()} autoStart />)

    await act(async () => preparation.resolve())

    expect(startQrScan).not.toHaveBeenCalled()
    pending.unmount()

    resetUi()
    readerModuleState.mockReturnValue("ready")
    render(<QrScannerPanel {...frameOnlyProps()} autoStart />)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
  })

  it("offers reload for preparation failure and a non-reload block for unusable WebAssembly", async () => {
    readerModuleState.mockReturnValue("idle")
    const preparation = deferred<void>()
    void preparation.promise.catch(() => undefined)
    warmQrReader.mockReturnValue(preparation.promise)
    const failed = render(<QrScannerPanel {...frameOnlyProps()} />)

    await act(async () => {
      preparation.reject(new Error("reader preparation failed"))
      await preparation.promise.catch(() => undefined)
    })

    expect(
      await screen.findByRole("button", {
        name: translate("en", "scanner.button.reload"),
      }),
    ).toBeEnabled()
    failed.unmount()

    resetUi()
    readerModuleState.mockReturnValue("idle")
    const blockedPreparation = deferred<void>()
    void blockedPreparation.promise.catch(() => undefined)
    warmQrReader.mockReturnValue(blockedPreparation.promise)
    probeWebAssemblyRuntime.mockResolvedValue(false)
    render(<QrScannerPanel {...frameOnlyProps()} />)

    await act(async () => {
      blockedPreparation.reject(new Error("reader preparation failed"))
      await blockedPreparation.promise.catch(() => undefined)
    })

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        translate("en", "errors.QR_READER_BLOCKED"),
      ),
    )
    expect(
      screen.queryByRole("button", {
        name: translate("en", "scanner.button.reload"),
      }),
    ).not.toBeInTheDocument()
  })

  it("bounds a never-settling failure classification to two seconds", async () => {
    readerModuleState.mockReturnValue("idle")
    vi.useFakeTimers()
    const preparation = deferred<void>()
    const classification = deferred<boolean>()
    void preparation.promise.catch(() => undefined)
    warmQrReader.mockReturnValue(preparation.promise)
    probeWebAssemblyRuntime.mockReturnValue(classification.promise)
    render(<QrScannerPanel {...frameOnlyProps()} />)

    await act(async () => {
      preparation.reject(new Error("reader preparation failed"))
      await preparation.promise.catch(() => undefined)
      await Promise.resolve()
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_999))
    expect(screen.getByRole("status")).toHaveTextContent(
      translate("en", "scanner.status.readerLoading"),
    )

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByRole("status")).toHaveTextContent(
      translate("en", "scanner.reader.reloadHint"),
    )
  })

  it("gives up on a never-settling reader preparation", async () => {
    readerModuleState.mockReturnValue("idle")
    vi.useFakeTimers()
    warmQrReader.mockReturnValue(deferred<void>().promise)
    render(<QrScannerPanel {...frameOnlyProps()} />)

    await act(async () => vi.advanceTimersByTimeAsync(30_001))

    expect(screen.getByRole("status")).toHaveTextContent(
      translate("en", "scanner.reader.reloadHint"),
    )
    expect(startQrScan).not.toHaveBeenCalled()
  })

  it("accepts only frames and rejects a bare v2 single payload with the mismatch message", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn()
    render(<QrScannerPanel {...frameOnlyProps(session, onComplete)} />)
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Discard scan state" })

    act(() => emitScannedPayload("OCA2:bare-v2-single-payload"))
    expect(
      await screen.findByText(
        "This QR code is not accepted (Not from this app). This screen can scan multi-frame QR.",
      ),
    ).toBeInTheDocument()
    expect(scannerStop).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()

    await act(async () =>
      emitScannedPayload(multipartPayload("frame-only", 0, 1, "sym-message")),
    )
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "sym-message",
      artifactBytes: Uint8Array.of(1),
    })
    expect(scannerStop).toHaveBeenCalledOnce()
  })

  it("leaves one live auto-start run under StrictMode", async () => {
    render(
      <StrictMode>
        <QrScannerPanel {...frameOnlyProps()} autoStart />
      </StrictMode>,
    )

    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    expect(startQrScan.mock.calls[0]?.[3]?.signal?.aborted).toBe(true)
    expect(startQrScan.mock.calls[1]?.[3]?.signal?.aborted).toBe(false)
    expect(scannerStop).toHaveBeenCalledOnce()
  })

  it("discards explicitly and stops when the screen is hidden", async () => {
    const user = userEvent.setup()
    render(<QrScannerPanel {...frameOnlyProps()} />)
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    const firstSignal = startQrScan.mock.calls[0]?.[3]?.signal

    await user.click(screen.getByRole("button", { name: "Discard scan state" }))
    expect(firstSignal?.aborted).toBe(true)
    expect(scannerStop).toHaveBeenCalledOnce()

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    setVisibility("hidden")
    fireEvent(document, new Event("visibilitychange"))
    expect(startQrScan.mock.calls[1]?.[3]?.signal?.aborted).toBe(true)
    expect(
      await screen.findByText(
        "The camera was stopped because the screen was hidden. Press Restart to resume.",
      ),
    ).toBeInTheDocument()
  })

  it("shows a camera failure before an explicit restart", async () => {
    const cameraError = new AppError("CAMERA_NOT_AVAILABLE")
    startQrScan.mockImplementationOnce(async (_video, _onText, onError) => {
      onError(cameraError, "track-ended")
      throw cameraError
    })
    const user = userEvent.setup()
    render(<QrScannerPanel {...frameOnlyProps()} />)

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(
      await screen.findByText(messageFor(cameraError.code, "en")),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Restart camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
  })

  it("ignores an old frame callback and stops its late handle after restart", async () => {
    const oldStart = deferred<QrScanHandle>()
    const oldStop = vi.fn()
    const newStop = vi.fn()
    let oldText: ((payload: string) => void) | undefined
    let oldError:
      | ((error: AppError, failureState: "failed" | "track-ended") => void)
      | undefined
    let newText: ((payload: string) => void) | undefined
    startQrScan
      .mockImplementationOnce((_video, onText, onError) => {
        oldText = onText
        oldError = onError
        return oldStart.promise
      })
      .mockImplementationOnce(async (_video, onText) => {
        newText = onText
        return { stop: newStop }
      })

    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<QrScannerPanel {...frameOnlyProps(undefined, onComplete)} />)
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    act(() => oldError?.(new AppError("CAMERA_NOT_AVAILABLE"), "failed"))
    await user.click(
      await screen.findByRole("button", { name: "Restart camera" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))

    act(() => oldText?.(multipartPayload("old", 0, 1, "sym-message")))
    expect(onComplete).not.toHaveBeenCalled()
    await act(async () => oldStart.resolve({ stop: oldStop }))
    expect(oldStop).toHaveBeenCalledOnce()
    expect(newStop).not.toHaveBeenCalled()

    await act(async () =>
      newText?.(multipartPayload("new", 0, 1, "sym-message")),
    )
    expect(onComplete).toHaveBeenCalledOnce()
    expect(newStop).toHaveBeenCalledOnce()
  })

  it("aborts and stops the active run on unmount", async () => {
    const user = userEvent.setup()
    const view = render(<QrScannerPanel {...frameOnlyProps()} />)
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    const signal = startQrScan.mock.calls[0]?.[3]?.signal

    view.unmount()

    expect(signal?.aborted).toBe(true)
    expect(scannerStop).toHaveBeenCalledOnce()
  })
})

describe("QrScannerModal frame delivery", () => {
  beforeEach(() => {
    setVisibility("visible")
    resetUi()
  })
  afterEach(() => {
    vi.useRealTimers()
    setVisibility("visible")
    resetUi()
  })

  it("opens with content focus, auto-starts, and stops on close", async () => {
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps()}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Scan ciphertext frames" })
    await user.click(trigger)

    const dialog = await screen.findByRole("dialog", { name: "Scan a QR code" })
    expect(dialog).toHaveFocus()
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })

  it("disables the trigger and shows guidance when the camera is unavailable", () => {
    render(
      <QrScannerModal
        triggerLabel="Scan key frames"
        cameraAvailable={false}
        {...frameOnlyProps()}
      />,
    )

    expect(screen.getByRole("button", { name: "Scan key frames" })).toBeDisabled()
    expect(
      screen.getByText(
        "The camera is unavailable on this device. Paste the payload instead.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the modal open when frame delivery fails", async () => {
    const onComplete = vi.fn(() =>
      Promise.reject(new AppError("UNSUPPORTED_ALGORITHM")),
    )
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(undefined, onComplete)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Scan ciphertext frames" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () =>
      emitScannedPayload(multipartPayload("delivery-failure", 0, 1, "sym-message")),
    )

    expect(
      await screen.findByText(messageFor("UNSUPPORTED_ALGORITHM", "en")),
    ).toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "Scan a QR code" })).toBeInTheDocument()
  })

  it("keeps the trigger locked until a closed delivery settles", async () => {
    const delivery = deferred<void>()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(undefined, () => delivery.promise)}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Scan ciphertext frames" })

    await user.click(trigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    act(() =>
      emitScannedPayload(multipartPayload("pending", 0, 1, "sym-message")),
    )
    expect(await screen.findByText("Importing…")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(trigger).toBeDisabled()

    await act(async () => delivery.resolve())
    await waitFor(() => expect(trigger).toBeEnabled())
  })

  it("does not steal focus from a follow-on dialog after automatic close", async () => {
    function Harness() {
      const [followOnOpen, setFollowOnOpen] = useState(false)
      return (
        <>
          <QrScannerModal
            triggerLabel="Scan key frames"
            {...frameOnlyProps(undefined, () => setFollowOnOpen(true))}
          />
          <Dialog open={followOnOpen} onOpenChange={setFollowOnOpen}>
            <DialogContent>
              <DialogTitle>Import the shared key</DialogTitle>
              <button type="button">Confirm save</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Scan key frames" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () =>
      emitScannedPayload(multipartPayload("key", 0, 1, "symmetric-key")),
    )

    const followOn = await screen.findByRole("dialog", {
      name: "Import the shared key",
    })
    expect(
      within(followOn).getByRole("button", { name: "Confirm save" }),
    ).toHaveFocus()
  })

  it("awaits a completion that appears after close before announcing success", async () => {
    vi.useFakeTimers()
    const session = new MultipartScanSession(5)
    const pendingAdd = deferred<TransferState>()
    let state: TransferState = {
      kind: "collecting",
      transferId: Uint8Array.of(1),
      artifactType: "sym-message",
      frameCount: 2,
      receivedIndexes: new Set([0]),
      missingIndexes: [1],
      expiresAt: Date.now() + 60_000,
    }
    vi.spyOn(session, "state").mockImplementation(() => state)
    vi.spyOn(session, "add").mockReturnValueOnce(pendingAdd.promise)
    const delivery = deferred<void>()
    const onComplete = vi.fn(() => delivery.promise)
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(session, onComplete)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Scan ciphertext frames" }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => emitScannedPayload("OCF2:last"))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    state = {
      kind: "complete",
      transferId: Uint8Array.of(1),
      artifactType: "sym-message",
      artifactBytes: Uint8Array.of(2),
    }
    await act(async () => {
      pendingAdd.resolve(state)
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "sym-message",
      artifactBytes: Uint8Array.of(2),
    })
    expect(
      screen.getByRole("button", { name: "Scan ciphertext frames" }),
    ).toBeDisabled()
    expect(
      screen.queryByText(
        "All frames of the multi-frame QR code were received and imported.",
      ),
    ).not.toBeInTheDocument()

    await act(async () => delivery.resolve())

    expect(
      screen.getByText(
        "All frames of the multi-frame QR code were received and imported.",
      ),
    ).toBeInTheDocument()
  })

  it("auto-closes after frame completion and keeps the frame-set notice", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(undefined, onComplete)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Scan ciphertext frames" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () =>
      emitScannedPayload(multipartPayload("complete", 0, 1, "sym-message")),
    )

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(onComplete).toHaveBeenCalledOnce()
    expect(
      screen.getByText(
        "All frames of the multi-frame QR code were received and imported.",
      ),
    ).toBeInTheDocument()
  })

  it("announces a collecting-session timeout while closed", async () => {
    vi.useFakeTimers()
    const session = new MultipartScanSession(5)
    let state: TransferState = {
      kind: "collecting",
      transferId: Uint8Array.of(1),
      artifactType: "sym-message",
      frameCount: 3,
      receivedIndexes: new Set([0]),
      missingIndexes: [1, 2],
      expiresAt: Date.now() + 60_000,
    }
    vi.spyOn(session, "state").mockImplementation(() => state)
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(session)}
      />,
    )

    expect(
      screen.getByText("Multi-frame QR scan in progress: received 1 / 3"),
    ).toBeInTheDocument()
    state = { kind: "idle" }
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(
      screen.getByText("The temporary scan state expired and was discarded."),
    ).toBeInTheDocument()
  })

  it("does not retry a failed closed-session delivery on the next poll", async () => {
    vi.useFakeTimers()
    const onComplete = vi.fn(() =>
      Promise.reject(new AppError("UNSUPPORTED_ALGORITHM")),
    )
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(completedSession(), onComplete)}
      />,
    )

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(onComplete).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("permits exactly one further poll attempt after the dialog is reopened", async () => {
    vi.useFakeTimers()
    const onComplete = vi.fn(() =>
      Promise.reject(new AppError("UNSUPPORTED_ALGORITHM")),
    )
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        {...frameOnlyProps(completedSession(), onComplete)}
      />,
    )
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(onComplete).toHaveBeenCalledOnce()

    // Reopening spends an attempt of its own: the panel auto-starts over a
    // session that is still complete, and the released claim is free again.
    fireEvent.click(screen.getByRole("button", { name: "Scan ciphertext frames" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(onComplete).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(onComplete).toHaveBeenCalledTimes(3)

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(onComplete).toHaveBeenCalledTimes(3)
  })

  it("does not redeliver when onClosed throws after a successful delivery", async () => {
    vi.useFakeTimers()
    const onComplete = vi.fn(async () => undefined)
    const onClosed = vi.fn(() => {
      throw new Error("ui callback failed")
    })
    render(
      <QrScannerModal
        triggerLabel="Scan ciphertext frames"
        onClosed={onClosed}
        {...frameOnlyProps(completedSession(), onComplete)}
      />,
    )

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onClosed).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
