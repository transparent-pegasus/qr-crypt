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
import { AppError, userMessageFor } from "@/crypto/errors"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import type { CameraDiagnostic, QrScanHandle } from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import {
  decodeQrImageFile,
  emitScannedPayload,
  FakeTransferAssembler,
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

function imageFile(name: string, size = 1): File {
  const file = new File(["x"], name, { type: "image/png" })
  if (size !== file.size) {
    Object.defineProperty(file, "size", {
      configurable: true,
      value: size,
    })
  }
  return file
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
        triggerLabel="暗号文QRを読み取る"
        title="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
      />,
    )
    const trigger = screen.getByRole("button", {
      name: "暗号文QRを読み取る",
    })
    await user.click(trigger)

    const dialog = await screen.findByRole("dialog", {
      name: "暗号文QRを読み取る",
    })
    expect(dialog).toHaveFocus()
    expect(dialog).not.toHaveClass("overflow-y-auto")
    expect(
      dialog.querySelector("[data-qr-scanner-scroll-region]"),
    ).toHaveClass(
      "max-h-[calc(95dvh-4rem)]",
      "overflow-y-auto",
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(
      screen.getByText(
        "カメラ画像は保存されません。閉じる・停止ボタン・画面離脱で停止します。",
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })

  it("disables the trigger and shows guidance when the camera is unavailable", () => {
    render(
      <QrScannerModal
        triggerLabel="鍵QRを読み取る"
        singleTargets={["symmetric-key"]}
        onSingleScan={vi.fn()}
        cameraAvailable={false}
      />,
    )

    expect(
      screen.getByRole("button", { name: "鍵QRを読み取る" }),
    ).toBeDisabled()
    expect(
      screen.getByText(
        "この端末ではカメラを利用できません。ペイロードを貼り付けてください。",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps image import available without a camera and shows its guidance", () => {
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        cameraAvailable={false}
        imageImport
      />,
    )

    expect(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "QR画像を読み込む" }),
    ).toBeEnabled()
    expect(
      screen.getByText(
        "この端末ではカメラを利用できません。QR画像の読み込み、またはペイロードの貼り付けを利用してください。",
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("QR画像ファイル")).toHaveAttribute(
      "accept",
      "image/*",
    )
    expect(screen.getByLabelText("QR画像ファイル")).toHaveAttribute(
      "multiple",
    )
  })

  it("disables camera entry during a batch and image entry while open", async () => {
    const decoded = deferred<string>()
    decodeQrImageFile.mockReturnValueOnce(decoded.promise)
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        imageImport
      />,
    )
    const cameraTrigger = screen.getByRole("button", {
      name: "暗号文QRを読み取る",
    })
    const imageTrigger = screen.getByRole("button", {
      name: "QR画像を読み込む",
    })

    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("pending.png"),
    )
    await waitFor(() => expect(decodeQrImageFile).toHaveBeenCalledOnce())
    expect(cameraTrigger).toBeDisabled()
    expect(imageTrigger).toBeDisabled()
    expect(cameraTrigger.parentElement).toHaveAttribute("aria-busy", "true")

    await act(async () => decoded.resolve("OCM1:image"))
    await screen.findByText(/画像 1 件中: 取り込み 1/)
    await waitFor(() => expect(cameraTrigger).toBeEnabled())

    await user.click(cameraTrigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(imageTrigger).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(imageTrigger).toBeEnabled()
  })

  it("imports only the first matching single image and aggregates one summary", async () => {
    decodeQrImageFile
      .mockResolvedValueOnce("OCM1:first")
      .mockResolvedValueOnce("OCM1:second")
      .mockRejectedValueOnce(new AppError("INVALID_QR_PAYLOAD"))
    const onSingleScan = vi.fn()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
        imageImport
      />,
    )
    const input = screen.getByLabelText("QR画像ファイル")

    await user.upload(input, [
      imageFile("first.png"),
      imageFile("second.png"),
      imageFile("broken.png"),
    ])

    expect(
      await screen.findByText(
        /画像 3 件中: 取り込み 1、フレーム受理 0、失敗 2、未処理 0。/,
      ),
    ).toBeInTheDocument()
    expect(onSingleScan).toHaveBeenCalledOnce()
    expect(onSingleScan).toHaveBeenCalledWith("message", "OCM1:first")
    expect(
      screen.getByText(/単発QRは1件のみ取り込みます。/),
    ).toBeInTheDocument()
    expect(input).toHaveValue("")
  })

  it("enforces the per-selection file count and file size limits", async () => {
    decodeQrImageFile.mockResolvedValue("not-a-qrypt-payload")
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        imageImport
      />,
    )
    const files = Array.from({ length: 32 }, (_, index) =>
      imageFile(
        `image-${index}.png`,
        index === 0 ? 20 * 1024 * 1024 + 1 : 1,
      ),
    )

    await user.upload(screen.getByLabelText("QR画像ファイル"), files)

    expect(
      await screen.findByText(
        /画像 32 件中: 取り込み 0、フレーム受理 0、失敗 29、未処理 3。/,
      ),
    ).toBeInTheDocument()
    expect(decodeQrImageFile).toHaveBeenCalledTimes(29)
    expect(screen.getByText(/上限超過 2 件を未処理/)).toBeInTheDocument()
    expect(
      screen.getByText(/20MBを超える画像は処理しません。/),
    ).toBeInTheDocument()
  })

  it("stops at a complete preflight and awaits its one-time delivery", async () => {
    const session = new MultipartScanSession(5)
    let state: TransferState = { kind: "idle" }
    vi.spyOn(session, "state").mockImplementation(() => state)
    const delivery = deferred<void>()
    const onComplete = vi.fn(() => delivery.promise)
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
        imageImport
      />,
    )
    state = {
      kind: "complete",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    }

    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("unused.png"),
    )
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(decodeQrImageFile).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    ).toBeDisabled()

    await act(async () => delivery.resolve())
    expect(
      await screen.findByText(
        /画像 1 件中: 取り込み 1、フレーム受理 0、失敗 0、未処理 1。/,
      ),
    ).toBeInTheDocument()
  })

  it("stops at error or claimed-complete preflight without decoding files", async () => {
    const user = userEvent.setup()
    const errorSession = new MultipartScanSession(5)
    let errorState: TransferState = { kind: "idle" }
    vi.spyOn(errorSession, "state").mockImplementation(() => errorState)
    const first = render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session: errorSession, onComplete: vi.fn() }}
        imageImport
      />,
    )
    errorState = { kind: "error", code: "FRAME_MISMATCH" }
    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("error.png"),
    )
    expect(
      await screen.findByText(userMessageFor("FRAME_MISMATCH")),
    ).toBeInTheDocument()
    expect(decodeQrImageFile).not.toHaveBeenCalled()

    first.unmount()
    resetUi()
    const claimedSession = new MultipartScanSession(5)
    let claimedState: TransferState = { kind: "idle" }
    vi.spyOn(claimedSession, "state").mockImplementation(() => claimedState)
    const onComplete = vi.fn()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session: claimedSession, onComplete }}
        imageImport
      />,
    )
    claimedState = {
      kind: "complete",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    }
    claimedSession.claimCompletion()
    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("claimed.png"),
    )

    expect(
      await screen.findByText(/取り込み済みの読取結果があります。/),
    ).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
    expect(decodeQrImageFile).not.toHaveBeenCalled()
  })

  it("continues after collecting expires at preflight, but keeps the timeout in summary", async () => {
    const session = new MultipartScanSession(5)
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
    decodeQrImageFile.mockResolvedValueOnce("OCM1:after-timeout")
    const onSingleScan = vi.fn()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
        multipart={{ session, onComplete: vi.fn() }}
        imageImport
      />,
    )
    state = { kind: "idle" }

    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("after-timeout.png"),
    )

    expect(
      await screen.findByText(/読取期限を過ぎたため破棄しました。/),
    ).toBeInTheDocument()
    expect(onSingleScan).toHaveBeenCalledWith(
      "message",
      "OCM1:after-timeout",
    )
  })

  it("rejects a single image while a multipart session is locked", async () => {
    const session = new MultipartScanSession(5)
    const collecting: TransferState = {
      kind: "collecting",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      frameCount: 2,
      receivedIndexes: new Set([0]),
      missingIndexes: [1],
      expiresAt: Date.now() + 60_000,
    }
    vi.spyOn(session, "state").mockReturnValue(collecting)
    decodeQrImageFile.mockResolvedValueOnce("OCM1:single")
    const onSingleScan = vi.fn()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
        multipart={{ session, onComplete: vi.fn() }}
        imageImport
      />,
    )

    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("single.png"),
    )

    expect(
      await screen.findByText(
        /複数QR読取中です。単発QRは読取完了または破棄後に。/,
      ),
    ).toBeInTheDocument()
    expect(onSingleScan).not.toHaveBeenCalled()
  })

  it("ends a batch on frame completion and leaves later files unprocessed", async () => {
    const session = new MultipartScanSession(5)
    vi.spyOn(session, "state").mockReturnValue({ kind: "idle" })
    vi.spyOn(session, "add").mockResolvedValue({
      kind: "complete",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    })
    decodeQrImageFile.mockResolvedValue("OCF2:frame")
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
        imageImport
      />,
    )

    await user.upload(screen.getByLabelText("QR画像ファイル"), [
      imageFile("complete.png"),
      imageFile("later.png"),
    ])

    expect(
      await screen.findByText(
        /画像 2 件中: 取り込み 1、フレーム受理 1、失敗 0、未処理 1。/,
      ),
    ).toBeInTheDocument()
    expect(onComplete).toHaveBeenCalledOnce()
    expect(decodeQrImageFile).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: "error",
      next: { kind: "error", code: "FRAME_MISMATCH" } as TransferState,
      message: userMessageFor("FRAME_MISMATCH"),
    },
    {
      name: "timeout",
      next: { kind: "idle" } as TransferState,
      message: "読取期限を過ぎたため破棄しました。",
    },
  ])("ends a batch when a frame add returns $name", async ({ next, message }) => {
    const session = new MultipartScanSession(5)
    vi.spyOn(session, "state").mockReturnValue({ kind: "idle" })
    vi.spyOn(session, "add").mockResolvedValue(next)
    decodeQrImageFile.mockResolvedValue("OCF2:frame")
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete: vi.fn() }}
        imageImport
      />,
    )

    await user.upload(screen.getByLabelText("QR画像ファイル"), [
      imageFile("terminal.png"),
      imageFile("later.png"),
    ])

    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument()
    expect(
      screen.getByText(
        /画像 2 件中: 取り込み 0、フレーム受理 0、失敗 1、未処理 1。/,
      ),
    ).toBeInTheDocument()
    expect(decodeQrImageFile).toHaveBeenCalledOnce()
  })

  it("queues an image frame behind a pending camera frame after close", async () => {
    const firstAdd = deferred<TransferState>()
    const secondAdd = deferred<TransferState>()
    const assemblerAdd = vi
      .spyOn(FakeTransferAssembler.prototype, "add")
      .mockImplementationOnce(() => firstAdd.promise)
      .mockImplementationOnce(() => secondAdd.promise)
    const session = new MultipartScanSession(5)
    decodeQrImageFile.mockResolvedValueOnce("OCF2:image")
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
        imageImport
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    act(() => emitScannedPayload("OCF2:camera"))
    await waitFor(() => expect(assemblerAdd).toHaveBeenCalledOnce())
    await user.click(screen.getByRole("button", { name: "Close" }))

    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("image.png"),
    )
    await waitFor(() => expect(decodeQrImageFile).toHaveBeenCalledOnce())
    expect(assemblerAdd).toHaveBeenCalledOnce()

    await act(async () =>
      firstAdd.resolve({
        kind: "collecting",
        transferId: Uint8Array.of(1),
        artifactType: "pq-message",
        frameCount: 2,
        receivedIndexes: new Set([0]),
        missingIndexes: [1],
        expiresAt: Date.now() + 60_000,
      }),
    )
    await waitFor(() => expect(assemblerAdd).toHaveBeenCalledTimes(2))
    await act(async () =>
      secondAdd.resolve({
        kind: "collecting",
        transferId: Uint8Array.of(1),
        artifactType: "pq-message",
        frameCount: 2,
        receivedIndexes: new Set([0, 1]),
        missingIndexes: [],
        expiresAt: Date.now() + 60_000,
      }),
    )

    expect(
      await screen.findByText(/フレーム受理 1/),
    ).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
    assemblerAdd.mockRestore()
  })

  it("does not deliver or publish after an image batch is unmounted", async () => {
    const decoded = deferred<string>()
    decodeQrImageFile.mockReturnValueOnce(decoded.promise)
    const onSingleScan = vi.fn()
    const user = userEvent.setup()
    const view = render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
        imageImport
      />,
    )
    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      imageFile("pending.png"),
    )
    await waitFor(() => expect(decodeQrImageFile).toHaveBeenCalledOnce())

    view.unmount()
    await act(async () => decoded.resolve("OCM1:late"))

    expect(onSingleScan).not.toHaveBeenCalled()
    expect(screen.queryByText(/画像 1 件中/)).not.toBeInTheDocument()
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
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={callback}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () => emitScannedPayload("OCM1:message"))

    expect(
      await screen.findByText(
        new AppError("UNSUPPORTED_ALGORITHM").userMessage,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("dialog", { name: "QRコードを読み取る" }),
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
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={onSingleScan}
      />,
    )
    const trigger = screen.getByRole("button", {
      name: "暗号文QRを読み取る",
    })

    await user.click(trigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    act(() => emitScannedPayload("OCM1:first"))
    expect(await screen.findByText("取り込み中です…")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "カメラを起動" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(trigger).toBeDisabled()

    await act(async () => firstDelivery.resolve())
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))

    expect(
      screen.getByRole("dialog", { name: "QRコードを読み取る" }),
    ).toBeInTheDocument()

    await act(async () => emitScannedPayload("OCM1:second"))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "QRコードを読み取る" }),
      ).not.toBeInTheDocument(),
    )
    expect(onSingleScan).toHaveBeenCalledTimes(2)
  })

  it("surfaces a delivery failure that settles after manual close", async () => {
    const delivery = deferred<void>()
    const user = userEvent.setup()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={() => delivery.promise}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    act(() => emitScannedPayload("OCM1:message"))
    await screen.findByText("取り込み中です…")
    await user.click(screen.getByRole("button", { name: "Close" }))

    await act(async () =>
      delivery.reject(new AppError("UNSUPPORTED_ALGORITHM")),
    )
    expect(
      await screen.findByText(
        new AppError("UNSUPPORTED_ALGORITHM").userMessage,
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
            triggerLabel="鍵QRを読み取る"
            singleTargets={["symmetric-key"]}
            onSingleScan={() => setFollowOnOpen(true)}
          />
          <Dialog open={followOnOpen} onOpenChange={setFollowOnOpen}>
            <DialogContent>
              <DialogTitle>共通鍵を取り込みます</DialogTitle>
              <button type="button">保存確認</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "鍵QRを読み取る" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () => emitScannedPayload("OCK1:key"))

    const followOn = await screen.findByRole("dialog", {
      name: "共通鍵を取り込みます",
    })
    expect(
      within(followOn).getByRole("button", { name: "保存確認" }),
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
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
      />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
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
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    ).toBeDisabled()
    expect(
      screen.queryByText(
        "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",
      ),
    ).not.toBeInTheDocument()

    await act(async () => delivery.resolve())

    expect(
      screen.getByText(
        "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",
      ),
    ).toBeInTheDocument()
  })

  it("auto-closes after an open multipart completion and keeps its SHA-256 notice", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn()
    render(
      <QrScannerModal
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete }}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 1)),
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "QRコードを読み取る" }),
      ).not.toBeInTheDocument(),
    )
    expect(onComplete).toHaveBeenCalledOnce()
    expect(
      screen.getByText(
        "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",
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
        triggerLabel="暗号文QRを読み取る"
        singleTargets={["message"]}
        onSingleScan={vi.fn()}
        multipart={{ session, onComplete: vi.fn() }}
      />,
    )

    expect(
      screen.getByText("複数QR読取中: 受信 1 / 3"),
    ).toBeInTheDocument()
    state = { kind: "idle" }
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(
      screen.getByText(
        "読取期限を過ぎたため、一時読取状態を破棄しました。",
      ),
    ).toBeInTheDocument()
  })
})
