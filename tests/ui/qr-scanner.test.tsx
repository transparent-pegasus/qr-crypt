import "./helpers/module-mocks"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QrScannerPanel } from "@/components/qr-scanner-panel"
import { AppError } from "@/crypto/errors"
import type { CameraDiagnostic, QrScanHandle } from "@/qr/decode"
import {
  emitScannedPayload,
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
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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

    expect(screen.getByLabelText("QRコード読取用カメラ映像")).toBeInTheDocument()
    expect(startQrScan).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(startQrScan.mock.calls[0]?.[3]).toMatchObject({ once: false })
    expect(startQrScan.mock.calls[0]?.[3]?.signal?.aborted).toBe(false)

    await act(async () => emitScannedPayload("OCM1:message"))
    await act(async () => emitScannedPayload("OCM1:message"))

    expect(onSingleScan).toHaveBeenCalledOnce()
    expect(onSingleScan).toHaveBeenCalledWith("message", "OCM1:message")
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()
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
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await screen.findByRole("button", { name: "カメラを停止" })

    act(() => emitScannedPayload("OCP1:not-a-symmetric-key"))
    expect(
      await screen.findByText(
        "受理対象外のQRです(公開鍵)。この画面では共通鍵を読み取れます。",
      ),
    ).toBeInTheDocument()
    expect(scannerStop).not.toHaveBeenCalled()

    act(() => emitScannedPayload("OCF2:not-accepted"))
    expect(
      await screen.findByText("この画面では複数QRを受理しません。"),
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
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await screen.findByRole("button", { name: "カメラを停止" })
    const firstSignal = startQrScan.mock.calls[0]?.[3]?.signal

    await user.click(screen.getByRole("button", { name: "カメラを停止" }))
    expect(firstSignal?.aborted).toBe(true)
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(
      screen.getByText("カメラを停止しました。再起動ボタンで再開できます。"),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "カメラを再起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    setVisibility("hidden")
    fireEvent(document, new Event("visibilitychange"))
    expect(startQrScan.mock.calls[1]?.[3]?.signal?.aborted).toBe(true)
    expect(
      await screen.findByText(
        "画面が非表示になったためカメラを停止しました。再起動ボタンで再開できます。",
      ),
    ).toBeInTheDocument()

    setVisibility("visible")
    fireEvent(document, new Event("visibilitychange"))
    await act(async () => Promise.resolve())
    expect(startQrScan).toHaveBeenCalledTimes(2)
    expect(
      screen.getByRole("button", { name: "カメラを再起動" }),
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

    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    expect(await screen.findByText(cameraError.userMessage)).toBeInTheDocument()
    expect(
      screen.getByText(
        "診断: NotReadableError @track-ended [0x0 rs=2 track=ended/unmuted]",
      ),
    ).toBeInTheDocument()
    expect(startQrScan).toHaveBeenCalledOnce()

    await user.click(screen.getByRole("button", { name: "カメラを再起動" }))
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
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    act(() => {
      oldError?.(new AppError("CAMERA_NOT_AVAILABLE"), {
        phase: "acquiring",
        name: null,
        detail: "0x0 rs=0 track=none",
      })
    })
    await user.click(
      await screen.findByRole("button", { name: "カメラを再起動" }),
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
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    const signal = startQrScan.mock.calls[0]?.[3]?.signal

    view.unmount()

    expect(signal?.aborted).toBe(true)
    expect(scannerStop).toHaveBeenCalledOnce()
  })
})
