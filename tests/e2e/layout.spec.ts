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
    const transport = [
      ["Previous", fullscreen.getByRole("button", { name: "Previous", exact: true })],
      ["Pause", fullscreen.getByRole("button", { name: "Pause", exact: true })],
      ["Next", fullscreen.getByRole("button", { name: "Next", exact: true })],
    ] as const
    for (const [label, locator] of [
      ["QR image", image],
      ["density", density],
      ["speed", speed],
      ["Close", close],
      ...transport,
    ] as const) {
      await expect(locator).toBeVisible()
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
      await expect(controls.locator("details")).toHaveCount(0)
      const controlOverflow = await controls.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      }))
      expect(controlOverflow.scrollHeight).toBeLessThanOrEqual(
        controlOverflow.clientHeight,
      )
      expect(controlOverflow.scrollTop).toBe(0)
      await expectInsideViewport(
        controls,
        viewport.width,
        viewport.height,
        "landscape controls",
      )
      const controlsBox = await controls.boundingBox()
      expect(controlsBox!.height).toBeLessThanOrEqual(300)
    }
    await close.click()
    await expect(fullscreen).toBeHidden()
    await expect(detail).toBeVisible()
  }

  await page.evaluate(() => localStorage.setItem("oc-lang", "ja"))
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.setViewportSize({ width: 740, height: 360 })
  await page.getByRole("button", { name: new RegExp(identityName) }).click()
  const japaneseDetail = page.getByRole("dialog", { name: identityName })
  await japaneseDetail
    .getByRole("button", { name: "公開鍵セットQR", exact: true })
    .click()
  await japaneseDetail
    .getByRole("button", { name: "全画面表示", exact: true })
    .click()
  const japaneseFullscreen = page.getByRole("dialog", { name: /全画面/ })
  await expect(japaneseFullscreen).toBeVisible()
  await japaneseFullscreen.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    )
  })
  for (const [label, locator] of [
    ["前へ", japaneseFullscreen.getByRole("button", { name: "前へ", exact: true })],
    [
      "一時停止",
      japaneseFullscreen.getByRole("button", { name: "一時停止", exact: true }),
    ],
    ["次へ", japaneseFullscreen.getByRole("button", { name: "次へ", exact: true })],
  ] as const) {
    await expect(locator).toBeVisible()
    await expectInsideViewport(locator, 740, 360, label)
  }
  const japaneseControls = japaneseFullscreen.locator("[data-fullscreen-controls]")
  const japaneseOverflow = await japaneseControls.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(japaneseOverflow.scrollHeight).toBeLessThanOrEqual(
    japaneseOverflow.clientHeight,
  )
  expect((await japaneseControls.boundingBox())!.height).toBeLessThanOrEqual(300)
  await japaneseFullscreen
    .getByRole("button", { name: "閉じる", exact: true })
    .click()
})
