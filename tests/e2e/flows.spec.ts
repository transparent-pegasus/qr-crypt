import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  encryptWithStoredKey,
  expectNoQrArtifactStore,
  goToOfflinePage,
  openOfflineApp,
} from "./helpers"

test("supports creation through key listing, QR display, and deletion without persisting QR or ciphertext", async ({
  context,
  page,
}) => {
  const keyName = "フロー共通鍵"
  const plaintext = "暗号文をアプリ管理領域へ保存しない日本語平文"

  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)
  await expectNoQrArtifactStore(page)

  const { payload } = await encryptWithStoredKey(page, {
    keyName,
    plaintext,
  })
  const result = page.getByRole("dialog", { name: "Encryption complete" })
  await expect(result.getByLabel("Output name", { exact: true })).toBeVisible()
  await expect(result.getByLabel("QR name", { exact: true })).toHaveCount(0)
  await expect(result.getByRole("button", { name: "Save", exact: true })).toHaveCount(0)
  await expect(result.getByText(/Saved|Duplicate|Save key QR/)).toHaveCount(0)
  await expectNoQrArtifactStore(page)

  await page.reload({ waitUntil: "domcontentloaded" })
  await expectNoQrArtifactStore(page)

  await goToOfflinePage(page, "/decrypt")
  await page.getByLabel("Ciphertext payload").fill(payload)
  await page.getByRole("button", { name: "Decrypt", exact: true }).click()
  const decrypted = page.getByRole("dialog", { name: "Decryption complete" })
  await expect(decrypted.getByText(plaintext, { exact: true })).toBeVisible()
  await decrypted.getByRole("button", { name: "Close", exact: true }).click()
  await expectNoQrArtifactStore(page)

  await goToOfflinePage(page, "/keys")
  await expect(page.getByRole("tab", { name: "My keys", exact: true })).toBeVisible()
  await page.getByText(keyName, { exact: true }).click()
  let dialog = page.getByRole("dialog", { name: keyName, exact: true })
  await expect(dialog.getByText("AES-256-GCM", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Show secret-key QR" }).click()

  dialog = page.getByRole("dialog", { name: "Symmetric-key QR", exact: true })
  // The acknowledgement gates the key QR itself, not just its actions: nothing
  // renders the secret until the user confirms they accept being shown it.
  await expect(dialog.getByRole("img", { name: "Symmetric-key QR image" })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Download", exact: true })).toHaveCount(0)
  await dialog.getByRole("checkbox", { name: "I understand the risk" }).check()
  await expect(dialog.getByRole("img", { name: "Symmetric-key QR image" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Download", exact: true })).toBeEnabled()
  await expect(dialog.getByText(/Saved|Save key QR/)).toHaveCount(0)
  await expectNoQrArtifactStore(page)

  await dialog.getByRole("button", { name: "Back to details" }).click()
  dialog = page.getByRole("dialog", { name: keyName, exact: true })
  await dialog.getByRole("button", { name: `Delete ${keyName}` }).click()
  await page
    .getByRole("alertdialog", { name: `Delete "${keyName}"?` })
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(keyName, { exact: true })).toHaveCount(0)
  await expect(page.getByText("You have no keys.")).toBeVisible()
  await expectNoQrArtifactStore(page)
})
