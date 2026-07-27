import { expect, test } from "@playwright/test"
import {
  acknowledgeOfflineRisk,
  createPqIdentity,
  detailValue,
  encryptSignedPq,
  expectOfflineAcknowledgement,
  goToOfflinePage,
  installWorkerProbe,
  loadOnlineGate,
  mainNavigation,
  precachedUrls,
  seedSelfPublicBundle,
  waitForServiceWorkerControl,
  workerObservations,
} from "./helpers"

test("initializes the precached same-origin reader WASM on its first offline camera use", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  await loadOnlineGate(page, "/keys")
  await waitForServiceWorkerControl(page)

  const appOrigin = new URL(page.url()).origin
  const cached = await precachedUrls(page)
  const readerWasmUrls = cached.filter((url) => {
    const parsed = new URL(url)
    return /^\/assets\/zxing_reader-[A-Za-z0-9_-]{6,}\.wasm$/.test(
      parsed.pathname,
    )
  })
  expect(readerWasmUrls).toHaveLength(1)
  const readerWasmUrl = readerWasmUrls[0]!
  const readerWasm = new URL(readerWasmUrl)
  expect(readerWasm.origin).toBe(appOrigin)
  expect(
    await page.evaluate(async (url) => {
      for (const cacheName of await caches.keys()) {
        if ((await (await caches.open(cacheName)).match(url)) !== undefined) return true
      }
      return false
    }, readerWasmUrl),
  ).toBe(true)
  expect(
    await page.evaluate((wasmPath) =>
      performance
        .getEntriesByType("resource")
        .some((entry) => new URL(entry.name).pathname === wasmPath),
    readerWasm.pathname),
  ).toBe(false)

  await context.setOffline(true)
  await expectOfflineAcknowledgement(page)
  await acknowledgeOfflineRisk(page)
  await expect(mainNavigation(page)).toBeVisible()

  const runtimeRequests: string[] = []
  const externalRequests: string[] = []
  const readerRequestFailures: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    runtimeRequests.push(url)
    const parsed = new URL(url)
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin !== appOrigin
    ) {
      externalRequests.push(url)
    }
  })
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname !== readerWasm.pathname) return
    readerRequestFailures.push(
      `${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    )
  })

  await page.getByRole("tab", { name: "Other parties' keys", exact: true }).click()
  await page.getByRole("button", { name: "Import a key", exact: true }).click()
  await page
    .getByRole("button", {
      name: "Scan a key QR code",
      exact: true,
    })
    .click()

  const dialog = page.getByRole("dialog", { name: "Scan a key QR code" })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText("QR codes can be read in any order", { exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const video = document.querySelector(
            'video[aria-label="Camera video for QR scanning"]',
          )
          if (!(video instanceof HTMLVideoElement)) return false
          const stream = video.srcObject
          return (
            stream instanceof MediaStream &&
            stream.getTracks().some((track) => track.readyState === "live")
          )
        }),
      // Same budget as the reader-ready wait above: bringing the camera up behind
      // the precached WASM outruns the 5s default whenever the workers contend.
      { timeout: 30_000 },
    )
    .toBe(true)

  expect(
    runtimeRequests.filter(
      (url) => new URL(url).pathname === readerWasm.pathname,
    ),
  ).toHaveLength(1)
  expect(externalRequests).toEqual([])
  expect(readerRequestFailures).toEqual([])

  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
})

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

  await result.getByRole("button", { name: "Close" }).click()
  await goToOfflinePage(page, "/decrypt")
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
