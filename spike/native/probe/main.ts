import "./style.css"
import { readBarcodes } from "zxing-wasm/reader"
import {
  encodeMlKemEnvelopeV2,
  encodeSymMessageEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { copyTextToClipboard, copyImageToClipboard } from "@/lib/clipboard"
import { prepareQrReaderModule, zxingReaderOptions } from "@/qr/camera/reader-module"
import { startQrScan, type QrScanHandle } from "@/qr/camera-scan"
import { renderQrDataUrl } from "@/qr/encode"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/wire-codec"
import {
  acceptRelayCapture,
  EMPTY_RELAY_CAPTURE,
  missingRelayIndexes,
  parseRelayText,
  type RelayCapture,
} from "@/qr/relay-frames"
import { env } from "@/schemas/env-schema"

type Check = { name: string; ok: boolean; detail: unknown; ms: number }
const checks: Check[] = []
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = element("status")
const gestureButton = element<HTMLButtonElement>("gesture")
const tauri = "__TAURI_INTERNALS__" in window
const errorText = (error: unknown) =>
  error instanceof Error ? error.name + ": " + error.message : String(error)
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const require = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}

function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out after " + ms + " ms")), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

async function check(
  name: string,
  action: () => unknown | Promise<unknown>,
  timeout = 10000,
) {
  const start = performance.now()
  let result: Check
  try {
    result = {
      name,
      ok: true,
      detail: await bounded(Promise.resolve().then(action), timeout),
      ms: 0,
    }
  } catch (error) {
    result = { name, ok: false, detail: errorText(error), ms: 0 }
  }
  result.ms = Math.round(performance.now() - start)
  checks.push(result)
  element("checks").textContent = JSON.stringify(checks, null, 2)
}

function signal(name: string) {
  console.warn("G0R_SIGNAL " + name)
  if (tauri) location.href = "https://g0r-report.invalid/" + name
}

let symPayloads: string[] = []
let pqPayloads: string[] = []
let symImages: string[] = []
let pqImages: string[] = []
let autoDone = false
let finished = false
let gestureMethod = "not delivered"
let gestureTimer: ReturnType<typeof setTimeout>

function report() {
  const result = {
    origin: location.origin,
    href: location.href,
    userAgent: navigator.userAgent,
    isSecureContext,
    gestureMethod,
    checks,
  }
  element("report").textContent = JSON.stringify(result, null, 2)
  status.textContent =
    "DONE — " +
    checks.filter((item) => item.ok).length +
    "/" +
    checks.length +
    " checks OK. See details below. Camera is manual."
  Object.assign(window, { __g0rResult: result })
  const encoded = encodeURIComponent(JSON.stringify(result))
  const chunks = encoded.match(/.{1,1800}/g) ?? []
  chunks.forEach((chunk, index) =>
    console.warn("G0R_RESULT " + (index + 1) + "/" + chunks.length + " " + chunk),
  )
  if (tauri) location.href = "https://g0r-report.invalid/result#" + encoded
}

// Observe the very same native call made by the app wrapper, without retrying it.
function clipboardWrite(kind: "text" | "image") {
  const start = performance.now()
  const activation = {
    isActive: navigator.userActivation?.isActive ?? null,
    hasBeenActive: navigator.userActivation?.hasBeenActive ?? null,
  }
  let raw: string | null = null
  let restore = () => {}
  try {
    const clipboard = navigator.clipboard
    const method = kind === "text" ? "writeText" : "write"
    const original = clipboard[method]
    require(typeof original === "function", method + " is unavailable")
    const bound = original.bind(clipboard) as (...args: unknown[]) => Promise<void>
    Object.defineProperty(clipboard, method, {
      configurable: true,
      value: (...args: unknown[]) => {
        try {
          return bound(...args).catch((error: unknown) => {
            raw = errorText(error)
            throw error
          })
        } catch (error) {
          raw = errorText(error)
          throw error
        }
      },
    })
    restore = () => {
      delete (clipboard as unknown as Record<string, unknown>)[method]
    }
  } catch (error) {
    raw = errorText(error)
  }
  let pending: Promise<void>
  try {
    pending =
      kind === "text"
        ? copyTextToClipboard(pqPayloads.join("\n"))
        : copyImageToClipboard(symImages[0] ?? "")
  } finally {
    restore()
  }
  return bounded(pending, 8000).then(
    () => ({
      name: "",
      ok: true,
      detail: { wrapper: "resolved", raw, activation },
      ms: Math.round(performance.now() - start),
    }),
    (error: unknown) => ({
      name: "",
      ok: false,
      detail: {
        wrapper: errorText(error),
        raw:
          raw ??
          (typeof ClipboardItem === "undefined" && kind === "image"
            ? "ClipboardItem is undefined; native write was not reached"
            : null),
        activation,
      },
      ms: Math.round(performance.now() - start),
    }),
  )
}

