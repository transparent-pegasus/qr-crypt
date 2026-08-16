import "./helpers/module-mocks"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { QrDisplay } from "@/components/qr-display"
import { env } from "@/schemas/env-schema"
import { resetUi } from "./helpers/render-app"

type FullscreenControls = (closeSlot: ReactNode) => ReactNode
type FullscreenShape = "custom" | "none"

function controlsForShape(shape: FullscreenShape): FullscreenControls | undefined {
  if (shape === "custom") {
    return (closeSlot) => (
      <div data-testid="custom-close-slot">
        <button type="button">Custom action</button>
        {closeSlot}
      </div>
    )
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

  it.each(["custom", "none"] as const)(
    "places exactly one trailing close in the %s shape and retains Escape dismissal",
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
      expect(close).toHaveClass("border-slate-300")

      if (shape === "custom") {
        expect(
          within(screen.getByTestId("custom-close-slot")).getAllByRole(
            "button",
            { name: "Close" },
          ),
        ).toHaveLength(1)
        expect(dialog.querySelector("[data-fullscreen-close-row]")).toBeNull()
      } else {
        expect(dialog.querySelector("[data-fullscreen-close-row]")).toContainElement(
          close,
        )
        expect(tabbableButtons).toEqual([close])
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

  it("renders a left-aligned icon-only trigger without data-size metadata", async () => {
    render(
      <QrDisplay
        payload="OCF2:single-frame"
        ecLevel="Q"
        size={env.qrRenderSize}
        title="Single-frame QR"
      />,
    )

    const trigger = screen.getByRole("button", { name: "View full screen" })
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(trigger).toHaveTextContent("")
    expect(trigger.parentElement).toHaveClass("justify-start")
    expect(screen.queryByText(/Data size/i)).not.toBeInTheDocument()
  })
})
