import "./helpers/module-mocks"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearAllKeys,
  deleteEntireDatabase,
  fakeFeatures,
  renderQrDataUrl,
  triggerDownload,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

describe("key management", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("requires the exact secret-key warning and strong checkbox before QR actions", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("button", { name: "共通鍵Aの操作" }))
    await user.click(screen.getByRole("menuitem", { name: "QRを表示" }))

    const warning = await screen.findByRole("alertdialog")
    expect(
      within(warning).getByText(/このQRコードには暗号化と復号に使用できる秘密鍵/),
    ).toBeInTheDocument()
    await user.click(within(warning).getByRole("button", { name: "表示する" }))

    const qrDialog = await screen.findByRole("dialog", { name: /共通鍵QR/ })
    expect(within(qrDialog).getByText("最高機密")).toBeInTheDocument()
    const saveButton = within(qrDialog).getByRole("button", { name: "保存" })
    expect(saveButton).toBeDisabled()
    const checkbox = within(qrDialog).getByRole("checkbox", {
      name: "リスクを理解しました",
    })
    await user.click(checkbox)
    expect(saveButton).toBeEnabled()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(renderQrDataUrl.mock.calls.at(-1)?.[0]).toMatch(/^OCK1:/)
  })

  it("exports an OCP1 public-key payload as a txt file", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "公開鍵ペア" }))
    await user.click(await screen.findByRole("button", { name: "受信鍵Bの操作" }))
    await user.click(screen.getByRole("menuitem", { name: "公開鍵をファイル出力" }))
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1))
    const [blob, fileName] = triggerDownload.mock.calls[0] ?? []
    expect(fileName).toMatch(/\.txt$/)
    expect(await (blob as Blob).text()).toMatch(/^OCP1:/)
  })
})

describe("settings", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("requires an exact 全削除 match for both destructive scopes", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    expect(
      await screen.findByText(
        "このアプリが保証するのは、アプリケーションが意図的に平文や秘密鍵を外部送信しないことまでです。",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "オフライン表示は現在のネットワーク状態を示す補助情報であり、安全性の証明ではありません。",
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "すべての鍵を消去" }))
    let dialog = await screen.findByRole("alertdialog")
    const keyInput = within(dialog).getByLabelText("確認文字列")
    const keyAction = within(dialog).getByRole("button", {
      name: "完全に消去する",
    })
    await user.type(keyInput, "全削")
    expect(keyAction).toBeDisabled()
    await user.type(keyInput, "除")
    expect(keyAction).toBeEnabled()
    await user.click(keyAction)
    await waitFor(() => expect(clearAllKeys).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole("button", { name: "全ローカルデータ初期化" }))
    dialog = await screen.findByRole("alertdialog")
    const resetInput = within(dialog).getByLabelText("確認文字列")
    const resetAction = within(dialog).getByRole("button", {
      name: "完全に消去する",
    })
    await user.type(resetInput, "全削除")
    expect(resetAction).toBeEnabled()
    await user.click(resetAction)
    await waitFor(() => expect(deleteEntireDatabase).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/Service Workerのキャッシュは保持します/)).toBeInTheDocument()
  })

  it("explains unavailable Service Worker support", async () => {
    Object.assign(fakeFeatures, { serviceWorker: false })
    await renderApp("/settings", {
      detectFeatures: () => ({ ...fakeFeatures }),
    })
    expect(
      await screen.findByText(
        "この機能は利用できません: Service Worker。オフライン起動と更新通知を利用できません。",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "更新を確認" })).toBeDisabled()
  })
})
