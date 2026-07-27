import { expect, test, type Page, type Request } from "@playwright/test"
import {
  collectAnimatedFramePayloads,
  createPqIdentity,
  emitInjectedQr,
  encryptSignedPq,
  expectStableTrailingDialogClose,
  injectedScanSnapshot,
  installInjectedDecoderStream,
  loadOnlineGate,
  openOfflineApp,
  seedSelfPublicBundle,
} from "./helpers"

interface ObservedRequest {
  body: string | null
  method: string
  url: string
}

function requestObservation(request: Request): ObservedRequest {
  return {
    body: request.postData(),
    method: request.method(),
    url: request.url(),
  }
}

function expectAllowedRelayRequest(request: ObservedRequest): void {
  const url = new URL(request.url)
  expect(request.body).toBeNull()
  if (url.pathname === "/reachability-sentinel.txt") {
    expect(request.method).toBe("GET")
    expect([...url.searchParams.keys()]).toEqual(["n"])
    return
  }
  if (url.pathname === "/manifest.webmanifest" && request.method === "HEAD") {
    expect([...url.searchParams.keys()]).toEqual(["reach"])
    return
  }
  expect(request.method).toBe("GET")
  expect(
    url.pathname === "/" ||
      url.pathname === "/encrypt" ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/sw.js" ||
      url.pathname === "/registerSW.js" ||
      /^\/workbox-[A-Za-z0-9_-]+\.js$/.test(url.pathname) ||
      /^\/(?:assets|icons)\//.test(url.pathname),
  ).toBe(true)
}

async function assertNoRelayPersistence(
  page: Page,
  needles: readonly string[],
): Promise<void> {
  const snapshot = await page.evaluate(async () => {
    const cacheValues: string[] = []
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      for (const request of await cache.keys()) {
        cacheValues.push(request.url)
        try {
          const response = await cache.match(request)
          if (response) cacheValues.push(await response.clone().text())
        } catch {
          // Opaque/binary cache entries remain covered by their keys.
        }
      }
    }

    const databaseValues: string[] = []
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open("qr-crypt")
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const database = opening.result
        const names = Array.from(database.objectStoreNames)
        if (names.length === 0) {
          database.close()
          resolve()
          return
        }
        const transaction = database.transaction(names, "readonly")
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        for (const name of names) {
          const request = transaction.objectStore(name).getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            databaseValues.push(JSON.stringify(request.result))
          }
        }
      }
    })

    const errors =
      (
        window as Window & {
          __relayE2eErrors?: string[]
        }
      ).__relayE2eErrors ?? []
    return {
      cacheValues,
      databaseValues,
      errors,
      historyState: JSON.stringify(history.state),
      href: location.href,
      localStorageEntries: Object.entries(localStorage),
      title: document.title,
      visibleText: document.body.innerText,
    }
  })

  expect(snapshot.localStorageEntries.map(([key]) => key).sort()).toEqual(
    expect.arrayContaining(["oc-lang", "oc-offline-ack-pending", "oc-theme"]),
  )
  expect(
    snapshot.localStorageEntries.every(([key]) =>
      ["oc-lang", "oc-offline-ack-pending", "oc-online-tab", "oc-theme"].includes(key),
    ),
  ).toBe(true)
  // Tapping the relay tab persists the choice; only the two tab literals are storable.
  expect(Object.fromEntries(snapshot.localStorageEntries)["oc-online-tab"]).toMatch(
    /^(?:top|relay)$/,
  )
  const inspected = [
    ...snapshot.cacheValues,
    ...snapshot.databaseValues,
    ...snapshot.errors,
    ...snapshot.localStorageEntries.flat(),
    snapshot.historyState,
    snapshot.href,
    snapshot.title,
    snapshot.visibleText,
  ]
  for (const needle of needles) {
    for (const value of inspected) expect(value).not.toContain(needle)
  }
}

