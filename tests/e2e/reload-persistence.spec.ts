import { expect, test } from "@playwright/test"
import {
  createRsaKeyPair,
  encryptWithStoredKey,
  RSA_ALGORITHM_LABEL,
} from "./helpers"

test("IndexedDB の RSA 秘密鍵を reload 後も使って復号できる", async ({ page }) => {
  const keyName = "再読込RSA鍵ペア"
  const plaintext = "再読み込み後に秘密鍵で復号する日本語平文"
  await createRsaKeyPair(page, keyName)
  const { payload } = await encryptWithStoredKey(page, {
    keyName,
    plaintext,
    algorithmLabel: RSA_ALGORITHM_LABEL,
  })

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("tab", { name: "復号", exact: true }).click()
  await page.getByLabel("暗号文ペイロード").fill(payload)
  const decryptButton = page.getByRole("button", { name: "復号する", exact: true })
  await expect(decryptButton).toBeEnabled()
  await decryptButton.click()

  const result = page.getByText("復号結果", { exact: true }).locator("../..")
  await expect(result).toContainText(plaintext)
})