function clipboardPair(prefix: string) {
  // Both wrappers reach the browser synchronously in this turn; image is last.
  const text = clipboardWrite("text")
  const image = clipboardWrite("image")
  return Promise.all([text, image]).then((results) => {
    results.forEach((result, index) =>
      checks.push({ ...result, name: prefix + (index === 0 ? ".text" : ".image") }),
    )
    element("checks").textContent = JSON.stringify(checks, null, 2)
  })
}

function gesture(method = "eval") {
  if (!autoDone || finished) return
  finished = true
  gestureMethod = method
  clearTimeout(gestureTimer)
  gestureButton.hidden = true
  // No await or promise continuation before starting these writes.
  void clipboardPair("clipboard.gesture").then(report)
}
Object.assign(window, { g0rGesture: gesture })
gestureButton.addEventListener("click", (event) =>
  gesture(event.isTrusted ? "trusted-click" : "synthetic-click"),
)

async function render(payloads: string[]) {
  return Promise.all(
    payloads.map((payload) =>
      renderQrDataUrl(payload, { ecLevel: "Q", size: env.qrRenderSize }),
    ),
  )
}

async function roundtrip(payloads: string[], images: string[], expectedCount: number) {
  require(payloads.length === expectedCount, "Expected " +
    expectedCount +
    " frames, got " +
    payloads.length)
  require(images.length === expectedCount, "Rendered frames unavailable")
  let capture: RelayCapture = EMPTY_RELAY_CAPTURE
  const details = []
  for (let index = 0; index < images.length; index++) {
    const image = new Image()
    image.src = images[index]
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext("2d", { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    const decoded = await readBarcodes(
      context.getImageData(0, 0, canvas.width, canvas.height),
      zxingReaderOptions,
    )
    require(decoded.length === 1, "Expected one QR at frame " +
      index +
      ", got " +
      decoded.length)
    require(decoded[0].text === payloads[index], "Decoded payload differs at frame " +
      index)
    const accepted = acceptRelayCapture(decoded[0].text, capture)
    if (!accepted.ok) throw new Error("acceptRelayCapture: " + accepted.code)
    capture = accepted.capture
    details.push({
      index,
      width: canvas.width,
      height: canvas.height,
      chars: decoded[0].text.length,
    })
  }
  require(capture.kind === "frames" &&
    capture.set.entries.size === expectedCount &&
    missingRelayIndexes(capture.set).length === 0, "Relay capture incomplete")
  return { complete: true, validatedByRelay: true, frames: details }
}

async function main() {
  await check("secureContext", () => {
    require(isSecureContext, "isSecureContext=false")
    return isSecureContext
  })
  await check("webLocks", async () => {
    require(navigator.locks?.request, "navigator.locks.request unavailable")
    return navigator.locks.request("g0r-spike", (lock) => {
      if (!lock) throw new Error("No lock granted")
      return lock.name
    })
  })
  await check(
    "zxing.prepare",
    async () => {
      await prepareQrReaderModule()
      return "App-origin WASM prepared and probe decoded"
    },
    35000,
  )
  await check("fixtures", async () => {
    const keyId = "AAECAwQFBgcICQoLDA0ODw"
    const sym = encodeSymMessageEnvelopeV2({
      version: 2,
      type: "sym-message",
      suite: "HKDF-SHA256+A256GCM",
      keyId,
      createdAt: 1700000000000,
      iv: new Uint8Array(12).fill(0x42),
      ciphertext: new Uint8Array(16).fill(0x43),
    })
    const pq = encodeMlKemEnvelopeV2({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: keyId,
      kemCiphertext: new Uint8Array(1568).fill(0x31),
      iv: new Uint8Array(12).fill(0x33),
      ciphertext: new Uint8Array(16).fill(0x34),
    })
    symPayloads = (
      await splitIntoFrames({
        artifactType: "sym-message",
        artifactBytes: sym,
        frameBytes: env.qrFrameBytes,
      })
    ).map(encodeFrameToPayload)
    pqPayloads = (
      await splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes: pq,
        frameBytes: env.qrFrameBytes,
      })
    ).map(encodeFrameToPayload)
    require(symPayloads.length === 1 &&
      pqPayloads.length === 2, "Fixture frame counts differ from 1/2")
    return {
      symBytes: sym.length,
      pqBytes: pq.length,
      frameBytes: env.qrFrameBytes,
      renderSize: env.qrRenderSize,
    }
  })
  await check("relay.render.sym", async () => {
    symImages = await render(symPayloads)
    require(symImages.length === 1, "Sym fixture unavailable")
    element<HTMLImageElement>("sym").src = symImages[0]
    return "EC-Q PNG at production render size"
  })
  await check("relay.render.pq", async () => {
    pqImages = await render(pqPayloads)
    require(pqImages.length === 2, "PQ fixture unavailable")
    return "Two EC-Q PNGs at production render size"
  })
  await check("roundtrip.sym", () => roundtrip(symPayloads, symImages, 1), 35000)
  await check("roundtrip.pq", () => roundtrip(pqPayloads, pqImages, 2), 35000)
  await check("relay.playback.parse", () => {
    const parsed = parseRelayText(pqPayloads.join("\n"))
    if (!parsed.ok) throw new Error("parseRelayText: " + parsed.code)
    require(parsed.originals.length === 2 &&
      parsed.originals.every(
        (value, index) => value === pqPayloads[index],
      ), "Playback frames differ")
    return { frameCount: parsed.frames.length, missing: missingRelayIndexes(parsed.set) }
  })
  await check("relay.playback.animate", async () => {
    require(pqImages.length === 2, "PQ images unavailable")
    const image = element<HTMLImageElement>("pq")
    for (let index = 0; index < 2; index++) {
      image.src = pqImages[index]
      await image.decode()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      require(image.naturalWidth ===
        env.qrRenderSize, "Playback image has incorrect width")
      await delay(env.qrFrameIntervalMs)
    }
    let index = 0
    setInterval(() => {
      image.src = pqImages[index]
      element("playback").textContent = "PQ playback: frame " + (index + 1) + "/2"
      index = (index + 1) % 2
    }, env.qrFrameIntervalMs)
    return { framesDisplayed: 2, intervalMs: env.qrFrameIntervalMs }
  })
  await check("camera.api", async () => {
    require(navigator.mediaDevices?.getUserMedia, "getUserMedia unavailable")
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      getUserMedia: true,
      videoInputs: devices.filter((device) => device.kind === "videoinput").length,
      cameraStarted: false,
    }
  })
  await check("clipboard.api", () => {
    const detail = {
      writeText: typeof navigator.clipboard?.writeText === "function",
      write: typeof navigator.clipboard?.write === "function",
      ClipboardItem: typeof ClipboardItem !== "undefined",
    }
    require(Object.values(detail).every(Boolean), JSON.stringify(detail))
    return detail
  })
  await clipboardPair("clipboard.auto")
  autoDone = true
  Object.assign(window, { __g0rAutoDone: true })
  gestureButton.hidden = false
  status.textContent =
    "Automatic checks finished. Tap the full-window button within 25 seconds."
  gestureTimer = setTimeout(() => {
    if (finished) return
    finished = true
    gestureButton.hidden = true
    for (const kind of ["text", "image"])
      checks.push({
        name: "clipboard.gesture." + kind,
        ok: false,
        detail: "User gesture not delivered within 25 s; write not attempted",
        ms: 25000,
      })
    report()
  }, 25000)
  signal("auto-done")
}

