import { readFile, readdir } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { expect, test as base } from "@playwright/test"
import { createServer } from "vite"
import { metaCspFromHeaders } from "../../scripts/csp-from-headers.mjs"
import { toBase64Url } from "../../src/lib/base64url"
import { FRAME_BYTES_MAX } from "../../src/lib/frame-bytes"
import type { QrFrameV2 } from "../../src/schemas/domain"
import {
  collectAnimatedFramePayloads,
  decodePng,
  emitInjectedQr,
  injectedScanSnapshot,
  installInjectedDecoderStream,
} from "../e2e/helpers"

interface ObservedRequest {
  body: string | null
  method: string
  url: string
}

type RelayWindow = Window &
  typeof globalThis & {
    __relayBundleRegistrations: string[]
    __relayBundleCamera: { calls: number; streams: MediaStream[] }
  }

const test = base.extend<{ bundleRequests: ObservedRequest[] }>({
  bundleRequests: [
    async ({ baseURL, context, page }, use, testInfo) => {
      if (baseURL === undefined) throw new Error("E2E_BASE_URL_MISSING")
      const root = resolve("dist-relay")
      const files = new Set(
        (await readdir(root, { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map(
            (entry) =>
              `/${relative(root, join(entry.parentPath, entry.name)).split(sep).join("/")}`,
          ),
      )
      expect(files.has("/index.html")).toBe(true)
      const requests: ObservedRequest[] = []
      context.on("request", (request) => {
        requests.push({
          body: request.postData(),
          method: request.method(),
          url: request.url(),
        })
      })
      await context.addInitScript(() => {
        const target = window as RelayWindow
        target.__relayBundleRegistrations = []
        const register = navigator.serviceWorker.register.bind(navigator.serviceWorker)
        navigator.serviceWorker.register = (...args) => {
          target.__relayBundleRegistrations.push(String(args[0]))
          return register(...args)
        }
      })

      await use(requests)

      if (testInfo.status === "skipped") return
      expect(requests.length).toBeGreaterThan(0)
      for (const request of requests) {
        const url = new URL(request.url)
        expect(url.origin, request.url).toBe(new URL(baseURL).origin)
        expect(request.method, request.url).toBe("GET")
        expect(request.body, request.url).toBeNull()
        expect(url.search, request.url).toBe("")
        expect([
          "/manifest.webmanifest",
          "/reachability-sentinel.txt",
          "/sw.js",
        ]).not.toContain(url.pathname)
        expect(url.pathname === "/" || files.has(url.pathname), request.url).toBe(true)
      }
      expect(
        await page.evaluate(() => (window as RelayWindow).__relayBundleRegistrations),
      ).toEqual([])
      expect(
        await page.evaluate(() => navigator.serviceWorker.getRegistrations()),
      ).toEqual([])
    },
    { auto: true },
  ],
})

let messages: { sym: string[]; pq: string[]; nonMessage: string }

test.beforeAll(async () => {
  // The protocol encoders read import.meta.env, so load these fixtures with Vite.
  const fixtureServer = await createServer({
    configFile: false,
    envDir: false,
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null },
  })
  try {
    const { encodeCanonicalCbor, encodeMlKemEnvelopeV2, encodeSymMessageEnvelopeV2 } =
      (await fixtureServer.ssrLoadModule(
        "/src/crypto/pq/canonical-cbor.ts",
      )) as typeof import("../../src/crypto/pq/canonical-cbor")
    const { encodeFrameToPayload, QR_PREFIX_V2 } = (await fixtureServer.ssrLoadModule(
      "/src/qr/wire-codec.ts",
    )) as typeof import("../../src/qr/wire-codec")
    const keyId = "AAECAwQFBgcICQoLDA0ODw"
    const symBytes = encodeSymMessageEnvelopeV2({
      version: 2,
      type: "sym-message",
      suite: "HKDF-SHA256+A256GCM",
      keyId,
      createdAt: 1_700_000_000_000,
      iv: new Uint8Array(12).fill(0x42),
      ciphertext: new Uint8Array(16).fill(0x43),
    })
    const pqBytes = encodeMlKemEnvelopeV2({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: keyId,
      kemCiphertext: new Uint8Array(1_568).fill(0x31),
      iv: new Uint8Array(12).fill(0x33),
      ciphertext: new Uint8Array(16).fill(0x34),
    })
    const payloads = (artifactType: "sym-message" | "pq-message", bytes: Uint8Array) => {
      const frameCount = Math.ceil(bytes.byteLength / FRAME_BYTES_MAX)
      return Array.from({ length: frameCount }, (_, frameIndex) =>
        encodeFrameToPayload({
          version: 2,
          type: "qr-frame",
          transferId: new Uint8Array(16).fill(0x11),
          artifactType,
          frameIndex,
          frameCount,
          totalByteLength: bytes.byteLength,
          chunk: bytes.slice(
            frameIndex * FRAME_BYTES_MAX,
            (frameIndex + 1) * FRAME_BYTES_MAX,
          ),
        } satisfies QrFrameV2),
      )
    }
    messages = {
      sym: payloads("sym-message", symBytes),
      pq: payloads("pq-message", pqBytes),
      nonMessage: `${QR_PREFIX_V2.frame}${toBase64Url(
        encodeCanonicalCbor({
          version: 2,
          type: "qr-frame",
          transferId: new Uint8Array(16).fill(0x61),
          artifactType: "symmetric-key",
          frameIndex: 0,
          frameCount: 1,
          totalByteLength: 1,
          chunk: Uint8Array.of(1),
        }),
      )}`,
    }
    expect(messages.sym).toHaveLength(1)
    expect(messages.pq).toHaveLength(2)
  } finally {
    await fixtureServer.close()
  }
})

test("serves the production CSP exactly and never registers a service worker", async ({
  page,
}) => {
  const expectedCsp = metaCspFromHeaders(await readFile("public/_headers", "utf8"))
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Text → QR", exact: true })).toBeVisible()
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute("content", expectedCsp)
})

test("makes no request outside the bundle's own files", async ({
  bundleRequests,
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "QR → Text", exact: true })).toBeVisible()
  expect(bundleRequests.some(({ url }) => new URL(url).pathname === "/")).toBe(true)
  expect(bundleRequests.some(({ url }) => new URL(url).pathname.endsWith(".js"))).toBe(
    true,
  )
})

