import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  goToOfflinePage,
  openOfflineApp,
} from "./helpers"

test("320px 幅で鍵タブが横 overflow せず3等分になる", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openOfflineApp(page, context, "/keys")

  const tablist = page.getByRole("tablist")
  const tabs = tablist.getByRole("tab")
  await expect(tabs).toHaveCount(3)
  const overflow = await tablist.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  const widths = await tabs.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().width),
  )

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
})

test("共通 Close の寸法・タイトル余白・固定位置と非表示指定を保つ", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, "レイアウト検証鍵")
  await page
    .getByRole("button", { name: "秘密鍵QRを表示", exact: true })
    .click()

  const keyDialog = page.getByRole("dialog", { name: "共通鍵QR" })
  await keyDialog.getByRole("checkbox", { name: "リスクを理解しました" }).check()
  const longName = "非常に長い保存済み共通鍵QR名".repeat(4)
  await keyDialog.getByLabel("QR名", { exact: true }).fill(longName)
  await keyDialog
    .getByRole("button", { name: "保存済み鍵QRへ保存" })
    .click()
  await expect(
    page.getByText("共通鍵QRを保存しました", { exact: true }),
  ).toBeVisible()

  const fullscreenButton = keyDialog.getByRole("button", {
    name: "全画面表示",
  })
  await expect(fullscreenButton).toBeEnabled()
  await fullscreenButton.click()
  const fullscreen = page.getByRole("dialog", {
    name: "共通鍵QRを全画面表示",
  })
  await expect(fullscreen.locator("button.absolute")).toBeHidden()
  await expect(
    fullscreen.getByRole("button", { name: "閉じる", exact: true }),
  ).toBeVisible()
  await fullscreen
    .getByRole("button", { name: "閉じる", exact: true })
    .click()

  await keyDialog.getByRole("button", { name: "Close", exact: true }).click()
  await goToOfflinePage(page, "/saved")
  await page.getByText(longName, { exact: true }).click()
  const savedDialog = page.getByRole("dialog", { name: longName })
  const savedClose = savedDialog.getByRole("button", {
    name: "Close",
    exact: true,
  })
  await expect
    .poll(async () => (await savedClose.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(40)
  const [closeBox, titleBox] = await Promise.all([
    savedClose.boundingBox(),
    savedDialog.getByRole("heading", { name: longName }).boundingBox(),
  ])
  expect(closeBox).not.toBeNull()
  expect(titleBox).not.toBeNull()
  expect(closeBox!.width).toBeGreaterThanOrEqual(40)
  expect(closeBox!.height).toBeGreaterThanOrEqual(40)
  const intersects =
    titleBox!.x < closeBox!.x + closeBox!.width &&
    titleBox!.x + titleBox!.width > closeBox!.x &&
    titleBox!.y < closeBox!.y + closeBox!.height &&
    titleBox!.y + titleBox!.height > closeBox!.y
  expect(intersects).toBe(false)

  await savedClose.click()
  await goToOfflinePage(page, "/encrypt")
  await page.getByRole("tab", { name: "復号", exact: true }).click()
  await page
    .getByRole("button", { name: "暗号文QRを読み取る", exact: true })
    .click()
  const scannerDialog = page.getByRole("dialog", {
    name: "暗号文QRを読み取る",
  })
  const scannerClose = scannerDialog.getByRole("button", {
    name: "Close",
    exact: true,
  })
  const scrollRegion = scannerDialog.locator(
    "[data-qr-scanner-scroll-region]",
  )
  await expect
    .poll(async () => (await scannerClose.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(40)
  const before = await scannerClose.boundingBox()
  const scrollCapacity = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(scrollCapacity.scrollHeight).toBeGreaterThan(
    scrollCapacity.clientHeight,
  )
  await scrollRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect
    .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  const after = await scannerClose.boundingBox()

  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(0.5)
})
