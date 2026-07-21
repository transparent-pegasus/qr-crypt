import { expect, test } from "@playwright/test"
import { createSymmetricKey, encryptWithStoredKey } from "./helpers"

test("Service Worker 制御下で完全オフラインの暗号化と QR 表示", async ({
  context,
  page,
}) => {
  await page.goto("/encrypt")
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload({ waitUntil: "domcontentloaded" })
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 15_000,
    })
    .toBe(true)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator("header h1")).toBeVisible()
    await expect(page.locator("header h1")).not.toHaveText("")

    const keyName = "オフライン共通鍵"
    await createSymmetricKey(page, keyName)
    await encryptWithStoredKey(page, {
      keyName,
      plaintext: "ネットワークなしで暗号化する日本語の文章",
    })
    await expect(
      page.getByRole("img", { name: "暗号文QRの画像" }),
    ).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
