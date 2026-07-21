import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  encryptWithStoredKey,
  mainNavigation,
  openOfflineApp,
} from "./helpers"

test("共通鍵生成から暗号文 QR の保存、改名、削除、鍵全消去まで", async ({
  context,
  page,
}) => {
  const keyName = "フロー共通鍵"
  const qrName = "フロー保存QR"
  const renamedQr = "改名済みフローQR"

  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)

  await page.getByRole("button", { name: `${keyName}の操作` }).click()
  await page.getByRole("menuitem", { name: "QRを表示", exact: true }).click()
  const initialWarning = page.getByRole("alertdialog", {
    name: "共通鍵QRを表示します",
  })
  await expect(initialWarning).toContainText(
    "このQRコードには暗号化と復号に使用できる秘密鍵が含まれています",
  )
  await initialWarning.getByRole("button", { name: "表示する" }).click()

  const keyQrDialog = page.getByRole("dialog", { name: /共通鍵QR/ })
  await expect(keyQrDialog.getByText("最高機密の情報です")).toBeVisible()
  const keyQrSave = keyQrDialog.getByRole("button", { name: "保存", exact: true })
  await expect(keyQrSave).toBeDisabled()
  await keyQrDialog.getByRole("checkbox", { name: "リスクを理解しました" }).check()
  await expect(keyQrSave).toBeEnabled()
  await keyQrDialog.getByRole("button", { name: "Close" }).click()
  await expect(keyQrDialog).toBeHidden()

  await encryptWithStoredKey(page, {
    keyName,
    plaintext: "保存フローを確認する日本語平文",
  })
  const result = page.getByRole("region", { name: "暗号結果" })
  await result.getByLabel("QR名", { exact: true }).fill(qrName)
  await result.getByRole("button", { name: "保存", exact: true }).click()
  await expect(result.getByRole("status")).toContainText("保存しました")

  await mainNavigation(page).getByRole("link", { name: /^保存済み/ }).click()
  await expect(page.getByText(qrName, { exact: true })).toBeVisible()

  await page.getByRole("button", { name: `${qrName}の操作` }).click()
  await page.getByRole("menuitem", { name: "表示", exact: true }).click()
  const savedQrDialog = page.getByRole("dialog", { name: new RegExp(qrName) })
  await expect(
    savedQrDialog.getByRole("img", { name: `${qrName}の画像` }),
  ).toBeVisible()
  await savedQrDialog.getByRole("button", { name: "Close" }).click()
  await expect(savedQrDialog).toBeHidden()

  await page.getByRole("button", { name: `${qrName}の操作` }).click()
  await page.getByRole("menuitem", { name: "名前を変更", exact: true }).click()
  const renameDialog = page.getByRole("dialog", { name: "QR名を変更" })
  await renameDialog.getByLabel("新しいQR名").fill(renamedQr)
  await renameDialog.getByRole("button", { name: "変更する" }).click()
  await expect(page.getByText(renamedQr, { exact: true })).toBeVisible()

  await page.getByRole("button", { name: `${renamedQr}の操作` }).click()
  await page.getByRole("menuitem", { name: "削除", exact: true }).click()
  const deleteDialog = page.getByRole("alertdialog", {
    name: "保存済みQRを削除しますか",
  })
  await expect(deleteDialog).toContainText("この操作は元に戻せません")
  await deleteDialog.getByRole("button", { name: "削除する" }).click()
  await expect(page.getByText("保存済みのQRはありません")).toBeVisible()

  await mainNavigation(page).getByRole("link", { name: /^設定/ }).click()
  await page.getByRole("button", { name: "すべての鍵を消去" }).click()
  const clearKeysDialog = page.getByRole("alertdialog", {
    name: "すべての鍵を消去",
  })
  const clearKeysButton = clearKeysDialog.getByRole("button", {
    name: "完全に消去する",
  })
  await expect(clearKeysButton).toBeDisabled()
  await clearKeysDialog.getByLabel("確認文字列").fill("全削除")
  await expect(clearKeysButton).toBeEnabled()
  await clearKeysButton.click()
  await expect(page.getByText("すべての鍵を消去しました")).toBeVisible()
  await expect(page.getByText("保存鍵", { exact: true }).locator("..")).toContainText(
    "0 件",
  )
})
