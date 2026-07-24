import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  encryptWithStoredKey,
  goToOfflinePage,
  openOfflineApp,
  rawQrArtifacts,
} from "./helpers"

test("supports creation through key listing, QR display, and deletion without persisting QR or ciphertext", async ({
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
  const result = page.getByRole("region", { name: "Encryption result" })
  await expect(result.getByLabel("Output name", { exact: true })).toBeVisible()
  await expect(result.getByLabel("QR name", { exact: true })).toHaveCount(0)
  await expect(result.getByRole("button", { name: "Save", exact: true })).toHaveCount(0)
  await expect(result.getByText(/Saved|Duplicate|Save key QR/)).toHaveCount(0)
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await page.reload({ waitUntil: "domcontentloaded" })
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await goToOfflinePage(page, "/saved")
  await expect(page.getByRole("heading", { name: "Key list" })).toBeVisible()
  await expect(page.getByText("Message ciphertext is not stored in the app.")).toBeVisible()
  await page.getByText(keyName, { exact: true }).click()
  let dialog = page.getByRole("dialog", { name: keyName, exact: true })
  await expect(dialog.getByText("AES-256-GCM", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Show secret-key QR" }).click()

  dialog = page.getByRole("dialog", { name: "Symmetric-key QR", exact: true })
  await expect(dialog.getByRole("img", { name: "Symmetric-key QR image" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "PNG", exact: true })).toBeDisabled()
  await dialog.getByRole("checkbox", { name: "I understand the risk" }).check()
  await expect(dialog.getByRole("button", { name: "PNG", exact: true })).toBeEnabled()
  await expect(dialog.getByText(/Saved|Save key QR/)).toHaveCount(0)
  expect(await rawQrArtifacts(page)).toHaveLength(0)

  await dialog.getByRole("button", { name: "Back to details" }).click()
  dialog = page.getByRole("dialog", { name: keyName, exact: true })
  await dialog.getByRole("button", { name: `Delete ${keyName}` }).click()
  await page
    .getByRole("alertdialog", { name: `Delete "${keyName}"?` })
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(keyName, { exact: true })).toHaveCount(0)
  await expect(page.getByText("There are no keys. Create one on the keys page.")).toBeVisible()
  expect(await rawQrArtifacts(page)).toHaveLength(0)
})
