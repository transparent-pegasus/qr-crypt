import { expect, test } from "@playwright/test"
import { createSymmetricKey, encryptWithStoredKey, openOfflineApp } from "./helpers"

test("Service Worker 制御下で完全オフラインの暗号化と QR 表示", async ({
  context,
  page,
}) => {
  await openOfflineApp(page, context)
  await expect(page.locator("header h1")).toBeVisible()
  await expect(page.locator("header h1")).not.toHaveText("")

  const keyName = "オフライン共通鍵"
  await createSymmetricKey(page, keyName)
  await encryptWithStoredKey(page, {
    keyName,
    plaintext: "ネットワークなしで暗号化する日本語の文章",
  })
  await expect(page.getByRole("img", { name: "暗号文QRの画像" })).toBeVisible()
})
