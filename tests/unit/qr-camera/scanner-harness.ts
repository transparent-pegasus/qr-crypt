import { afterEach, beforeEach, vi } from "vitest"
export { deferred } from "../../helpers/deferred"

const nativeWebAssembly = WebAssembly

const zxing = vi.hoisted(() => ({
  prepareZXingModule: vi.fn(),
  purgeZXingModule: vi.fn(),
  readBarcodes: vi.fn(),
}))

export function zxingFakes(): typeof zxing {
  return zxing
}

vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: zxing.prepareZXingModule,
  purgeZXingModule: zxing.purgeZXingModule,
  readBarcodes: zxing.readBarcodes,
}))

vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({
  default: "/assets/zxing_reader-test-hash.wasm",
}))

export class FakeTrack extends EventTarget {
  readonly kind = "video"
  readyState: MediaStreamTrackState = "live"
  muted: boolean

  constructor(options?: { muted?: boolean }) {
    super()
    this.muted = options?.muted ?? false
  }

  readonly stop = vi.fn(() => {
    this.readyState = "ended"
  })

  end(): void {
    this.readyState = "ended"
    this.dispatchEvent(new Event("ended"))
  }

  unmute(): void {
    this.muted = false
    this.dispatchEvent(new Event("unmute"))
  }
}

class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[]) {}

  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

export const getUserMedia =
  vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()

export function mediaStream(...tracks: FakeTrack[]): MediaStream {
  return new FakeMediaStream(tracks) as unknown as MediaStream
}

type FakeVideoFrameCallback = (now: number, metadata: object) => void

export class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null
  videoWidth: number
  videoHeight: number
  readyState: number
  readonly play: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly requestVideoFrameCallback:
    | ReturnType<typeof vi.fn<(callback: FakeVideoFrameCallback) => number>>
    | undefined
  readonly cancelVideoFrameCallback:
    | ReturnType<typeof vi.fn<(handle: number) => void>>
    | undefined

  private nextFrameHandle = 1
  private readonly frameCallbacks = new Map<number, FakeVideoFrameCallback>()

  constructor(
    width = 640,
    height = 480,
    options?: {
      readyState?: number
      play?: () => Promise<void>
      videoFrameCallbacks?: boolean
    },
  ) {
    super()
    this.videoWidth = width
    this.videoHeight = height
    this.readyState = options?.readyState ?? 2
    this.play = vi.fn(options?.play ?? (async () => undefined))

    if (options?.videoFrameCallbacks === true) {
      this.requestVideoFrameCallback = vi.fn((callback: FakeVideoFrameCallback) => {
        const handle = this.nextFrameHandle
        this.nextFrameHandle += 1
        this.frameCallbacks.set(handle, callback)
        return handle
      })
      this.cancelVideoFrameCallback = vi.fn((handle: number) => {
        this.frameCallbacks.delete(handle)
      })
    } else {
      this.requestVideoFrameCallback = undefined
      this.cancelVideoFrameCallback = undefined
    }
  }

  setDimensions(width: number, height: number): void {
    this.videoWidth = width
    this.videoHeight = height
  }

  fireNextVideoFrame(): void {
    const next = this.frameCallbacks.entries().next()
    if (next.done) throw new Error("No video frame callback is scheduled")
    const [handle, callback] = next.value
    this.frameCallbacks.delete(handle)
    callback(0, {})
  }

  pendingVideoFrameCallbacks(): number {
    return this.frameCallbacks.size
  }
}

export function asVideoElement(video: FakeVideo): HTMLVideoElement {
  return video as unknown as HTMLVideoElement
}

export function videoElement(width = 640, height = 480): HTMLVideoElement {
  return asVideoElement(new FakeVideo(width, height))
}

function makeCanvasRecord() {
  const drawImage = vi.fn()
  const getImageData = vi.fn(
    (_x: number, _y: number, width: number, height: number) =>
      ({
        data: new Uint8ClampedArray(),
        width,
        height,
        colorSpace: "srgb",
      }) as ImageData,
  )
  const context = { drawImage, getImageData }
  const getContext = vi.fn(
    () => context as unknown as CanvasRenderingContext2D,
  )
  const element = {
    width: 300,
    height: 150,
    getContext,
  } as unknown as HTMLCanvasElement
  return { element, drawImage, getImageData, getContext }
}

type CanvasRecord = ReturnType<typeof makeCanvasRecord>
export const canvases: CanvasRecord[] = []
export const createElement = vi.fn((tagName: string) => {
  if (tagName !== "canvas") throw new Error(`Unexpected element: ${tagName}`)
  const record = makeCanvasRecord()
  canvases.push(record)
  return record.element
})

export function barcode(text: string): Array<{ text: string }> {
  return [{ text }]
}

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await flushMicrotasks()
}

export async function loadColdDecoder(): Promise<typeof import("@/qr/decode")> {
  return import("@/qr/decode")
}

export async function loadDecoder(): Promise<typeof import("@/qr/decode")> {
  const decoder = await loadColdDecoder()
  await decoder.warmQrReader()
  // The synthetic warm-up probe is not part of the frame pump's decode cadence.
  zxing.readBarcodes.mockClear()
  return decoder
}

beforeEach(() => {
  vi.resetModules()
  zxing.prepareZXingModule.mockReset()
  zxing.prepareZXingModule.mockResolvedValue({})
  zxing.purgeZXingModule.mockReset()
  zxing.readBarcodes.mockReset()
  zxing.readBarcodes.mockResolvedValue([])
  getUserMedia.mockReset()
  canvases.splice(0)
  createElement.mockClear()
  const supportedWebAssembly = Object.create(
    nativeWebAssembly,
  ) as typeof WebAssembly
  Object.defineProperty(supportedWebAssembly, "instantiate", {
    configurable: true,
    value: vi.fn(async () => ({})),
  })
  vi.stubGlobal("WebAssembly", supportedWebAssembly)
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia },
  })
  vi.stubGlobal("document", { createElement })
})

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
