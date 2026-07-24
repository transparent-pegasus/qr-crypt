import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  encryptWithStoredKey,
  goToOfflinePage,
  openOfflineApp,
  rawQrArtifacts,
} from "./helpers"

test("作成完了から鍵一覧・QR表示・削除まで操作でき、QRと暗号文を永続化しない", async ({
  context,
  page,
}) => {
  const keyName = "フロー共通鍵"

  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await encryptWithStoredKey(page, {
    keyName,
    plaintext: "暗号文をアプリ管理領域へ保存しない日本語平文",
  })
  const result = page.getByRole("region", { name: "暗号結果" })
  await expect(result.getByLabel("出力名", { exact: true })).toBeVisible()
  await expect(result.getByLabel("QR名", { exact: true })).toHaveCount(0)
  await expect(result.getByRole("button", { name: "保存", exact: true })).toHaveCount(0)
  await expect(result.getByText(/保存済み|重複して保存|鍵QRを保存/)).toHaveCount(0)
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await page.reload({ waitUntil: "domcontentloaded" })
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await goToOfflinePage(page, "/saved")
  await expect(page.getByRole("heading", { name: "鍵一覧" })).toBeVisible()
  await expect(page.getByText("メッセージ暗号文はアプリ内へ保存しません。")).toBeVisible()
  await page.getByText(keyName, { exact: true }).click()
  let dialog = page.getByRole("dialog", { name: keyName, exact: true })
  await expect(dialog.getByText("AES-256-GCM", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "秘密鍵QRを表示" }).click()

  dialog = page.getByRole("dialog", { name: "共通鍵QR", exact: true })
  await expect(dialog.getByRole("img", { name: "共通鍵QRの画像" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "PNG", exact: true })).toBeDisabled()
  await dialog.getByRole("checkbox", { name: "リスクを理解しました" }).check()
  await expect(dialog.getByRole("button", { name: "PNG", exact: true })).toBeEnabled()
  await expect(dialog.getByText(/保存済み|鍵QRを保存/)).toHaveCount(0)
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await dialog.getByRole("button", { name: "詳細に戻る" }).click()
  dialog = page.getByRole("dialog", { name: keyName, exact: true })
  await dialog.getByRole("button", { name: `${keyName}を削除` }).click()
  await page
    .getByRole("alertdialog", { name: `「${keyName}」を削除しますか?` })
    .getByRole("button", { name: "削除する" })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(keyName, { exact: true })).toHaveCount(0)
  await expect(page.getByText("鍵がありません。鍵ページから作成できます。")).toBeVisible()
  expect(await rawQrArtifacts(page)).toHaveLength(0)
})
