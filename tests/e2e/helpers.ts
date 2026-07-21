import { expect, type BrowserContext, type Page } from "@playwright/test"

export const AES_ALGORITHM_LABEL = "共通鍵 — AES-256-GCM"
export const RSA_ALGORITHM_LABEL = "公開鍵 — RSA-OAEP-3072 + AES-256-GCM"

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function expectOnlineGate(page: Page): Promise<void> {
  await expect(
    page.getByText("オンラインではPWAの導入のみ利用できます"),
  ).toBeVisible()
  await expect(page.getByRole("img", { name: /アプリアイコン/ })).toBeVisible()
  await expect(page.getByText("PWAインストール状態")).toBeVisible()
  await expect(page.getByText("オフライン利用準備状態")).toBeVisible()
  await expect(
    page.getByText("オフライン（機内モード）に切り替えると全機能が利用できます。"),
  ).toBeVisible()
  await expect(page.getByText("オンライン", { exact: true })).toBeVisible()
  await expect(page.getByRole("navigation")).toBeHidden()
}

export async function loadOnlineGate(page: Page, path = "/encrypt"): Promise<void> {
  await page.goto(path)
  await expectOnlineGate(page)
}

export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload({ waitUntil: "domcontentloaded" })
    await expectOnlineGate(page)
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 15_000,
    })
    .toBe(true)
}

export async function switchToOfflineApp(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await waitForServiceWorkerControl(page)
  await context.setOffline(true)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(
    page.getByText("オンラインではPWAの導入のみ利用できます"),
  ).toBeHidden()
  await expect(mainNavigation(page)).toBeVisible()
}

export async function openOfflineApp(
  page: Page,
  context: BrowserContext,
  path = "/encrypt",
): Promise<void> {
  await loadOnlineGate(page, path)
  await switchToOfflineApp(page, context)
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
