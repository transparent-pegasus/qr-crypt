import { expect, test } from "@playwright/test"
import {
  acknowledgeOfflineRisk,
  createPqIdentity,
  detailValue,
  encryptSignedPq,
  expectOfflineAcknowledgement,
  installWorkerProbe,
  loadOnlineGate,
  mainNavigation,
  precachedUrls,
  seedSelfPublicBundle,
  waitForServiceWorkerControl,
  workerObservations,
} from "./helpers"

test("completes offline PQ keygen, Encaps, Decaps, and signature verification using only precached Workers", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  await installWorkerProbe(page)
  await loadOnlineGate(page, "/encrypt")
  await waitForServiceWorkerControl(page)

  const cached = await precachedUrls(page)
  const cachedWorkerPaths = cached
    .map((url) => new URL(url).pathname)
    .filter((path) => /\/assets\/pq-crypto\.worker-[A-Za-z0-9_-]+\.js$/.test(path))
  expect(cachedWorkerPaths.length).toBeGreaterThanOrEqual(1)

  // First prove the committed online -> offline acknowledgement edge, then reload.
  await context.setOffline(true)
  await expectOfflineAcknowledgement(page)
  await acknowledgeOfflineRisk(page)
  await expect(mainNavigation(page)).toBeVisible()
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(mainNavigation(page)).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "Confirm before continuing",
    }),
  ).toBeHidden()

  const identityName = "オフラインPQ統合ID"
  const plaintext = "オフラインで鍵生成から署名検証まで完了する日本語本文"
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  const { payload, result } = await encryptSignedPq(page, {
    identityName,
    plaintext,
  })
  expect(Number.parseInt(await detailValue(result, "QR frame count"), 10)).toBeGreaterThan(
    1,
  )

  await page.getByRole("tab", { name: "Decrypt", exact: true }).click()
  await page.getByLabel("Ciphertext payload").fill(payload)
  const decrypt = page.getByRole("button", { name: "Decrypt", exact: true })
  await expect(decrypt).toBeEnabled()
  await decrypt.click()
  await expect(page.getByText("The signature is valid for this key")).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible()

  const observations = await workerObservations(page)
  const workers = observations.filter(
    (entry) => entry.kind === "constructed" && entry.scriptUrl !== undefined,
  )
  expect(workers.length).toBeGreaterThanOrEqual(2)
  for (const worker of workers) {
    expect(worker.name).toBe("qr-crypt-pq-crypto")
    const path = new URL(worker.scriptUrl!, page.url()).pathname
    expect(cachedWorkerPaths).toContain(path)
  }
  const operations = observations
    .filter((entry) => entry.kind === "operation")
    .map((entry) => entry.operation)
  expect(operations).toEqual(
    expect.arrayContaining([
      "generateIdentityKeys",
      "encryptPqMessage",
      "openPqEnvelope",
      "verifySignedMessage",
    ]),
  )
})
