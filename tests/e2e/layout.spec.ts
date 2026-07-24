import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  goToOfflinePage,
  openOfflineApp,
} from "./helpers"

test("splits key tabs evenly without horizontal overflow at 320px", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openOfflineApp(page, context, "/keys")

  const tablist = page.getByRole("tablist")
  const tabs = tablist.getByRole("tab")
  await expect(tabs).toHaveCount(2)
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

test("preserves shared Close dimensions, title spacing, fixed position, and hidden state", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, "レイアウト検証鍵")
  await goToOfflinePage(page, "/saved")
  await page.getByRole("button", { name: /レイアウト検証鍵/ }).click()
  const savedDialog = page.getByRole("dialog", { name: "レイアウト検証鍵" })
  const savedClose = savedDialog.getByRole("button", {
    name: "Close",
    exact: true,
  })
  await expect
    .poll(async () => (await savedClose.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(40)
  const [closeBox, titleBox] = await Promise.all([
    savedClose.boundingBox(),
    savedDialog
      .getByRole("heading", { name: "レイアウト検証鍵" })
      .boundingBox(),
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
  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "Import", exact: true }).click()
  await page
    .getByRole("button", { name: "Scan a key QR code", exact: true })
    .click()
  const scannerDialog = page.getByRole("dialog", {
    name: "Scan a key QR code",
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
