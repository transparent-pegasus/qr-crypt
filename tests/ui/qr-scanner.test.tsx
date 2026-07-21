import "./helpers/module-mocks"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    await user.click(screen.getByRole("button", { name: "キャンセル" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    view.unmount()
    expect(scannerStop).toHaveBeenCalled()
  })
})
