import { expect, test, type Page, type Request } from "@playwright/test"
import {
  buildAad,
  type AesMessageEnvelopeV1,
  type SymmetricKeyEnvelopeV1,
} from "@/crypto/envelope"
import { toBase64Url } from "@/lib/base64url"
import { Encoder } from "cbor-x"
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

const V1_KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const V1_CREATED_AT = 1_700_000_000_000
const MESSAGE_CIPHERTEXT_FILL = 0x5a
const RAW_KEY_TEXT_MARKER = "OCK1_RAW_KEY_MARKER_5D9B_1234567"
const RAW_KEY_BYTES = new TextEncoder().encode(RAW_KEY_TEXT_MARKER)
const fixtureEncoder = new Encoder({ useRecords: false, tagUint8Array: false })

if (RAW_KEY_BYTES.byteLength !== 32) {
  throw new Error("The OCK1 E2E fixture must contain exactly 32 key bytes")
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Importing @/qr/payload in Playwright's Node worker eagerly evaluates the
// browser-only import.meta.env schema through @/lib/limits. Keep this fixture
// encoder to the two v1 kinds under test and mirror the production field order.
// Both relay boundaries still decode and compare it with the production
// encodeEnvelopeToPayload result, so any canonicalisation drift fails closed.
function encodeEnvelopeToPayload(
  envelope: AesMessageEnvelopeV1 | SymmetricKeyEnvelopeV1,
): string {
  const ordered =
    envelope.type === "message"
      ? {
          v: envelope.v,
          type: envelope.type,
          algorithm: envelope.algorithm,
          keyId: envelope.keyId,
          createdAt: envelope.createdAt,
          iv: envelope.iv,
          ciphertext: envelope.ciphertext,
          aad: envelope.aad,
        }
      : {
          v: envelope.v,
          type: envelope.type,
          algorithm: envelope.algorithm,
          keyId: envelope.keyId,
          createdAt: envelope.createdAt,
          key: envelope.key,
        }
  const prefix = envelope.type === "message" ? "OCM1:" : "OCK1:"
  return `${prefix}${toBase64Url(fixtureEncoder.encode(ordered))}`
}

function messagePayload(): string {
  const ciphertext = new Uint8Array(48).fill(MESSAGE_CIPHERTEXT_FILL)
  return encodeEnvelopeToPayload({
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId: V1_KEY_ID,
    createdAt: V1_CREATED_AT,
    iv: new Uint8Array(12).fill(0x22),
    ciphertext,
    aad: buildAad({
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: V1_KEY_ID,
      createdAt: V1_CREATED_AT,
    }),
  })
}

function symmetricKeyPayload(): string {
  return encodeEnvelopeToPayload({
    v: 1,
    type: "symmetric-key",
    algorithm: "A256GCM",
    keyId: V1_KEY_ID,
    createdAt: V1_CREATED_AT,
    key: RAW_KEY_BYTES,
  })
}

async function assertNoRelayPayloadPersistence(
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
    expect.arrayContaining([
      "oc-lang",
      "oc-offline-ack-pending",
      "oc-online-tab",
      "oc-theme",
    ]),
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

test("relays canonical OCM1 messages and OCF2 frames without relay-payload persistence or requests", async ({
  baseURL,
  browser,
  context,
  page,
}) => {
  test.setTimeout(180_000)
  if (baseURL === undefined) throw new Error("E2E_BASE_URL_MISSING")
  const sourceContext = await browser.newContext({
    baseURL,
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

  const relayPayloadMarker = "RELAY_E2E_PAYLOAD_MARKER_7f9c2a"
  const canonicalMessagePayload = messagePayload()
  const canonicalSymmetricKeyPayload = symmetricKeyPayload()
  const decodedMessageMarkers = [
    V1_KEY_ID,
    bytesToHex(new Uint8Array(8).fill(MESSAGE_CIPHERTEXT_FILL)),
  ]
  const rawKeyMarkers = [
    RAW_KEY_TEXT_MARKER,
    bytesToHex(RAW_KEY_BYTES.subarray(0, 8)),
    Array.from(RAW_KEY_BYTES.subarray(0, 8)).join(","),
  ]
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
    name: "QR to text",
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

  await emitInjectedQr(page, canonicalSymmetricKeyPayload)
  const keyCaptureRejection = capture.getByText(
    "Only canonical OCM1 message strings and canonical OCF2 frame strings are accepted.",
  )
  await expect(keyCaptureRejection).toBeVisible()
  await expect(keyCaptureRejection).not.toContainText(canonicalSymmetricKeyPayload)
  for (const rawKeyMarker of rawKeyMarkers) {
    await expect(keyCaptureRejection).not.toContainText(rawKeyMarker)
  }
  await expect(capture.getByLabel("Relay text")).toHaveCount(0)
  await expect(
    capture.getByRole("button", { name: "Copy relay text" }),
  ).toHaveCount(0)

  await emitInjectedQr(page, `OCF2:${relayPayloadMarker}`)
  const fixedRejection = capture.getByText("The frame is not a canonical OCF2 frame.")
  await expect(fixedRejection).toBeVisible()
  await expect(fixedRejection).not.toContainText(relayPayloadMarker)

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

  await scanButton.click()
  await expect(capture).toBeVisible()
  await capture.getByRole("button", { name: "Start camera" }).click()
  await expect.poll(async () => (await injectedScanSnapshot(page)).length).toBe(2)
  await emitInjectedQr(page, canonicalMessagePayload)
  await expect(capture.getByLabel("Relay text")).toHaveValue(
    canonicalMessagePayload,
  )
  const messageCopyButton = capture.getByRole("button", {
    name: "Copy relay text",
  })
  await expect(messageCopyButton).toBeEnabled()
  await messageCopyButton.click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(canonicalMessagePayload)
  await capture.getByRole("button", { name: "Close" }).click()

  await relayNavigationButton.click()
  const playbackButton = page.getByRole("button", { name: "Text → QR" })
  await playbackButton.click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR",
  })
  await expectStableTrailingDialogClose(playback, "Close")
  await page.keyboard.press("Escape")
  await expect(playback).toBeHidden()
  await playbackButton.click()
  await expect(playback).toBeVisible()
  await playback
    .getByLabel("Relay text")
    .fill(`${framePayloads.slice().reverse().join("\r\n")}\r\n`)
  await playback.getByRole("button", { name: "Show QR" }).click()
  await expect(
    playback.getByText("This relay provides no app file-download controls."),
  ).toBeVisible()
  for (const name of ["Export all PNGs", "Export ZIP", "Current SVG"]) {
    await expect(playback.getByRole("button", { name })).toHaveCount(0)
  }

  const playbackInput = playback.getByLabel("Relay text")
  await playbackInput.fill("")
  await playbackInput.focus()
  await page.keyboard.press("Control+V")
  await expect(playbackInput).toHaveValue(canonicalMessagePayload)
  await playback.getByRole("button", { name: "Show QR" }).click()
  await expect(
    playback.getByRole("img", { name: "Relayed OCM1 message image" }),
  ).toHaveCount(1)
  await expect(playback.getByRole("img")).toHaveCount(1)
  await playback.getByRole("button", { name: "Close" }).click()

  await playbackButton.click()
  await expect(playback).toBeVisible()
  await playback.getByLabel("Relay text").fill(`OCF2:${relayPayloadMarker}`)
  await playback.getByRole("button", { name: "Show QR" }).click()
  const playbackRejection = playback.getByText("The frame is not a canonical OCF2 frame.")
  await expect(playbackRejection).toBeVisible()
  await expect(playbackRejection).not.toContainText(relayPayloadMarker)
  await playback.getByLabel("Relay text").fill(canonicalSymmetricKeyPayload)
  await playback.getByRole("button", { name: "Show QR" }).click()
  const keyPlaybackRejection = playback.getByText(
    "Only canonical OCM1 message strings and canonical OCF2 frame strings are accepted.",
  )
  await expect(keyPlaybackRejection).toBeVisible()
  await expect(keyPlaybackRejection).not.toContainText(
    canonicalSymmetricKeyPayload,
  )
  for (const rawKeyMarker of rawKeyMarkers) {
    await expect(keyPlaybackRejection).not.toContainText(rawKeyMarker)
  }
  await expect(playback.getByRole("img")).toHaveCount(0)
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
    .getByRole("dialog", { name: "QR to text" })
    .getByRole("button", { name: "Start camera" })
    .click()
  await emitInjectedQr(page, canonicalMessagePayload)
  await expect(
    page.getByText(
      "The relay session timed out and its app-held payload references were cleared.",
    ),
  ).toBeVisible()
  expect((await injectedScanSnapshot(page)).every(({ active }) => !active)).toBe(true)

  const relayPayloadNeedles = [
    relayPayloadMarker,
    framePayloads[0]!,
    relayText,
    canonicalMessagePayload,
    ...decodedMessageMarkers,
    canonicalSymmetricKeyPayload,
    ...rawKeyMarkers,
  ]
  for (const request of requests) {
    expectAllowedRelayRequest(request)
    for (const needle of relayPayloadNeedles) {
      expect(request.url).not.toContain(needle)
      expect(request.body ?? "").not.toContain(needle)
    }
  }
  for (const value of consoleValues) {
    for (const needle of relayPayloadNeedles) {
      expect(value).not.toContain(needle)
    }
  }
  await assertNoRelayPayloadPersistence(page, relayPayloadNeedles)
})
