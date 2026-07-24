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

test("expands encrypted PQ seeds in the Worker after reload and decrypts a signed message", async ({
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
  await page.getByRole("tab", { name: "Decrypt", exact: true }).click()
  await page.getByLabel("Ciphertext payload").fill(payload)
  const decrypt = page.getByRole("button", { name: "Decrypt", exact: true })
  await expect(decrypt).toBeEnabled()
  await decrypt.click()
  await expect(page.getByText("The signature is valid for this key")).toBeVisible({
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
