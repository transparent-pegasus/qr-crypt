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
import {
  inspectPersistentSurfaces,
  type PersistenceNeedle,
} from "./persistence-inspector"
import { OCK1_SYMMETRIC_KEY } from "../fixtures/relay-v1"

interface ObservedRequest {
  body: string | null
  fromServiceWorker: boolean
  headers: { name: string; value: string }[]
  method: string
  url: string
}

async function requestObservation(request: Request): Promise<ObservedRequest> {
  return {
    body: request.postData(),
    fromServiceWorker: request.serviceWorker() !== null,
    headers: await request.headersArray(),
    method: request.method(),
    url: request.url(),
  }
}

async function awaitRequestObservations(
  pending: readonly Promise<ObservedRequest>[],
): Promise<ObservedRequest[]> {
  const requests: ObservedRequest[] = []
  let next = 0
  while (next < pending.length) {
    const batch = pending.slice(next)
    next += batch.length
    requests.push(...(await Promise.all(batch)))
  }
  return requests
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
  expect([...url.searchParams.keys()]).toEqual([])
  expect(request.method).toBe("GET")
  expect(
    url.pathname === "/" ||
      url.pathname === "/encrypt" ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/sw.js" ||
      url.pathname === "/registerSW.js" ||
      /^\/workbox-[A-Za-z0-9_-]+\.js$/.test(url.pathname) ||
      /^\/(?:assets|icons)\//.test(url.pathname) ||
      (request.fromServiceWorker &&
        (url.pathname === "/index.html" || url.pathname === "/favicon.svg")),
    `Unexpected relay request: ${request.method} ${request.url}`,
  ).toBe(true)
}

const V1_KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const V1_CREATED_AT = 1_700_000_000_000
const MESSAGE_CIPHERTEXT_FILL = 0x5a
const MESSAGE_IV_BYTES = new Uint8Array(12).fill(0x22)
const MESSAGE_CIPHERTEXT_BYTES = new Uint8Array(48).fill(
  MESSAGE_CIPHERTEXT_FILL,
)
const MESSAGE_AAD_BYTES = buildAad({
  v: 1,
  type: "message",
  algorithm: "A256GCM",
  keyId: V1_KEY_ID,
  createdAt: V1_CREATED_AT,
})
const SYMMETRIC_KEY_BYTES = new Uint8Array(32).fill(0x44)
const fixtureEncoder = new Encoder({ useRecords: false, tagUint8Array: false })

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Importing @/qr/payload in Playwright's Node worker eagerly evaluates the
// browser-only import.meta.env schema through @/lib/limits. Keep this fixture
// encoder narrow and mirror the production field order. Accepted OCM1 reaches
// the production decoder/re-encode boundary. OCK1 is refused by prefix before
// decode, so its local output is anchored below to the production-generated
// shared fixture instead of being treated as self-authenticating.
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
  return encodeEnvelopeToPayload({
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId: V1_KEY_ID,
    createdAt: V1_CREATED_AT,
    iv: MESSAGE_IV_BYTES,
    ciphertext: MESSAGE_CIPHERTEXT_BYTES,
    aad: MESSAGE_AAD_BYTES,
  })
}

function symmetricKeyPayload(): string {
  const encoded = encodeEnvelopeToPayload({
    v: 1,
    type: "symmetric-key",
    algorithm: "A256GCM",
    keyId: V1_KEY_ID,
    createdAt: V1_CREATED_AT,
    key: SYMMETRIC_KEY_BYTES,
  })
  if (encoded !== OCK1_SYMMETRIC_KEY) {
    throw new Error("The local OCK1 encoder drifted from the production fixture")
  }
  return OCK1_SYMMETRIC_KEY
}

interface RelayPayloadMarker extends PersistenceNeedle {
  text: string
}

function expectNoRelayPayloadText(
  values: readonly string[],
  markers: readonly RelayPayloadMarker[],
): void {
  for (const { text } of markers) {
    for (const value of values) expect(value).not.toContain(text)
  }
}

function expectNoRelayPayloadHeaders(
  headers: readonly { name: string; value: string }[],
  markers: readonly RelayPayloadMarker[],
): void {
  for (const { text } of markers) {
    for (const { name, value } of headers) {
      expect(name.toLowerCase()).not.toContain(text.toLowerCase())
      expect(value).not.toContain(text)
    }
  }
}

