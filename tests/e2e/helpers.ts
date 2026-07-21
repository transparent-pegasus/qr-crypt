import { expect, type Page } from "@playwright/test"

export const AES_ALGORITHM_LABEL = "共通鍵 — AES-256-GCM"
export const RSA_ALGORITHM_LABEL = "公開鍵 — RSA-OAEP-3072 + AES-256-GCM"

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function createSymmetricKey(page: Page, name: string): Promise<void> {
  await page.goto("/keys")
  await page.getByLabel("鍵名", { exact: true }).fill(name)
  await page.getByRole("button", { name: "共通鍵を生成", exact: true }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

export async function createRsaKeyPair(page: Page, name: string): Promise<void> {
  await page.goto("/keys")
  await page.getByRole("tab", { name: "公開鍵ペア", exact: true }).click()
  await page.getByLabel("鍵ペア名", { exact: true }).fill(name)
  await page.getByRole("button", { name: "鍵ペアを生成", exact: true }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 })
}

export async function chooseOption(
  page: Page,
  label: string,
  option: string | RegExp,
): Promise<void> {
  const trigger = page.getByLabel(label, { exact: true })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page.getByRole("option", { name: option }).click()
}

export async function encryptWithStoredKey(
  page: Page,
  args: {
    keyName: string
    plaintext: string
    algorithmLabel?: string
  },
): Promise<{ payload: string }> {
  await page.goto("/encrypt")
  if (args.algorithmLabel !== undefined) {
    await chooseOption(page, "暗号化方式", args.algorithmLabel)
  }
  await chooseOption(
    page,
    "使用鍵",
    new RegExp(`^${escapeRegex(args.keyName)}\\s+—`),
  )
  await page.getByLabel("平文", { exact: true }).fill(args.plaintext)
  await page.getByRole("button", { name: "暗号化する", exact: true }).click()

  const result = page.getByRole("region", { name: "暗号結果" })
  await expect(result).toBeVisible()
  await expect(result.getByRole("img", { name: "暗号文QRの画像" })).toBeVisible()
  const payload = (await result.locator("p").first().innerText()).trim()
  expect(payload).toMatch(/^OCM1:/)
  return { payload }
}

export function mainNavigation(page: Page) {
  return page.getByRole("navigation", { name: "メインナビゲーション" })
}
