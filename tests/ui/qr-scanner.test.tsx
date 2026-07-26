import "./helpers/module-mocks"
import { StrictMode, useState } from "react"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  QrScannerModal,
  QrScannerPanel,
} from "@/components/qr-scanner-panel"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppError, messageFor } from "@/crypto/errors"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import type { CameraDiagnostic, QrScanHandle } from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import {
  emitScannedPayload,
  multipartPayload,
  scannerStop,
  startQrScan,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("QrScannerPanel single scan and camera lifecycle", () => {
  beforeEach(() => {
    setVisibility("visible")
    resetUi()
  })
  afterEach(() => {
    setVisibility("visible")
    resetUi()
  })

  it("renders the video while idle and starts only from a click", async () => {
    const user = userEvent.setup()
    const onSingleScan = vi.fn(() => {
      expect(scannerStop).toHaveBeenCalledTimes(1)
    })
    render(
      <QrScannerPanel
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
      />,
    )

    expect(screen.getByLabelText("Camera video for QR scanning")).toBeInTheDocument()
    expect(startQrScan).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(startQrScan.mock.calls[0]?.[3]).toMatchObject({ once: false })
    expect(startQrScan.mock.calls[0]?.[3]?.signal?.aborted).toBe(false)

    await act(async () => emitScannedPayload("OCM1:message"))
    await act(async () => emitScannedPayload("OCM1:message"))

    expect(onSingleScan).toHaveBeenCalledOnce()
    expect(onSingleScan).toHaveBeenCalledWith("message", "OCM1:message")
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()
  })

  it("starts automatically only when autoStart is enabled", async () => {
    const view = render(
      <QrScannerPanel
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        autoStart
      />,
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    view.unmount()
    resetUi()
    render(
      <QrScannerPanel singleTargets={["message"]} onSingleScan={vi.fn()} />,
    )
    await act(async () => Promise.resolve())
    expect(startQrScan).not.toHaveBeenCalled()
  })

  it("leaves exactly one live auto-start run under StrictMode", async () => {
    render(
      <StrictMode>
        <QrScannerPanel
          singleTargets={["message"]}
          onSingleScan={vi.fn()}
          autoStart
        />
      </StrictMode>,
    )

    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    expect(startQrScan.mock.calls[0]?.[3]?.signal?.aborted).toBe(true)
    expect(startQrScan.mock.calls[1]?.[3]?.signal?.aborted).toBe(false)
    expect(scannerStop).toHaveBeenCalledOnce()
  })

  it("keeps scanning after target and multipart rejections", async () => {
    const user = userEvent.setup()
    const onSingleScan = vi.fn()
    render(
      <QrScannerPanel
        singleTargets={["symmetric-key"]}
        onSingleScan={onSingleScan}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })

    act(() => emitScannedPayload("OCP1:not-a-symmetric-key"))
    expect(
      await screen.findByText(
        "This QR code is not accepted (Public key). This screen can scan Symmetric key.",
      ),
    ).toBeInTheDocument()
    expect(scannerStop).not.toHaveBeenCalled()

    act(() => emitScannedPayload("OCF2:not-accepted"))
    expect(
      await screen.findByText("This screen does not accept multi-frame QR codes."),
    ).toBeInTheDocument()
    expect(scannerStop).not.toHaveBeenCalled()

    await act(async () => emitScannedPayload("OCK1:symmetric-key"))
    expect(onSingleScan).toHaveBeenCalledWith(
      "symmetric-key",
      "OCK1:symmetric-key",
    )
    expect(scannerStop).toHaveBeenCalledOnce()
  })

  it("stops explicitly and on hidden without restarting on visible", async () => {
    const user = userEvent.setup()
    render(
      <QrScannerPanel singleTargets={["message"]} onSingleScan={vi.fn()} />,
    )
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })
    const firstSignal = startQrScan.mock.calls[0]?.[3]?.signal

    await user.click(screen.getByRole("button", { name: "Stop camera" }))
    expect(firstSignal?.aborted).toBe(true)
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(
      screen.getByText("The camera was stopped. Press Restart to resume."),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Restart camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    setVisibility("hidden")
    fireEvent(document, new Event("visibilitychange"))
    expect(startQrScan.mock.calls[1]?.[3]?.signal?.aborted).toBe(true)
    expect(
      await screen.findByText(
        "The camera was stopped because the screen was hidden. Press Restart to resume.",
      ),
    ).toBeInTheDocument()

    setVisibility("visible")
    fireEvent(document, new Event("visibilitychange"))
    await act(async () => Promise.resolve())
    expect(startQrScan).toHaveBeenCalledTimes(2)
    expect(
      screen.getByRole("button", { name: "Restart camera" }),
    ).toBeEnabled()
  })

  it("shows the camera user message and diagnostic before an explicit restart", async () => {
    const cameraError = new AppError("CAMERA_NOT_AVAILABLE")
    startQrScan.mockImplementationOnce(async (_video, _onText, onError) => {
      onError(cameraError, {
        phase: "track-ended",
        name: "NotReadableError",
        detail: "0x0 rs=2 track=ended/unmuted",
      })
      throw cameraError
    })
    const user = userEvent.setup()
    render(
      <QrScannerPanel singleTargets={["message"]} onSingleScan={vi.fn()} />,
    )

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(
      await screen.findByText(messageFor(cameraError.code, "en")),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Diagnostic: NotReadableError @track-ended [0x0 rs=2 track=ended/unmuted]",
      ),
    ).toBeInTheDocument()
    expect(startQrScan).toHaveBeenCalledOnce()

    await user.click(screen.getByRole("button", { name: "Restart camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
  })

  it("ignores an old callback and stops an old promise after a rapid restart", async () => {
    const oldStart = deferred<QrScanHandle>()
    const oldStop = vi.fn()
    const newStop = vi.fn()
    let oldText: ((payload: string) => void) | undefined
    let oldError:
      | ((error: AppError, diagnostic: CameraDiagnostic) => void)
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
    const onSingleScan = vi.fn()
    render(
      <QrScannerPanel
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    act(() => {
      oldError?.(new AppError("CAMERA_NOT_AVAILABLE"), {
        phase: "acquiring",
        name: null,
        detail: "0x0 rs=0 track=none",
      })
    })
    await user.click(
      await screen.findByRole("button", { name: "Restart camera" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))

    act(() => oldText?.("OCM1:old"))
    expect(onSingleScan).not.toHaveBeenCalled()
    await act(async () => oldStart.resolve({ stop: oldStop }))
    expect(oldStop).toHaveBeenCalledOnce()
    expect(newStop).not.toHaveBeenCalled()

    await act(async () => newText?.("OCM1:new"))
    expect(onSingleScan).toHaveBeenCalledOnce()
    expect(onSingleScan).toHaveBeenCalledWith("message", "OCM1:new")
    expect(newStop).toHaveBeenCalledOnce()
  })

  it("aborts and stops the active run on unmount", async () => {
    const user = userEvent.setup()
    const view = render(
      <QrScannerPanel singleTargets={["message"]} onSingleScan={vi.fn()} />,
    )
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    const signal = startQrScan.mock.calls[0]?.[3]?.signal

    view.unmount()

    expect(signal?.aborted).toBe(true)
    expect(scannerStop).toHaveBeenCalledOnce()
  })
})

describe("QrScannerModal", () => {
  beforeEach(() => {
    setVisibility("visible")
    resetUi()
  })
  afterEach(() => {
    vi.useRealTimers()
    setVisibility("visible")
    resetUi()
  })

  it("opens with content focus, auto-starts, and stops immediately on manual close", async () => {
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan a ciphertext QR code"
        title="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
      />,
    )
    const trigger = screen.getByRole("button", {
      name: "Scan a ciphertext QR code",
    })
    await user.click(trigger)

    const dialog = await screen.findByRole("dialog", {
      name: "Scan a ciphertext QR code",
    })
    expect(dialog).toHaveFocus()
    expect(dialog).not.toHaveClass("overflow-y-auto")
    expect(
      dialog.querySelector("[data-qr-scanner-scroll-region]"),
    ).toHaveClass(
      "min-h-0",
      "max-h-[calc(95dvh-4rem-44px-1rem)]",
      "overflow-y-auto",
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(
      screen.getByText(
        "Camera images are not stored. Scanning stops when you close the dialog, press Stop, or leave the screen.",
      ),
    ).toBeInTheDocument()

    const closeControls = within(dialog).getAllByRole("button", {
      name: "Close",
    })
    expect(closeControls).toHaveLength(1)
    expect(Array.from(dialog.querySelectorAll("button")).at(-1)).toBe(
      closeControls[0],
    )
    await user.click(closeControls[0]!)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    const reopened = await screen.findByRole("dialog", {
      name: "Scan a ciphertext QR code",
    })
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(reopened).not.toBeInTheDocument())
    expect(scannerStop).toHaveBeenCalledTimes(2)
    expect(trigger).toHaveFocus()
  })

  it("disables the trigger and shows guidance when the camera is unavailable", () => {
    render(
      <QrScannerModal
        triggerLabel="Scan a key QR code"
        singleTargets={["symmetric-key"]}
        onSingleScan={vi.fn()}
        cameraAvailable={false}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Scan a key QR code" }),
    ).toBeDisabled()
    expect(
      screen.getByText(
        "The camera is unavailable on this device. Paste the payload instead.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it.each([
    ["synchronous throw", () => {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    }],
    [
      "asynchronous rejection",
      () => Promise.reject(new AppError("UNSUPPORTED_ALGORITHM")),
    ],
  ])("keeps the modal open for a %s delivery failure", async (_name, callback) => {
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={callback}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () => emitScannedPayload("OCM1:message"))

    expect(
      await screen.findByText(
        messageFor("UNSUPPORTED_ALGORITHM", "en"),
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("dialog", { name: "Scan a QR code" }),
    ).toBeInTheDocument()
  })

  it("keeps the trigger locked until a manually closed delivery settles", async () => {
    const firstDelivery = deferred<void>()
    const onSingleScan = vi
      .fn<() => void | Promise<void>>()
      .mockReturnValueOnce(firstDelivery.promise)
      .mockReturnValueOnce(undefined)
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
      />,
    )
    const trigger = screen.getByRole("button", {
      name: "Scan a ciphertext QR code",
    })

    await user.click(trigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    act(() => emitScannedPayload("OCM1:first"))
    expect(await screen.findByText("Importing…")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Start camera" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(trigger).toBeDisabled()

    await act(async () => firstDelivery.resolve())
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))

    expect(
      screen.getByRole("dialog", { name: "Scan a QR code" }),
    ).toBeInTheDocument()

    await act(async () => emitScannedPayload("OCM1:second"))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Scan a QR code" }),
      ).not.toBeInTheDocument(),
    )
    expect(onSingleScan).toHaveBeenCalledTimes(2)
  })

  it("surfaces a delivery failure that settles after manual close", async () => {
    const delivery = deferred<void>()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={() => delivery.promise}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    act(() => emitScannedPayload("OCM1:message"))
    await screen.findByText("Importing…")
    await user.click(screen.getByRole("button", { name: "Close" }))

    await act(async () =>
      delivery.reject(new AppError("UNSUPPORTED_ALGORITHM")),
    )
    expect(
      await screen.findByText(
        messageFor("UNSUPPORTED_ALGORITHM", "en"),
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("does not steal focus from a follow-on dialog after automatic close", async () => {
    function Harness() {
      const [followOnOpen, setFollowOnOpen] = useState(false)
      return (
        <>
          <QrScannerModal
            triggerLabel="Scan a key QR code"
            singleTargets={["symmetric-key"]}
            onSingleScan={() => setFollowOnOpen(true)}
          />
          <Dialog open={followOnOpen} onOpenChange={setFollowOnOpen}>
            <DialogContent>
              <DialogTitle>Import the symmetric key</DialogTitle>
              <button type="button">Confirm save</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Scan a key QR code" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () => emitScannedPayload("OCK1:key"))

    const followOn = await screen.findByRole("dialog", {
      name: "Import the symmetric key",
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
      artifactType: "pq-message",
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
        triggerLabel="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
      />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => emitScannedPayload("OCF2:last"))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    state = {
      kind: "complete",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    }
    await act(async () => {
      pendingAdd.resolve(state)
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(onComplete).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    })
    expect(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    ).toBeDisabled()
    expect(
      screen.queryByText(
        "All multi-frame QR frames passed SHA-256 integrity checking and were imported.",
      ),
    ).not.toBeInTheDocument()

    await act(async () => delivery.resolve())

    expect(
      screen.getByText(
        "All multi-frame QR frames passed SHA-256 integrity checking and were imported.",
      ),
    ).toBeInTheDocument()
  })

  it("auto-closes after an open multipart completion and keeps its SHA-256 notice", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn()
    render(
      <QrScannerModal
        triggerLabel="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "Scan a ciphertext QR code" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 1)),
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Scan a QR code" }),
      ).not.toBeInTheDocument(),
    )
    expect(onComplete).toHaveBeenCalledOnce()
    expect(
      screen.getByText(
        "All multi-frame QR frames passed SHA-256 integrity checking and were imported.",
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(scannerStop).toHaveBeenCalledOnce())
  })

  it("announces a collecting session timeout while closed", async () => {
    vi.useFakeTimers()
    const session = new MultipartScanSession(5)
    let state: TransferState = {
      kind: "collecting",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      frameCount: 3,
      receivedIndexes: new Set([0]),
      missingIndexes: [1, 2],
      expiresAt: Date.now() + 60_000,
    }
    vi.spyOn(session, "state").mockImplementation(() => state)
    render(
      <QrScannerModal
        triggerLabel="Scan a ciphertext QR code"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete: vi.fn() }}
      />,
    )

    expect(
      screen.getByText("Multi-frame QR scan in progress: received 1 / 3"),
    ).toBeInTheDocument()
    state = { kind: "idle" }
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(
      screen.getByText(
        "The temporary scan state expired and was discarded.",
      ),
    ).toBeInTheDocument()
  })
})
