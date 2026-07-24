import "./helpers/module-mocks"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  deleteBundle,
  deleteIdentity,
  deleteKeyRecord,
  fakeBundles,
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

  it("defaults to owned keys, merges newest-first, and filters with one kind select", async () => {
    const user = userEvent.setup()
    await renderKeyList()

    expect(screen.getByRole("heading", { name: "鍵一覧" })).toBeInTheDocument()
    const ownTab = screen.getByRole("tab", { name: "自分の鍵" })
    const peerTab = screen.getByRole("tab", { name: "相手の鍵" })
    expect(ownTab).toHaveAttribute("aria-selected", "true")
    expect(peerTab).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tablist")).toHaveClass(
      "grid",
      "h-11",
      "w-full",
      "grid-cols-2",
    )
    const kindFilter = screen.getByRole("combobox", { name: "種別" })
    expect(screen.getAllByRole("combobox")).toHaveLength(1)
    expect(kindFilter).toHaveClass("h-11")
    expect(kindFilter).toHaveTextContent("すべて")

    const rows = within(screen.getByRole("tabpanel")).getAllByRole("button")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("自分のPQ ID")
    expect(rows[1]).toHaveTextContent("共通鍵A")
    expect(screen.getByText("自分のPQ ID")).toBeInTheDocument()
    expect(screen.getByText(/ポスト量子ID ·/)).toBeInTheDocument()
    expect(screen.getByText("active")).toBeInTheDocument()
    expect(screen.getByText("共通鍵A")).toBeInTheDocument()
    expect(screen.getByText(/共通鍵 ·/)).toBeInTheDocument()
    expect(screen.getByText("AES-256-GCM")).toBeInTheDocument()
    expect(screen.queryByText("公開")).not.toBeInTheDocument()
    expect(screen.queryByText("機密")).not.toBeInTheDocument()
    expect(screen.queryByText("受信鍵B")).not.toBeInTheDocument()
    expect(screen.queryByText("確認済みの相手")).not.toBeInTheDocument()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText("3".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("1".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("2".repeat(64))).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(kindFilter)
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "すべて",
      "ポスト量子ID",
      "共通鍵",
    ])
    await user.click(screen.getByRole("option", { name: "共通鍵" }))
    expect(screen.getByText("共通鍵A")).toBeInTheDocument()
    expect(screen.queryByText("自分のPQ ID")).not.toBeInTheDocument()

    await user.click(rowFor("共通鍵A"))
    dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    expect(within(dialog).getByText("sym-key-00000001")).toBeInTheDocument()
    expect(within(dialog).getByText("AES-256-GCM")).toBeInTheDocument()
  })

  it("shows imported bundles only on the peer-key tab and keeps their actions", async () => {
    const user = userEvent.setup()
    const recordId = fakeBundles[0]!.recordId
    await renderKeyList()

    expect(screen.queryByText("確認済みの相手")).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "相手の鍵" }))
    expect(screen.getByText("確認済みの相手")).toBeInTheDocument()
    expect(screen.getByText("人物確認済み")).toBeInTheDocument()
    expect(screen.getByText("4".repeat(64))).toBeInTheDocument()
    expect(screen.getByText("5".repeat(64))).toBeInTheDocument()
    expect(screen.getByText("6".repeat(64))).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "種別" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "削除" }))
    await waitFor(() => expect(deleteBundle).toHaveBeenCalledWith(recordId))
    expect(
      await screen.findByText("取り込んだ公開鍵セットがありません。"),
    ).toBeInTheDocument()
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
        frameCount: 20,
      }),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameBytes")

    await user.click(within(dialog).getByRole("button", { name: "詳細に戻る" }))
    await user.click(within(dialog).getByRole("button", { name: "暗号化用単鍵QR" }))
    expect(splitIntoFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artifactType: "pq-kem-public-key",
        frameBytes: 280,
      }),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")

    await user.click(within(dialog).getByRole("button", { name: "詳細に戻る" }))
    await user.click(within(dialog).getByRole("button", { name: "署名検証用単鍵QR" }))
    expect(splitIntoFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artifactType: "pq-dsa-public-key",
        frameBytes: 280,
      }),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

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
    fakeBundles.splice(0)
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
    expect(screen.getByText("自分の鍵がありません。")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "相手の鍵" }))
    expect(
      screen.getByText("取り込んだ公開鍵セットがありません。"),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "鍵ページを開く" })).toHaveAttribute(
      "href",
      "/keys",
    )
  })

  it("shows one source error while continuing to render the other source", async () => {
    listIdentities.mockRejectedValueOnce(new Error("identity read failed"))
    await renderKeyList()
    expect(await screen.findByText("ポスト量子IDを読み込めません")).toBeInTheDocument()
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
