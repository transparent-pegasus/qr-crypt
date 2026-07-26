import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  createPqIdentity,
  createSymmetricKey,
  expectStableTrailingDialogClose,
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

interface FullscreenLabels {
  close: string
  compatibility: string
  dialogName: RegExp
  next: string
  pause: string
  previous: string
  trigger: string
}

async function expectAnimatedFullscreenLayout(
  page: Page,
  detail: Locator,
  viewport: { width: number; height: number; portrait: boolean },
  labels: FullscreenLabels,
): Promise<void> {
  await page.setViewportSize(viewport)
  await detail.getByRole("button", { name: labels.trigger, exact: true }).click()
  const fullscreen = page.getByRole("dialog", { name: labels.dialogName })
  await expect(fullscreen).toBeVisible()
  await fullscreen.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    )
  })

  const image = fullscreen.getByRole("img")
  const controls = fullscreen.locator("[data-fullscreen-controls]")
  const transport = controls.locator('[data-transport-controls="fullscreen"]')
  const orderedControls = transport.locator("button")
  const expectedNames = [
    labels.previous,
    labels.pause,
    labels.next,
    labels.compatibility,
    labels.close,
  ]

  await expect(orderedControls).toHaveCount(5)
  for (const [index, name] of expectedNames.entries()) {
    await expect(orderedControls.nth(index)).toHaveAccessibleName(name)
  }
  await expect(
    transport.getByRole("button", { name: labels.close, exact: true }),
  ).toHaveCount(1)
  await expect(
    fullscreen.getByRole("button", { name: labels.close, exact: true }),
  ).toHaveCount(1)
  await expect(
    transport.getByRole("switch", {
      name: labels.compatibility,
      exact: true,
    }),
  ).toHaveCount(1)
  await expect(fullscreen.getByRole("slider")).toHaveCount(0)

  const close = orderedControls.nth(4)
  expect(await close.evaluate((element) => getComputedStyle(element).position)).not.toBe(
    "absolute",
  )
  for (const [label, locator] of [
    ["QR image", image],
    ...expectedNames.map(
      (name, index) => [name, orderedControls.nth(index)] as const,
    ),
  ] as const) {
    await expect(locator).toBeVisible()
    await expectInsideViewport(locator, viewport.width, viewport.height, label)
  }

  const imageBox = await image.boundingBox()
  expect(imageBox).not.toBeNull()
  for (const [index, name] of expectedNames.entries()) {
    const controlBox = await orderedControls.nth(index).boundingBox()
    expect(controlBox, `${name} has a box`).not.toBeNull()
    const intersectsQr =
      controlBox!.x < imageBox!.x + imageBox!.width &&
      controlBox!.x + controlBox!.width > imageBox!.x &&
      controlBox!.y < imageBox!.y + imageBox!.height &&
      controlBox!.y + controlBox!.height > imageBox!.y
    expect(
      intersectsQr,
      `${viewport.width}x${viewport.height} ${name}/QR overlap`,
    ).toBe(false)
  }

  for (const [label, locator] of [
    ["fullscreen", fullscreen],
    ["fullscreen controls", controls],
    ["transport row", transport],
  ] as const) {
    const overflow = await locator.evaluate((element) => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    }))
    expect(
      overflow.scrollWidth,
      `${viewport.width}x${viewport.height} ${label} horizontal overflow`,
    ).toBeLessThanOrEqual(overflow.clientWidth)
    expect(
      overflow.scrollHeight,
      `${viewport.width}x${viewport.height} ${label} vertical overflow`,
    ).toBeLessThanOrEqual(overflow.clientHeight)
  }
  await expectInsideViewport(
    controls,
    viewport.width,
    viewport.height,
    "controls",
  )
  if (viewport.portrait) {
    expect(Math.min(imageBox!.width, imageBox!.height)).toBeGreaterThanOrEqual(240)
  } else {
    await expect(controls.locator("details")).toHaveCount(0)
    expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(300)
  }

  await close.click()
  await expect(fullscreen).toBeHidden()
  await expect(detail).toBeVisible()
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

test("keeps shared closes bottom-right, last in tab order, and outside every scroll body", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 320 })
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

  await expectStableTrailingDialogClose(savedDialog, "Close")
  await page.keyboard.press("Escape")
  await expect(savedDialog).toBeHidden()
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
  await expect
    .poll(async () => (await scannerClose.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(40)
  await expectStableTrailingDialogClose(scannerDialog, "Close")
  await page.keyboard.press("Escape")
  await expect(scannerDialog).toBeHidden()
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
    await expectAnimatedFullscreenLayout(page, detail, viewport, {
      close: "Close",
      compatibility: "Compatibility mode",
      dialogName: /View .*public-key bundle.* full screen/,
      next: "Next",
      pause: "Pause",
      previous: "Previous",
      trigger: "View full screen",
    })
  }

  await page.evaluate(() => localStorage.setItem("oc-lang", "ja"))
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: new RegExp(identityName) }).click()
  const japaneseDetail = page.getByRole("dialog", { name: identityName })
  await japaneseDetail
    .getByRole("button", { name: "公開鍵セットQR", exact: true })
    .click()
  for (const viewport of [
    { width: 360, height: 640, portrait: true },
    { width: 740, height: 360, portrait: false },
  ]) {
    await expectAnimatedFullscreenLayout(page, japaneseDetail, viewport, {
      close: "閉じる",
      compatibility: "互換モード",
      dialogName: /を全画面表示$/,
      next: "次へ",
      pause: "一時停止",
      previous: "前へ",
      trigger: "全画面表示",
    })
  }
})
