import "./helpers/module-mocks"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  deleteIdentity,
  deleteKeyRecord,
  fakeIdentities,
  fakeKeys,
  listIdentities,
  listKeyRecords,
  revokeIdentity,
  saveRotation,
  splitIntoFrames,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

function rowFor(text: string): HTMLButtonElement {
  const row = screen.getByText(text).closest("button")
  if (!(row instanceof HTMLButtonElement)) throw new Error(`row not found: ${text}`)
  return row
}

async function renderKeyList(): Promise<void> {
  await renderApp("/saved")
  await screen.findByRole("heading", { name: "鍵一覧" })
}

describe("key list page", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("lists both key kinds without public/confidential sensitivity badges", async () => {
    const user = userEvent.setup()
    await renderKeyList()

    expect(screen.getByRole("heading", { name: "鍵一覧" })).toBeInTheDocument()
    const pqTab = screen.getByRole("tab", { name: "ポスト量子ID" })
    const symmetricTab = screen.getByRole("tab", { name: "共通鍵" })
    expect(pqTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("自分のPQ ID")).toBeInTheDocument()
    expect(screen.getByText(/ポスト量子ID ·/)).toBeInTheDocument()
    expect(screen.getByText("active")).toBeInTheDocument()
    expect(screen.queryByText("共通鍵A")).not.toBeInTheDocument()
    expect(screen.queryByText("公開")).not.toBeInTheDocument()
    expect(screen.queryByText("機密")).not.toBeInTheDocument()
    expect(screen.queryByText("受信鍵B")).not.toBeInTheDocument()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText("3".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("1".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("2".repeat(64))).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(symmetricTab)
    expect(symmetricTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("共通鍵A")).toBeInTheDocument()
    expect(screen.getByText(/共通鍵 ·/)).toBeInTheDocument()
    expect(screen.getByText("AES-256-GCM")).toBeInTheDocument()
    expect(screen.queryByText("自分のPQ ID")).not.toBeInTheDocument()

    await user.click(rowFor("共通鍵A"))
    dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    expect(within(dialog).getByText("sym-key-00000001")).toBeInTheDocument()
    expect(within(dialog).getByText("AES-256-GCM")).toBeInTheDocument()
  })

  it("shows QR views in the same dialog and never offers QR persistence", async () => {
    const user = userEvent.setup()
    await renderKeyList()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "公開鍵セットQR" }))
    dialog = await screen.findByRole("dialog", { name: /公開鍵セット/ })
    expect(within(dialog).getByText(/OCF2フレーム/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "詳細に戻る" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "全画面表示" })).toBeNull()
    expect(within(dialog).queryByText(/保存済み/)).toBeNull()
    expect(splitIntoFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artifactType: "pq-public-identity",
        frameBytes: 280,
      }),
    )
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(screen.getByRole("tab", { name: "共通鍵" }))
    await user.click(rowFor("共通鍵A"))
    dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    await user.click(within(dialog).getByRole("button", { name: "秘密鍵QRを表示" }))
    dialog = await screen.findByRole("dialog", { name: "共通鍵QR" })
    const png = within(dialog).getByRole("button", { name: "PNG" })
    const svg = within(dialog).getByRole("button", { name: "SVG" })
    const copy = within(dialog).getByRole("button", { name: "コピー" })
    expect(png).toBeDisabled()
    expect(svg).toBeDisabled()
    expect(copy).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", { name: "リスクを理解しました" }),
    )
    expect(png).toBeEnabled()
    expect(svg).toBeEnabled()
    expect(copy).toBeEnabled()
    expect(within(dialog).queryByText(/保存済み/)).toBeNull()
  })

  it("retargets selection to the new head after rotate and re-derives after revoke", async () => {
    const user = userEvent.setup()
    const originalId = fakeIdentities[0]!.id
    await renderKeyList()
    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })

    await user.click(within(dialog).getByRole("button", { name: "ローテーション" }))
    await waitFor(() => expect(saveRotation).toHaveBeenCalledOnce())
    expect(fakeIdentities[0]?.id).not.toBe(originalId)
    dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(
      within(dialog).getByRole("button", { name: /旧世代 1 件、復号専用/ }),
    ).toBeInTheDocument()

    const newId = fakeIdentities[0]!.id
    await user.click(within(dialog).getByRole("button", { name: "この端末で失効" }))
    await waitFor(() =>
      expect(revokeIdentity).toHaveBeenCalledWith(newId, expect.any(Number)),
    )
    dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText("revoked")).toBeInTheDocument()
    expect(
      within(dialog).queryByRole("button", { name: "ローテーション" }),
    ).not.toBeInTheDocument()
  })

  it("closes automatically when the selected symmetric key is deleted", async () => {
    const user = userEvent.setup()
    await renderKeyList()
    await user.click(screen.getByRole("tab", { name: "共通鍵" }))
    await user.click(rowFor("共通鍵A"))
    const dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    await user.click(within(dialog).getByRole("button", { name: "共通鍵Aを削除" }))
    const confirmation = await screen.findByRole("alertdialog", {
      name: "「共通鍵A」を削除しますか?",
    })
    await user.click(within(confirmation).getByRole("button", { name: "削除する" }))

    await waitFor(() => expect(deleteKeyRecord).toHaveBeenCalledWith("sym-key-00000001"))
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "共通鍵A" })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText("共通鍵A")).not.toBeInTheDocument()
  })

  it("closes automatically when the selected identity is deleted", async () => {
    const user = userEvent.setup()
    const identityId = fakeIdentities[0]!.id
    await renderKeyList()
    await user.click(rowFor("自分のPQ ID"))
    const dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "自分のPQ IDを削除" }))
    const confirmation = await screen.findByRole("alertdialog", {
      name: "「自分のPQ ID」を削除しますか?",
    })
    await user.click(within(confirmation).getByRole("button", { name: "削除する" }))

    await waitFor(() => expect(deleteIdentity).toHaveBeenCalledWith(identityId))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "自分のPQ ID" }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByText("自分のPQ ID")).not.toBeInTheDocument()
  })

  it("waits for both sources before showing the empty state", async () => {
    const user = userEvent.setup()
    fakeKeys.splice(0)
    fakeIdentities.splice(0)
    let resolveIdentities: ((value: typeof fakeIdentities) => void) | undefined
    listIdentities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIdentities = resolve
        }),
    )
    await renderKeyList()
    expect(screen.queryByText("鍵がありません。鍵ページから作成できます。")).toBeNull()

    resolveIdentities?.([])
    expect(
      await screen.findByText("鍵がありません。鍵ページから作成できます。"),
    ).toBeInTheDocument()
    expect(screen.getByText("ポスト量子IDがありません。")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "共通鍵" }))
    expect(screen.getByText("共通鍵がありません。")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "鍵ページを開く" })).toHaveAttribute(
      "href",
      "/keys",
    )
  })

  it("shows one source error while continuing to render the other source", async () => {
    const user = userEvent.setup()
    listIdentities.mockRejectedValueOnce(new Error("identity read failed"))
    await renderKeyList()
    expect(await screen.findByText("ポスト量子IDを読み込めません")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "共通鍵" }))
    expect(await screen.findByText("共通鍵A")).toBeInTheDocument()

    resetUi()
    listKeyRecords.mockRejectedValueOnce(new Error("key read failed"))
    await renderKeyList()
    expect(await screen.findByText("共通鍵を読み込めません")).toBeInTheDocument()
    expect(screen.getByText("自分のPQ ID")).toBeInTheDocument()
  })

  it("labels unsupported profiles and restricts them to deletion", async () => {
    const user = userEvent.setup()
    fakeIdentities[0] = { ...fakeIdentities[0]!, profile: "balanced" }
    await renderKeyList()
    expect(await screen.findByText("非対応（旧プロファイル）")).toBeInTheDocument()
    await user.click(rowFor("自分のPQ ID"))
    const dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText(/暗号処理とQR再出力はできません/)).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "公開鍵セットQR" })).toBeNull()
    expect(within(dialog).queryByRole("button", { name: "ローテーション" })).toBeNull()
    expect(within(dialog).queryByRole("button", { name: "この端末で失効" })).toBeNull()
    expect(
      within(dialog).getByRole("button", { name: "自分のPQ IDを削除" }),
    ).toBeInTheDocument()
  })
})
