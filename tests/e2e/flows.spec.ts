import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  encryptWithStoredKey,
  goToOfflinePage,
  openOfflineApp,
  rawQrArtifacts,
} from "./helpers"

test("鍵 QR は保存・重複検知・表示・改名・削除でき、暗号文は永続化しない", async ({
  context,
  page,
}) => {
  const keyName = "フロー共通鍵"
  const qrName = "フロー保存鍵QR"
  const renamedQr = "改名済みフロー鍵QR"

  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)
  await page.getByRole("button", { name: "秘密鍵QRを表示", exact: true }).click()

  const keyQrDialog = page.getByRole("dialog", { name: "共通鍵QR" })
  await expect(keyQrDialog.getByText("機密情報", { exact: true })).toBeVisible()
  await keyQrDialog.getByLabel("QR名", { exact: true }).fill(qrName)
  const save = keyQrDialog.getByRole("button", {
    name: "保存済み鍵QRへ保存",
  })
  await expect(save).toBeDisabled()
  await keyQrDialog.getByRole("checkbox", { name: "リスクを理解しました" }).check()
  await save.click()
  await expect(page.getByText("鍵QRを保存しました", { exact: true })).toBeVisible()

  await save.click()
  const duplicate = page.getByRole("alertdialog", {
    name: "同じ内容の鍵QRが保存済みです",
  })
  await expect(duplicate).toContainText("重複保存")
  await expect(duplicate.getByRole("button", { name: "重複して保存" })).toBeVisible()
  await duplicate.getByRole("button", { name: "キャンセル" }).click()
  expect(await rawQrArtifacts(page)).toHaveLength(1)

  await keyQrDialog.getByRole("button", { name: "Close" }).click()
  const beforeEncryption = await rawQrArtifacts(page)
  expect(beforeEncryption).toHaveLength(1)
  expect(beforeEncryption[0]?.kind).toBe("symmetric-key")

  await encryptWithStoredKey(page, {
    keyName,
    plaintext: "暗号文をアプリ管理領域へ保存しない日本語平文",
  })
  const result = page.getByRole("region", { name: "暗号結果" })
  await expect(result.getByLabel("出力名", { exact: true })).toBeVisible()
  await expect(result.getByLabel("QR名", { exact: true })).toHaveCount(0)
  await expect(result.getByRole("button", { name: "保存", exact: true })).toHaveCount(0)
  await expect(result.getByText(/保存済みを開く|重複して保存/)).toHaveCount(0)
  expect(await rawQrArtifacts(page)).toEqual(beforeEncryption)

  await page.reload({ waitUntil: "domcontentloaded" })
  expect(await rawQrArtifacts(page)).toEqual(beforeEncryption)

  await goToOfflinePage(page, "/saved")
  await expect(page.getByText("メッセージ暗号文はアプリ内へ保存しません。")).toBeVisible()
  await page.getByText(qrName, { exact: true }).click()
  const saved = page.getByRole("dialog", { name: qrName })
  await saved
    .getByRole("checkbox", { name: "第三者に見せないことを理解しました" })
    .check()
  await saved.getByRole("button", { name: "QRを表示" }).click()
  await expect(saved.getByRole("img", { name: `${qrName}の画像` })).toBeVisible()
  await saved.getByLabel("名前", { exact: true }).fill(renamedQr)
  await saved.getByRole("button", { name: "名前を変更" }).click()
  await expect(page.getByRole("dialog", { name: renamedQr })).toBeVisible()
  await page
    .getByRole("dialog", { name: renamedQr })
    .getByRole("button", { name: "削除" })
    .click()
  await page
    .getByRole("alertdialog", { name: "保存済み鍵QRを削除しますか?" })
    .getByRole("button", { name: "削除する" })
    .click()
  await expect(page.getByText("保存済み鍵QRはありません。")).toBeVisible()
  expect(await rawQrArtifacts(page)).toHaveLength(0)
})
