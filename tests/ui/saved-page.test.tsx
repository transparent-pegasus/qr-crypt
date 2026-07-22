import "./helpers/module-mocks"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeArtifacts, markQrViewed, renderQrDataUrl } from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

describe("saved QR page", () => {
  beforeEach(() => {
    resetUi()
    fakeArtifacts.push({
      id: "saved-key-1",
      name: "保存した共通鍵",
      kind: "symmetric-key",
      sensitivity: "secret",
      algorithm: "A256GCM",
      payload: "OCM1:sym-key-00000001",
      payloadSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      byteLength: 25,
      createdAt: 1_723_000_000_000,
      keyId: "sym-key-00000001",
    })
  })
  afterEach(resetUi)

  it("shows complete SHA-256 details and records viewing only after QR rendering", async () => {
    const user = userEvent.setup()
    await renderApp("/saved")
    const title = await screen.findByText("保存した共通鍵")
    const rowButton = title.closest("button")
    expect(rowButton).not.toBeNull()
    await user.click(rowButton as HTMLButtonElement)
    const details = await screen.findByRole("dialog", { name: "保存した共通鍵" })
    expect(
      within(details).getByText(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      ),
    ).toBeInTheDocument()
    expect(markQrViewed).not.toHaveBeenCalled()

    await user.click(within(details).getByRole("checkbox", { name: /第三者に見せない/ }))
    await user.click(within(details).getByRole("button", { name: "QRを表示" }))
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(renderQrDataUrl.mock.calls.at(-1)?.[0]).toMatch(/^OC/)
    await waitFor(() =>
      expect(markQrViewed).toHaveBeenCalledWith("saved-key-1", expect.any(Number)),
    )
  })
})