let scan: QrScanHandle | undefined
let cameraCapture: RelayCapture = EMPTY_RELAY_CAPTURE
const cameraStatus = element("camera-status")
element<HTMLButtonElement>("start-camera").addEventListener("click", async () => {
  try {
    scan?.stop()
    cameraStatus.textContent = "Preparing reader and starting camera…"
    await prepareQrReaderModule()
    scan = await startQrScan(
      element<HTMLVideoElement>("video"),
      (text) => {
        const accepted = acceptRelayCapture(text, cameraCapture)
        if (!accepted.ok) {
          cameraStatus.textContent = "Rejected: " + accepted.code
          return
        }
        cameraCapture = accepted.capture
        const set = accepted.capture.set
        const missing = missingRelayIndexes(set)
        cameraStatus.textContent =
          missing.length === 0
            ? "COMPLETE — relay validated " + set.entries.size + " frame(s)"
            : "Captured " +
              set.entries.size +
              "/" +
              set.metadata?.frameCount +
              "; missing: " +
              missing.map((index) => index + 1).join(", ")
      },
      (error, state) => {
        cameraStatus.textContent = errorText(error) + " " + JSON.stringify(state)
      },
      { once: false },
    )
    element<HTMLButtonElement>("stop-camera").disabled = false
  } catch (error) {
    cameraStatus.textContent = errorText(error)
  }
})
element("stop-camera").addEventListener("click", () => {
  scan?.stop()
  cameraStatus.textContent = "Camera stopped"
  element<HTMLButtonElement>("stop-camera").disabled = true
})
element("reset-camera").addEventListener("click", () => {
  cameraCapture = EMPTY_RELAY_CAPTURE
  cameraStatus.textContent = "Capture reset; scan a fresh set"
})
void main().catch((error) => {
  checks.push({ name: "harness", ok: false, detail: errorText(error), ms: 0 })
  report()
})
