import { resolve } from "node:path"
import { createServer } from "vite"
import { toBase64Url } from "../../src/lib/base64url"
import { FRAME_BYTES_MAX } from "../../src/lib/frame-bytes"
import type { QrFrameV2 } from "../../src/schemas/domain"

export interface RelayMessages {
  sym: string[]
  pq: string[]
  nonMessage: string
}

export async function loadRelayMessages(): Promise<RelayMessages> {
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
    return {
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
  } finally {
    await fixtureServer.close()
  }
}
