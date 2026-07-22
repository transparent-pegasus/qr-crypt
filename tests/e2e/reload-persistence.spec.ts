import { expect, test } from "@playwright/test"
import {
  createPqIdentity,
  encryptSignedPq,
  installWorkerProbe,
  openOfflineApp,
  rawStoreCount,
  seedSelfPublicBundle,
  workerObservations,
} from "./helpers"

test("暗号化済み PQ シードを reload 後も Worker で展開して署名付き復号できる", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  await installWorkerProbe(page)
  const identityName = "再読込PQ-ID"
  const plaintext = "再読み込み後にML-KEM秘密シードで復号する日本語平文"
  await openOfflineApp(page, context, "/keys")
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  const { payload } = await encryptSignedPq(page, { identityName, plaintext })

  await page.reload({ waitUntil: "domcontentloaded" })
  expect(await rawStoreCount(page, "pqIdentities")).toBe(1)
  expect(await rawStoreCount(page, "pqPublicBundles")).toBe(1)
  await page.getByRole("tab", { name: "復号", exact: true }).click()
  await page.getByLabel("暗号文ペイロード").fill(payload)
  const decrypt = page.getByRole("button", { name: "復号する", exact: true })
  await expect(decrypt).toBeEnabled()
  await decrypt.click()
  await expect(page.getByText("署名はこの鍵に対して有効です")).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible()

  const operations = (await workerObservations(page))
    .filter((entry) => entry.kind === "operation")
    .map((entry) => entry.operation)
  expect(operations).toEqual(
    expect.arrayContaining(["openPqEnvelope", "verifySignedMessage"]),
  )
})
