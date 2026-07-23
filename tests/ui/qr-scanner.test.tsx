import "./helpers/module-mocks"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/crypto/errors"
import type { CameraDiagnostic } from "@/qr/decode"
import { emitScannedPayload, scannerStop, startQrScan } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

describe("QrScannerDialog", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("requests the camera only while open, rejects mismatches, and always stops", async () => {
    const { QrScannerDialog } = await import("@/components/qr-scanner-dialog")
    const onScan = vi.fn()
    const onOpenChange = vi.fn()
    const view = render(
      <QrScannerDialog
        open={false}
        onOpenChange={onOpenChange}
        target="symmetric-key"
        onScan={onScan}
      />,
    )
    expect(startQrScan).not.toHaveBeenCalled()

    view.rerender(
      <QrScannerDialog
        open
        onOpenChange={onOpenChange}
        target="symmetric-key"
        onScan={onScan}
      />,
    )
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(1))
    emitScannedPayload("OCP1:not-a-symmetric-key")
    expect(
      await screen.findByText(
        "これは公開鍵のQRです。読取対象を共通鍵に切り替えてください。",
      ),
    ).toBeInTheDocument()
    expect(onScan).not.toHaveBeenCalled()
    expect(scannerStop).toHaveBeenCalled()

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "カメラを再起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole("button", { name: "キャンセル" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    view.unmount()
    expect(scannerStop).toHaveBeenCalled()
  })

  it("preserves the typed camera message after rejection and shows a separate diagnostic", async () => {
    const cameraError = new AppError("CAMERA_NOT_AVAILABLE")
    startQrScan.mockImplementationOnce(async (_video, _onText, onError) => {
      const reportError = onError as unknown as (
        error: AppError,
        diagnostic: CameraDiagnostic,
      ) => void
      reportError(cameraError, { phase: "acquiring", name: "NotReadableError" })
      throw cameraError
    })
    const { QrScannerDialog } = await import("@/components/qr-scanner-dialog")

    render(
      <QrScannerDialog
        open
        onOpenChange={vi.fn()}
        target="message"
        onScan={vi.fn()}
      />,
    )

    expect(await screen.findByText(cameraError.userMessage)).toBeInTheDocument()
    expect(
      screen.queryByText(
        "カメラを起動できませんでした。ブラウザーの設定でカメラを許可してください。",
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("診断: NotReadableError @acquiring"),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("カメラ診断").closest('[role="alert"]')).toBeNull()
  })
})
