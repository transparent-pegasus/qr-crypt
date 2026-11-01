import { Buffer } from "node:buffer"
import type { QrFrameV2 } from "../../src/schemas/domain"

type FixtureValue = string | number | Uint8Array | { [key: string]: FixtureValue }

// Independent fixture encoding: no application imports execute in Playwright's
// Node process, where Vite's import.meta.env is unavailable. All bytes are public
// synthetic ciphertext, not keys or a cryptographic known-answer vector.
function header(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value])
  if (value < 256) return Buffer.from([(major << 5) | 24, value])
  return Buffer.from([(major << 5) | 25, value >> 8, value & 255])
}

function cbor(value: FixtureValue): Buffer {
  if (typeof value === "number") return header(0, value)
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8")
    return Buffer.concat([header(3, bytes.length), bytes])
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([header(2, value.length), value])
  }
  const entries = Object.entries(value)
    .map(([key, item]) => [cbor(key), cbor(item)] as const)
    .sort(([left], [right]) => Buffer.compare(left, right))
  return Buffer.concat([header(5, entries.length), ...entries.flat()])
}

export function syntheticRelayPlayback(frameCount = 3): {
  frames: QrFrameV2[]
  payloads: string[]
  text: string
} {
  const artifact = cbor({
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: "AAECAwQFBgcICQoLDA0ODw",
    kemCiphertext: new Uint8Array(1_568).fill(0x31),
    iv: new Uint8Array(12).fill(0x33),
    ciphertext: new Uint8Array(16).fill(0x34),
  })
  const frames: QrFrameV2[] = Array.from({ length: frameCount }, (_, frameIndex) => ({
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16).fill(0x71),
    artifactType: "pq-message",
    frameIndex,
    frameCount,
    totalByteLength: artifact.length,
    chunk: Uint8Array.from(
      artifact.subarray(
        Math.floor((frameIndex * artifact.length) / frameCount),
        Math.floor(((frameIndex + 1) * artifact.length) / frameCount),
      ),
    ),
  }))
  const payloads = frames.map(
    (frame) => `OCF2:${cbor({ ...frame }).toString("base64url")}`,
  )
  return { frames, payloads, text: payloads.join("\n") }
}