test("plays back sym and pq frames and reopens with an empty session", async ({ page }) => {
  await page.goto("/")
  for (const payloads of [messages.sym, messages.pq]) {
    await page.getByRole("button", { name: "Text → QR", exact: true }).click()
    const playback = page.getByRole("dialog", {
      name: "Turn relay text into QR",
      exact: true,
    })
    await playback.getByLabel("Relay text", { exact: true }).fill(payloads.join("\n"))
    await playback.getByRole("button", { name: "Show QR", exact: true }).click()
    if (payloads.length === 1) {
      const image = playback.getByRole("img")
      await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/)
      const source = await image.getAttribute("src")
      expect(decodePng(Buffer.from(source!.split(",", 2)[1]!, "base64"))).toBe(
        payloads[0],
      )
    } else {
      expect(await collectAnimatedFramePayloads(playback)).toEqual(payloads)
    }
    await playback.getByRole("button", { name: "Close", exact: true }).click()
    await expect(playback).toBeHidden()
    await page.getByRole("button", { name: "Text → QR", exact: true }).click()
    await expect(playback.getByLabel("Relay text", { exact: true })).toHaveValue("")
    await expect(playback.getByRole("img")).toHaveCount(0)
    await playback.getByRole("button", { name: "Close", exact: true }).click()
  }
})

test("rejects a non-message outer type in playback", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Text → QR", exact: true }).click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR",
    exact: true,
  })
  await playback.getByLabel("Relay text", { exact: true }).fill(messages.nonMessage)
  await playback.getByRole("button", { name: "Show QR", exact: true }).click()
  await expect(
    playback.getByText(
      "The frame's outer header does not declare pq-message or sym-message.",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(playback.getByRole("img")).toHaveCount(0)
})