test("relays verbatim header-declared message frames without frame-bearing persistence or requests", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(180_000)
  const sourceContext = await browser.newContext({
    baseURL: "http://localhost:4173",
  })
  const source = await sourceContext.newPage()
  let framePayloads: string[]
  try {
    const identityName = "relay-source-identity"
    await openOfflineApp(source, sourceContext, "/keys")
    await createPqIdentity(source, identityName)
    await seedSelfPublicBundle(source, identityName)
    const { result } = await encryptSignedPq(source, {
      identityName,
      plaintext: "relay-e2e-ciphertext-source",
    })
    framePayloads = await collectAnimatedFramePayloads(
      result.getByRole("region", { name: "Ciphertext frame display" }),
    )
  } finally {
    await sourceContext.close()
  }

  const marker = "RELAY_E2E_MARKER_7f9c2a"
  const requests: ObservedRequest[] = []
  const consoleValues: string[] = []
  page.on("request", (request) => requests.push(requestObservation(request)))
  page.on("console", (message) => consoleValues.push(message.text()))
  page.on("pageerror", (error) => consoleValues.push(error.message))
  await page.addInitScript(() => {
    const target = window as Window & { __relayE2eErrors?: string[] }
    target.__relayE2eErrors = []
    window.addEventListener("error", (event) => {
      target.__relayE2eErrors?.push(String(event.message))
    })
    window.addEventListener("unhandledrejection", (event) => {
      target.__relayE2eErrors?.push(String(event.reason))
    })
  })
  await installInjectedDecoderStream(page)
  await context.grantPermissions(["camera", "clipboard-read", "clipboard-write"])
  await page.setViewportSize({ width: 360, height: 320 })
  await loadOnlineGate(page)

  const relayNavigationButton = page.getByRole("button", {
    name: "Relay",
    exact: true,
  })
  await expect(
    page.getByRole("navigation", { name: "Online navigation" }),
  ).toBeVisible()
  await relayNavigationButton.click()
  const scanButton = page.getByRole("button", { name: "QR → text" })
  await scanButton.click()
  const capture = page.getByRole("dialog", {
    name: "QR frames to text",
  })
  await expect(capture).toBeVisible()
  await expectStableTrailingDialogClose(capture, "Close")
  await page.keyboard.press("Escape")
  await expect(capture).toBeHidden()
  await scanButton.click()
  await expect(capture).toBeVisible()
  expect(await injectedScanSnapshot(page)).toEqual([])
  await capture.getByRole("button", { name: "Start camera" }).click()
  await expect.poll(async () => (await injectedScanSnapshot(page)).length).toBe(1)

  await emitInjectedQr(page, `OCF2:${marker}`)
  const fixedRejection = capture.getByText("The frame is not a canonical OCF2 frame.")
  await expect(fixedRejection).toBeVisible()
  await expect(fixedRejection).not.toContainText(marker)

  const shuffled = [
    framePayloads.at(-1)!,
    framePayloads[0]!,
    framePayloads.at(-1)!,
    ...framePayloads.slice(1, -1).reverse(),
  ]
  for (const framePayload of shuffled) {
    await emitInjectedQr(page, framePayload)
  }
  const relayText = framePayloads.join("\n")
  await expect(capture.getByLabel("Relay text")).toHaveValue(relayText)
  await capture.getByRole("button", { name: "Copy relay text" }).click()
  await capture.getByRole("button", { name: "Close" }).click()

  await relayNavigationButton.click()
  const playbackButton = page.getByRole("button", { name: "Text → QR" })
  await playbackButton.click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR frames",
  })
  await expectStableTrailingDialogClose(playback, "Close")
  await page.keyboard.press("Escape")
  await expect(playback).toBeHidden()
  await playbackButton.click()
  await expect(playback).toBeVisible()
  await playback
    .getByLabel("Relay text")
    .fill(`${framePayloads.slice().reverse().join("\r\n")}\r\n`)
  await playback.getByRole("button", { name: "Show QR frames" }).click()
  await expect(
    playback.getByText("This relay provides no app file-download controls."),
  ).toBeVisible()
  for (const name of ["Export all PNGs", "Export ZIP", "Current SVG"]) {
    await expect(playback.getByRole("button", { name })).toHaveCount(0)
  }

  await playback.getByLabel("Relay text").fill(`OCF2:${marker}`)
  await playback.getByRole("button", { name: "Show QR frames" }).click()
  const playbackRejection = playback.getByText("The frame is not a canonical OCF2 frame.")
  await expect(playbackRejection).toBeVisible()
  await expect(playbackRejection).not.toContainText(marker)
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"))
  })
  await expect(playback).toBeHidden()

  await page.evaluate(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(
        handler,
        timeout === 10 * 60_000 ? 20 : timeout,
        ...args,
      )) as typeof window.setTimeout
  })
  await relayNavigationButton.click()
  await scanButton.click()
  await page
    .getByRole("dialog", { name: "QR frames to text" })
    .getByRole("button", { name: "Start camera" })
    .click()
  await emitInjectedQr(page, framePayloads[0]!)
  await expect(
    page.getByText(
      "The relay session timed out and its app-held frame references were cleared.",
    ),
  ).toBeVisible()
  expect((await injectedScanSnapshot(page)).every(({ active }) => !active)).toBe(true)

  for (const request of requests) {
    expectAllowedRelayRequest(request)
    expect(request.url).not.toContain(marker)
    expect(request.url).not.toContain(framePayloads[0]!)
    expect(request.body ?? "").not.toContain(marker)
    expect(request.body ?? "").not.toContain(framePayloads[0]!)
  }
  for (const value of consoleValues) {
    expect(value).not.toContain(marker)
    expect(value).not.toContain(framePayloads[0]!)
  }
  await assertNoRelayPersistence(page, [marker, framePayloads[0]!, relayText])
})
