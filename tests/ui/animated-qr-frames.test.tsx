import "./helpers/module-mocks"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import type { QrFrameV2 } from "@/schemas/domain"
import { resetUi } from "./helpers/render-app"

function frame(frameIndex: number, frameCount: number): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16),
    artifactType: "pq-message",
    frameIndex,
    frameCount,
    totalByteLength: frameCount,
    payloadSha256: new Uint8Array(32),
    chunk: Uint8Array.of(frameIndex),
  }
}

describe("AnimatedQrFrames", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("shows one-based English missing-frame positions and the current speed grid", () => {
    render(
      <AnimatedQrFrames
        frames={[frame(0, 3), frame(2, 3)]}
        frameIntervalMs={1_000}
        outputName="test"
      />,
    )

    expect(
      screen.getByText(
        "Missing frames: frame 2. Recovery is not possible while frames are missing.",
      ),
    ).toBeInTheDocument()
    const speed = screen.getByLabelText("Display speed")
    expect(speed).toHaveAttribute("min", "1000")
    expect(speed).toHaveAttribute("max", "3000")
    expect(speed).toHaveAttribute("step", "500")
    fireEvent.change(speed, { target: { value: "2500" } })
    expect(speed).toHaveValue("2500")
  })
})