test("captures a pq set from the injected decoder and copies the text", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(
    browserName !== "chromium",
    "This native clipboard readback uses clipboard-write permission, unsupported by Playwright WebKit.",
  )
  await installInjectedDecoderStream(page)
  await context.grantPermissions(["camera", "clipboard-read", "clipboard-write"])
  await page.goto("/")
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to text", exact: true })
  expect(await injectedScanSnapshot(page)).toEqual([])
  await capture.getByRole("button", { name: "Start camera", exact: true }).click()
  await expect.poll(async () => (await injectedScanSnapshot(page)).length).toBe(1)
  await emitInjectedQr(page, messages.pq[1]!)
  await expect(capture.getByText("1 / 2 frames collected", { exact: true })).toBeVisible()
  await expect(capture.getByLabel("Relay text", { exact: true })).toHaveCount(0)
  await emitInjectedQr(page, messages.pq[0]!)
  const text = messages.pq.join("\n")
  await expect(capture.getByLabel("Relay text", { exact: true })).toHaveValue(text)
  await expect
    .poll(() => injectedScanSnapshot(page))
    .toEqual([{ active: false, once: false, emissions: 2 }])
  await page.evaluate(() => navigator.clipboard.writeText("relay-bundle-before-copy"))
  await capture.getByRole("button", { name: "Copy relay text", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text)
})

test("captures a sym frame with the injected decoder in image mode and copies the image", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(
    browserName !== "chromium",
    "This native PNG clipboard readback uses clipboard-write permission, unsupported by Playwright WebKit.",
  )
  await installInjectedDecoderStream(page)
  await context.grantPermissions(["camera", "clipboard-read", "clipboard-write"])
  await page.goto("/")
  await page.getByRole("button", { name: "QR → QR", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to QR", exact: true })
  expect(await injectedScanSnapshot(page)).toEqual([])
  await capture.getByRole("button", { name: "Start camera", exact: true }).click()
  await expect.poll(async () => (await injectedScanSnapshot(page)).length).toBe(1)
  await emitInjectedQr(page, messages.sym[0]!)
  const image = capture.getByRole("img", { name: "Relayed message QR code", exact: true })
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/)
  const source = await image.getAttribute("src")
  expect(decodePng(Buffer.from(source!.split(",", 2)[1]!, "base64"))).toBe(
    messages.sym[0],
  )
  await expect
    .poll(async () => (await injectedScanSnapshot(page)).every(({ active }) => !active))
    .toBe(true)
  await page.evaluate(() =>
    navigator.clipboard.writeText("relay-bundle-before-image-copy"),
  )
  await capture.getByRole("button", { name: "Copy QR image", exact: true }).click()
  await expect
    .poll(async () => {
      const copiedPng = await page.evaluate(async () => {
        const items = await navigator.clipboard.read()
        const image = items.find((item) => item.types.includes("image/png"))
        if (image === undefined) return null
        return Array.from(
          new Uint8Array(await (await image.getType("image/png")).arrayBuffer()),
        )
      })
      return copiedPng === null ? null : decodePng(Buffer.from(copiedPng))
    })
    .toBe(messages.sym[0])
})

test("starts the fake camera only on Start and stops it after an injected hidden-page event", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName !== "chromium",
    "Fake camera capture uses Chromium-only media launch flags.",
  )
  await page.addInitScript(() => {
    const probe = { calls: 0, streams: [] as MediaStream[] }
    ;(window as RelayWindow).__relayBundleCamera = probe
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (...args) => {
      probe.calls += 1
      const stream = await getUserMedia(...args)
      probe.streams.push(stream)
      return stream
    }
  })
  const cameraSnapshot = () =>
    page.evaluate(() => {
      const { calls, streams } = (window as RelayWindow).__relayBundleCamera
      return {
        calls,
        tracks: streams.flatMap((stream) =>
          stream.getTracks().map((track) => track.readyState),
        ),
      }
    })
  await page.goto("/")
  await expect(page.getByRole("button", { name: "QR → Text", exact: true })).toBeVisible()
  expect(await cameraSnapshot()).toEqual({ calls: 0, tracks: [] })
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to text", exact: true })
  const start = capture.getByRole("button", { name: "Start camera", exact: true })
  await expect(start).toBeEnabled()
  expect(await cameraSnapshot()).toEqual({ calls: 0, tracks: [] })
  await start.click()
  await expect.poll(cameraSnapshot).toEqual({ calls: 1, tracks: ["live"] })

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(capture).toBeHidden()
  await expect.poll(cameraSnapshot).toEqual({ calls: 1, tracks: ["ended"] })

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
    document.dispatchEvent(new Event("visibilitychange"))
    return new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    )
  })
  await expect(capture).toBeHidden()
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  await expect(start).toBeEnabled()
  expect(await cameraSnapshot()).toEqual({ calls: 1, tracks: ["ended"] })
})