async function assertNoRelayPayloadPersistence(
  page: Page,
  markers: readonly RelayPayloadMarker[],
): Promise<void> {
  const persistence = await inspectPersistentSurfaces(page, markers)
  expect(persistence.matches).toEqual([])

  const snapshot = await page.evaluate(() => {
    const errors =
      (
        window as Window & {
          __relayE2eErrors?: string[]
        }
      ).__relayE2eErrors ?? []
    return {
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
    ...snapshot.errors,
    ...snapshot.localStorageEntries.flat(),
    snapshot.historyState,
    snapshot.href,
    snapshot.title,
    snapshot.visibleText,
  ]
  expectNoRelayPayloadText(inspected, markers)
}

test("the relay persistence oracle detects binary, schema-name, and cookie markers", async ({
  page,
}) => {
  const databaseName = "relay-persistence-oracle-self-test"
  const schemaMarker = "RELAY_SCHEMA_ORACLE_9C2A"
  const storeName = `markers-${schemaMarker}`
  const marker = "RELAY_TYPED_ARRAY_ORACLE_7B4D"
  const markerBytes = Array.from(new TextEncoder().encode(marker))
  const cookieName = "relay-persistence-oracle-self-test"
  const cookieMarker = "RELAY_HTTP_ONLY_COOKIE_ORACLE_4F8A"
  await loadOnlineGate(page)
  await page.context().addCookies([
    {
      name: cookieName,
      value: cookieMarker,
      url: page.url(),
      httpOnly: true,
    },
  ])
  await page.evaluate(
    ({ bytes, name, store }) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open(name, 1)
        opening.onerror = () => reject(opening.error)
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore(store)
        }
        opening.onsuccess = () => {
          const database = opening.result
          const transaction = database.transaction(store, "readwrite")
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction
            .objectStore(store)
            .put(Uint8Array.from(bytes), "typed-array")
        }
      }),
    { bytes: markerBytes, name: databaseName, store: storeName },
  )

  try {
    const inspection = await inspectPersistentSurfaces(page, [
      { marker: "typed-array-self-test", bytes: markerBytes },
      { marker: "schema-name-self-test", text: schemaMarker },
      { marker: "cookie-self-test", text: cookieMarker },
    ])
    expect(inspection.matches).toHaveLength(3)
    expect(inspection.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marker: "schema-name-self-test",
          location: expect.stringContaining(
            `indexedDB:${databaseName}/${storeName}:store-name`,
          ),
        }),
        expect.objectContaining({
          marker: "typed-array-self-test",
          location: expect.stringContaining(
            `indexedDB:${databaseName}/${storeName}.values[0]`,
          ),
        }),
        expect.objectContaining({
          marker: "cookie-self-test",
          location: expect.stringContaining(`:${cookieName}.value:text`),
        }),
      ]),
    )
  } finally {
    await Promise.all([
      page.context().clearCookies({ name: cookieName }),
      page.evaluate(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const deletion = indexedDB.deleteDatabase(name)
            deletion.onerror = () => reject(deletion.error)
            deletion.onblocked = () =>
              reject(new Error(`IndexedDB deletion was blocked: ${name}`))
            deletion.onsuccess = () => resolve()
          }),
        databaseName,
      ),
    ])
  }
})

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
    new TextDecoder().decode(SYMMETRIC_KEY_BYTES),
    bytesToHex(SYMMETRIC_KEY_BYTES.subarray(0, 8)),
    Array.from(SYMMETRIC_KEY_BYTES.subarray(0, 8)).join(","),
  ]
  const pendingRequestObservations: Promise<ObservedRequest>[] = []
  const consoleValues: string[] = []
  context.on("request", (request) =>
    pendingRequestObservations.push(requestObservation(request)),
  )
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

  const createdAtBytes = new Uint8Array(8)
  new DataView(createdAtBytes.buffer).setFloat64(0, V1_CREATED_AT)
  const relayPayloadMarkers: RelayPayloadMarker[] = [
    { marker: "invalid-ocf2-marker", text: relayPayloadMarker },
    { marker: "ocf2-first-frame", text: framePayloads[0]! },
    { marker: "ocf2-frame-set", text: relayText },
    { marker: "ocm1-payload", text: canonicalMessagePayload },
    {
      marker: "ocm1-keyId",
      text: V1_KEY_ID,
      bytes: new TextEncoder().encode(V1_KEY_ID),
    },
    {
      marker: "ocm1-createdAt",
      text: String(V1_CREATED_AT),
      bytes: createdAtBytes,
    },
    {
      marker: "ocm1-iv",
      text: bytesToHex(MESSAGE_IV_BYTES),
      bytes: MESSAGE_IV_BYTES,
    },
    {
      marker: "ocm1-ciphertext-prefix",
      text: decodedMessageMarkers[1]!,
    },
    {
      marker: "ocm1-ciphertext",
      text: bytesToHex(MESSAGE_CIPHERTEXT_BYTES),
      bytes: MESSAGE_CIPHERTEXT_BYTES,
    },
    {
      marker: "ocm1-aad",
      text: bytesToHex(MESSAGE_AAD_BYTES),
      bytes: MESSAGE_AAD_BYTES,
    },
    { marker: "ock1-payload", text: canonicalSymmetricKeyPayload },
    { marker: "ock1-key-text", text: rawKeyMarkers[0]! },
    { marker: "ock1-key-prefix-hex", text: rawKeyMarkers[1]! },
    { marker: "ock1-key-prefix-decimal", text: rawKeyMarkers[2]! },
    {
      marker: "ock1-key",
      text: bytesToHex(SYMMETRIC_KEY_BYTES),
      bytes: SYMMETRIC_KEY_BYTES,
    },
  ]
  for (const value of consoleValues) {
    expectNoRelayPayloadText([value], relayPayloadMarkers)
  }
  await assertNoRelayPayloadPersistence(page, relayPayloadMarkers)
  const requests = await awaitRequestObservations(pendingRequestObservations)
  expect(requests.some(({ fromServiceWorker }) => fromServiceWorker)).toBe(true)
  for (const request of requests) {
    expectAllowedRelayRequest(request)
    expectNoRelayPayloadText(
      [
        request.url,
        ...[...new URL(request.url).searchParams.entries()].flat(),
        request.body ?? "",
      ],
      relayPayloadMarkers,
    )
    expectNoRelayPayloadHeaders(request.headers, relayPayloadMarkers)
  }
})
