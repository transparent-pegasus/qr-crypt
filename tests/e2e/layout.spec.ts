import { expect, test, type Locator } from "@playwright/test"
import {
  createPqIdentity,
  createSymmetricKey,
  goToOfflinePage,
  openOfflineApp,
} from "./helpers"

async function expectInsideViewport(
  locator: Locator,
  width: number,
  height: number,
  label = "element",
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box, `${label} has a box`).not.toBeNull()
  expect(box!.x, `${label} left`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.y, `${label} top`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(width + 0.5)
  expect(box!.y + box!.height, `${label} bottom`).toBeLessThanOrEqual(
    height + 0.5,
  )
}

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
    savedDialog.getByRole("heading", { name: "レイアウト検証鍵" }).boundingBox(),
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
  await page.getByRole("button", { name: "Scan a key QR code", exact: true }).click()
  const scannerDialog = page.getByRole("dialog", {
    name: "Scan a key QR code",
  })
  const scannerClose = scannerDialog.getByRole("button", {
    name: "Close",
    exact: true,
  })
  const scrollRegion = scannerDialog.locator("[data-qr-scanner-scroll-region]")
  await expect
    .poll(async () => (await scannerClose.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(40)
  const before = await scannerClose.boundingBox()
  const scrollCapacity = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(scrollCapacity.scrollHeight).toBeGreaterThan(scrollCapacity.clientHeight)
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

test("fits animated fullscreen QR controls without scrolling in portrait and short landscape", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const identityName = "全画面レイアウトPQ"
  await page.setViewportSize({ width: 360, height: 640 })
  await openOfflineApp(page, context, "/keys")
  await createPqIdentity(page, identityName)
  await goToOfflinePage(page, "/saved")
  await page.getByRole("button", { name: new RegExp(identityName) }).click()
  const detail = page.getByRole("dialog", { name: identityName })
  await detail.getByRole("button", { name: "Public-key bundle QR", exact: true }).click()

  for (const viewport of [
    { width: 360, height: 640, portrait: true },
    { width: 740, height: 360, portrait: false },
  ]) {
    await page.setViewportSize(viewport)
    await detail.getByRole("button", { name: "View full screen", exact: true }).click()
    const fullscreen = page.getByRole("dialog", {
      name: /View .*public-key bundle.* full screen/,
    })
    await expect(fullscreen).toBeVisible()
    await fullscreen.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      )
    })
    const image = fullscreen.getByRole("img", { name: /Full-screen .* image/ })
    const density = fullscreen.getByLabel("Frame density", { exact: true })
    const speed = fullscreen.getByLabel("Display speed", { exact: true })
    const close = fullscreen.getByRole("button", { name: "Close", exact: true })
    for (const [label, locator] of [
      ["QR image", image],
      ["density", density],
      ["speed", speed],
      ["Close", close],
    ] as const) {
      await expectInsideViewport(locator, viewport.width, viewport.height, label)
    }
    const overflow = await fullscreen.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight)
    const controls = fullscreen.locator("[data-fullscreen-controls]")
    await expectInsideViewport(
      controls,
      viewport.width,
      viewport.height,
      "controls",
    )
    if (viewport.portrait) {
      const imageBox = await image.boundingBox()
      expect(Math.min(imageBox!.width, imageBox!.height)).toBeGreaterThanOrEqual(240)
    } else {
      const restartDetails = controls.locator("details")
      await restartDetails.locator("summary").click()
      await expect(restartDetails).toHaveAttribute("open", "")
      expect(
        await controls.evaluate((element) => getComputedStyle(element).overflowY),
      ).toBe("auto")
      for (const [label, locator] of [
        ["density", density],
        ["density restart warning", restartDetails.locator("summary")],
        ["density restart detail", restartDetails.locator("p")],
        ["speed", speed],
        ["Close", close],
      ] as const) {
        await locator.scrollIntoViewIfNeeded()
        await expectInsideViewport(locator, viewport.width, viewport.height, label)
      }
      await expectInsideViewport(
        controls,
        viewport.width,
        viewport.height,
        "expanded controls",
      )
      const controlsBox = await controls.boundingBox()
      expect(controlsBox!.height).toBeLessThanOrEqual(300)
    }
    await close.click()
    await expect(fullscreen).toBeHidden()
    await expect(detail).toBeVisible()
  }
})
