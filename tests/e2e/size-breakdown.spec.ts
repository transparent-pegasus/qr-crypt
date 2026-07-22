import { expect, test } from "@playwright/test"
import {
  chooseOption,
  detailValue,
  openOfflineApp,
  PQ_ALGORITHM_LABEL,
  SIGNED_PQ_ALGORITHM_LABEL,
} from "./helpers"

test("本文入力と署名切替で本文・KEM ct・署名・計・QR枚数を即時再計算する", async ({
  context,
  page,
}) => {
  await openOfflineApp(page, context, "/encrypt")
  const card = page.getByText("実測サイズ内訳", { exact: true }).locator("../..")
  const firstText = "日本語のサイズ内訳"

  await chooseOption(page, "暗号化方式", PQ_ALGORITHM_LABEL)
  await page.getByLabel("平文", { exact: true }).fill(firstText)
  await expect
    .poll(() => detailValue(card, "本文"), { timeout: 5_000 })
    .toBe(`${new TextEncoder().encode(firstText).byteLength} bytes`)
  await expect.poll(() => detailValue(card, "KEM暗号文")).toBe("1088 bytes")
  await expect.poll(() => detailValue(card, "署名")).toBe("0 bytes")
  const unsignedTotal = await detailValue(card, "エンベロープ計")
  const unsignedFrames = await detailValue(card, "QR枚数")
  expect(unsignedTotal).toMatch(/^\d+ bytes$/)
  expect(unsignedFrames).toMatch(/^\d+ 枚$/)

  await chooseOption(page, "暗号化方式", SIGNED_PQ_ALGORITHM_LABEL)
  await expect
    .poll(() => detailValue(card, "署名"), { timeout: 5_000 })
    .toMatch(/^[1-9]\d* bytes$/)
  await expect.poll(() => detailValue(card, "エンベロープ計")).not.toBe(unsignedTotal)
  await expect.poll(() => detailValue(card, "QR枚数")).not.toBe(unsignedFrames)
  await expect(page.getByText(/短文でもポスト量子署名が本文より/)).toBeVisible()

  const longerText = `${firstText}を入力のたびに更新します`
  const signedTotal = await detailValue(card, "エンベロープ計")
  await page.getByLabel("平文", { exact: true }).fill(longerText)
  await expect
    .poll(() => detailValue(card, "本文"), { timeout: 5_000 })
    .toBe(`${new TextEncoder().encode(longerText).byteLength} bytes`)
  await expect.poll(() => detailValue(card, "エンベロープ計")).not.toBe(signedTotal)
})
