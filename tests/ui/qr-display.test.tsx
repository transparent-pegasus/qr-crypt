import "./helpers/module-mocks"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  QrDisplay,
  type QrDisplayFullscreenControls,
} from "@/components/qr-display"
import { env } from "@/schemas/env-schema"
import { resetUi } from "./helpers/render-app"

type FullscreenShape = "transport" | "arbitrary" | "none"

function controlsForShape(
  shape: FullscreenShape,
): QrDisplayFullscreenControls | undefined {
  if (shape === "transport") {
    return {
      kind: "transport",
      render: (closeSlot: ReactNode) => (
        <div data-testid="transport-close-slot">
          <button type="button">Transport action</button>
          {closeSlot}
        </div>
      ),
    }
  }
  if (shape === "arbitrary") {
    return {
      kind: "arbitrary",
      content: <button type="button">Arbitrary action</button>,
    }
  }
  return undefined
}

function FullscreenShapeHarness({ shape }: { shape: FullscreenShape }) {
  const [open, setOpen] = useState(true)
  const fullscreenControls = controlsForShape(shape)
  return (
    <QrDisplay
      payload="OCF2:fullscreen-shape"
      ecLevel="Q"
      size={env.qrRenderSize}
      title={`${shape} QR`}
      {...(fullscreenControls === undefined ? {} : { fullscreenControls })}
      fullscreenOpen={open}
      showFullscreenTrigger={false}
      onFullscreenOpenChange={setOpen}
    />
  )
}

describe("QrDisplay fullscreen close contract", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it.each(["transport", "arbitrary", "none"] as const)(
    "owns exactly one trailing close in the %s shape and retains Escape dismissal",
    async (shape) => {
      const user = userEvent.setup()
      render(<FullscreenShapeHarness shape={shape} />)
      const dialog = await screen.findByRole("dialog", {
        name: new RegExp(`View ${shape} QR full screen`),
      })
      const closeControls = within(dialog).getAllByRole("button", {
        name: "Close",
      })
      expect(closeControls).toHaveLength(1)
      const close = closeControls[0]!
      const tabbableButtons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      )
      expect(tabbableButtons.at(-1)).toBe(close)

      if (shape === "transport") {
        expect(
          within(screen.getByTestId("transport-close-slot")).getAllByRole(
            "button",
            { name: "Close" },
          ),
        ).toHaveLength(1)
        expect(dialog.querySelector("[data-fullscreen-close-row]")).toBeNull()
      } else {
        expect(dialog.querySelector("[data-fullscreen-close-row]")).toContainElement(
          close,
        )
      }

      if (tabbableButtons.length > 1) {
        tabbableButtons.at(-2)!.focus()
        await user.tab()
        expect(close).toHaveFocus()
      }

      await user.keyboard("{Escape}")
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    },
  )
})
