import "./helpers/module-mocks"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  deleteQrArtifact,
  fakeArtifacts,
  markQrViewed,
  renderQrDataUrl,
  splitIntoFrames,
  splitV2Payload,
} from "./helpers/fakes"
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
      payload: "OCK1:sym-key-00000001",
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
    expect(details).toHaveFocus()
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

  it("re-splits a saved PQ public QR at 300 bytes and marks only its first frame", async () => {
    fakeArtifacts.splice(0, fakeArtifacts.length, {
      id: "saved-pq-identity",
      name: "保存した公開鍵セット",
      kind: "pq-public-identity",
      sensitivity: "public",
      algorithm: "ML-KEM-1024+ML-DSA-87",
      payload: "OCI2:fake",
      payloadSha256: "1".repeat(64),
      byteLength: 9,
      createdAt: 1_723_000_000_100,
      keyId: "I".repeat(22),
    })
    const user = userEvent.setup()
    await renderApp("/saved")
    const title = await screen.findByText("保存した公開鍵セット")
    await user.click(title.closest("button") as HTMLButtonElement)
    const details = await screen.findByRole("dialog", {
      name: "保存した公開鍵セット",
    })
    expect(within(details).getByText("公開鍵セットQR")).toBeInTheDocument()
    expect(
      within(details).queryByRole("checkbox", { name: /第三者に見せない/ }),
    ).not.toBeInTheDocument()

    await user.click(within(details).getByRole("button", { name: "QRを表示" }))
    await waitFor(() => expect(splitV2Payload).toHaveBeenCalledWith("OCI2:fake"))
    expect(splitIntoFrames).toHaveBeenCalledWith({
      artifactType: "pq-public-identity",
      artifactBytes: expect.any(Uint8Array),
      frameBytes: 300,
    })
    await waitFor(() =>
      expect(markQrViewed).toHaveBeenCalledWith(
        "saved-pq-identity",
        expect.any(Number),
      ),
    )
    expect(markQrViewed).toHaveBeenCalledTimes(1)

    await user.click(within(details).getByRole("button", { name: "次のフレーム" }))
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalledTimes(2))
    expect(markQrViewed).toHaveBeenCalledTimes(1)
    expect(within(details).queryByRole("button", { name: "PNG" })).not.toBeInTheDocument()
    expect(within(details).queryByRole("button", { name: "SVG" })).not.toBeInTheDocument()
    expect(
      within(details).getByRole("button", { name: "PNGを一括出力" }),
    ).toBeInTheDocument()
    expect(within(details).getByRole("button", { name: "コピー" })).toBeInTheDocument()
  })

  it("deletes a saved QR only after the confirmation dialog", async () => {
    const user = userEvent.setup()
    await renderApp("/saved")
    const title = await screen.findByText("保存した共通鍵")
    await user.click(title.closest("button") as HTMLButtonElement)
    const details = await screen.findByRole("dialog", { name: "保存した共通鍵" })

    await user.click(within(details).getByRole("button", { name: "削除" }))
    let confirmation = await screen.findByRole("alertdialog", {
      name: "保存済み鍵QRを削除しますか?",
    })
    expect(
      within(confirmation).getByText(
        "保存済み鍵QRを削除しますか? 元に戻せません。",
      ),
    ).toBeInTheDocument()
    expect(deleteQrArtifact).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole("button", { name: "キャンセル" }))
    expect(deleteQrArtifact).not.toHaveBeenCalled()

    await user.click(within(details).getByRole("button", { name: "削除" }))
    confirmation = await screen.findByRole("alertdialog", {
      name: "保存済み鍵QRを削除しますか?",
    })
    await user.click(within(confirmation).getByRole("button", { name: "削除する" }))
    await waitFor(() => expect(deleteQrArtifact).toHaveBeenCalledWith("saved-key-1"))
    expect(fakeArtifacts).toHaveLength(0)
    expect(await screen.findByText("保存済み鍵QRはありません。")).toBeInTheDocument()
  })
})
