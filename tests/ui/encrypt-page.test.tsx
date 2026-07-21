import "./helpers/module-mocks"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  fakeArtifacts,
  fakePwa,
  renderQrDataUrl,
  saveQrArtifact,
  updateServiceWorker,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(await screen.findByLabelText(label))
  await user.click(await screen.findByRole("option", { name: option }))
}

describe("encrypt page", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("filters key choices when the encryption method changes", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    const keySelect = await screen.findByLabelText("使用鍵")
    await user.click(keySelect)
    expect(await screen.findByRole("option", { name: /共通鍵A/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /受信鍵B/ })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")

    await chooseSelectOption(user, "暗号化方式", "公開鍵 — RSA-OAEP-3072 + AES-256-GCM")
    await user.click(screen.getByLabelText("使用鍵"))
    expect(await screen.findByRole("option", { name: /受信鍵B/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /相手の公開鍵/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /共通鍵A/ })).not.toBeInTheDocument()
  })

  it("disables encryption for no key, empty text, and UTF-8 byte overflow", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    const encryptButton = await screen.findByRole("button", { name: "暗号化する" })
    expect(encryptButton).toBeDisabled()

    await chooseSelectOption(user, "使用鍵", "共通鍵A — 0017")
    expect(encryptButton).toBeDisabled()
    const textarea = screen.getByLabelText("平文")
    await user.type(textarea, "短い平文")
    expect(encryptButton).toBeEnabled()

    fireEvent.change(textarea, { target: { value: "a".repeat(4097) } })
    expect(encryptButton).toBeDisabled()
    expect(screen.getByText("平文の上限を超えています")).toBeInTheDocument()
    expect(screen.getByText(/4097 \/ 4096 bytes/)).toBeInTheDocument()
  })

  it("encrypts, renders only an OC payload, saves it, and confirms duplicates", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "使用鍵", "共通鍵A — 0017")
    await user.type(screen.getByLabelText("平文"), "保存してよい平文")
    await user.click(screen.getByRole("button", { name: "暗号化する" }))

    expect(await screen.findByText("暗号化が完了しました")).toBeInTheDocument()
    const resultRegion = screen.getByRole("region", { name: "暗号結果" })
    expect(within(resultRegion).getByText(/^OCM1:/)).toBeInTheDocument()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    for (const [payload] of renderQrDataUrl.mock.calls) {
      expect(payload).toMatch(/^OC/)
      expect(payload).not.toContain("保存してよい平文")
    }

    await user.click(within(resultRegion).getByRole("button", { name: "保存" }))
    await waitFor(() => expect(saveQrArtifact).toHaveBeenCalledTimes(1))
    expect(fakeArtifacts).toHaveLength(1)
    expect(fakeArtifacts[0]?.payload).toMatch(/^OC/)
    expect(fakeArtifacts[0]?.payload).not.toContain("保存してよい平文")

    await user.click(within(resultRegion).getByRole("button", { name: "保存" }))
    const duplicateDialog = await screen.findByRole("alertdialog")
    expect(
      within(duplicateDialog).getByText("同じ内容のQRが保存済みです"),
    ).toBeInTheDocument()
    await user.click(
      within(duplicateDialog).getByRole("button", { name: "重複して保存" }),
    )
    await waitFor(() => expect(fakeArtifacts).toHaveLength(2))

    expect(
      Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.key(index),
      ),
    ).toEqual(["oc-theme"])
  })

  it("does not apply a pending PWA update automatically and preserves plaintext", async () => {
    fakePwa.needRefresh = true
    const user = userEvent.setup()
    await renderApp("/encrypt")
    const textarea = await screen.findByLabelText("平文")
    await user.type(textarea, "更新前に保持する平文")

    expect(screen.getByText("新しいバージョンがあります")).toBeInTheDocument()
    expect(textarea).toHaveValue("更新前に保持する平文")
    expect(updateServiceWorker).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "更新する" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/入力中の平文は消去されます/)).toBeInTheDocument()
    expect(updateServiceWorker).not.toHaveBeenCalled()
    expect(textarea).toHaveValue("更新前に保持する平文")

    await user.click(within(dialog).getByRole("button", { name: "更新する" }))
    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
