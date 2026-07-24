import { describe, expect, it } from "vitest"
import {
  encodeCanonicalCbor,
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodeMlKemEnvelopeV2,
  encodePublicIdentityBundleV2,
  encodeSignedMessageV2,
  encodeUnsignedMessageBodyV2,
} from "@/crypto/pq/canonical-cbor"
import { DSA_SIZES } from "@/crypto/pq/profiles"
import { sha256 } from "@/lib/bytes"
import { MAX_PLAINTEXT_BYTES, PQ_KEY_QR_FRAME_BYTES } from "@/lib/limits"
import { payloadFits, renderQrSvgString } from "@/qr/encode"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { parseAppEnv } from "@/schemas/env-schema"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const CREATED_AT = 1_700_000_000_000
const FRAME_BYTES = [400, 600, 900] as const

interface ArtifactFixture {
  label: string
  artifactType: V2ArtifactType
  bytes: Uint8Array
  expectedBytes: number
  expectedFrames: Record<(typeof FRAME_BYTES)[number], number>
}

function messageArtifact(signed: boolean, plaintextBytes: number): Uint8Array {
  const commonBody = {
    version: 2 as const,
    messageId: new Uint8Array(16).fill(0x11),
    createdAt: CREATED_AT,
    recipientKemKeyId: KEY_ID,
    plaintext: new Uint8Array(plaintextBytes).fill(0x22),
  }
  const innerBytes = signed
    ? encodeSignedMessageV2({
        body: {
          ...commonBody,
          senderSigningKeyId: KEY_ID,
        },
        signature: {
          algorithm: "ML-DSA-87",
          value: new Uint8Array(DSA_SIZES["ML-DSA-87"].signatureBytes).fill(0x33),
        },
      })
    : encodeUnsignedMessageBodyV2(commonBody)
  return encodeMlKemEnvelopeV2({
    version: 2,
    type: "pq-message",
    suite: signed
      ? "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"
      : "ML-KEM-1024+HKDF-SHA256+A256GCM",
    recipientKemKeyId: KEY_ID,
    kemCiphertext: new Uint8Array(1568).fill(0x44),
    hkdfSalt: new Uint8Array(32).fill(0x55),
    iv: new Uint8Array(12).fill(0x66),
    // WebCrypto AES-GCM の出力長は、正準 inner CBOR + 128-bit tag。
    ciphertext: new Uint8Array(innerBytes.byteLength + 16).fill(0x77),
  })
}

function artifactFixtures(): ArtifactFixture[] {
  const bundle = {
    version: 2 as const,
    type: "pq-public-identity" as const,
    identityId: KEY_ID,
    name: "テスト",
    kem: {
      algorithm: "ML-KEM-1024" as const,
      keyId: KEY_ID,
      publicKey: new Uint8Array(1568).fill(0x88),
    },
    signing: {
      algorithm: "ML-DSA-87" as const,
      keyId: KEY_ID,
      publicKey: new Uint8Array(2592).fill(0x99),
    },
    createdAt: CREATED_AT,
  }
  const kemKey = {
    version: 2 as const,
    type: "pq-kem-public-key" as const,
    identityId: KEY_ID,
    name: "テスト",
    algorithm: "ML-KEM-1024" as const,
    keyId: KEY_ID,
    publicKey: new Uint8Array(1568).fill(0x88),
    createdAt: CREATED_AT,
  }
  const dsaKey = {
    version: 2 as const,
    type: "pq-dsa-public-key" as const,
    identityId: KEY_ID,
    name: "テスト",
    algorithm: "ML-DSA-87" as const,
    keyId: KEY_ID,
    publicKey: new Uint8Array(2592).fill(0x99),
    createdAt: CREATED_AT,
  }
  // OCB2 は予約中で wire schema をまだ持たない。将来の有効化契約ではなく、
  // 現在保存する maximum 公開鍵 + encrypted seed の容量 fixture として固定する。
  const encryptedSeedBackup = encodeCanonicalCbor({
    version: 2,
    type: "encrypted-seed-backup",
    identityId: KEY_ID,
    name: "テスト",
    profile: "maximum",
    kem: {
      algorithm: "ML-KEM-1024",
      keyId: KEY_ID,
      publicKey: new Uint8Array(1568).fill(0x88),
      encryptedSeed: {
        iv: new Uint8Array(12).fill(0xaa),
        ciphertext: new Uint8Array(80).fill(0xbb),
      },
    },
    signing: {
      algorithm: "ML-DSA-87",
      keyId: KEY_ID,
      publicKey: new Uint8Array(2592).fill(0x99),
      encryptedSeed: {
        iv: new Uint8Array(12).fill(0xcc),
        ciphertext: new Uint8Array(48).fill(0xdd),
      },
    },
    createdAt: CREATED_AT,
  })

  return [
    {
      label: "unsigned / empty plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(false, 0),
      expectedBytes: 1887,
      expectedFrames: { 400: 5, 600: 4, 900: 3 },
    },
    {
      label: "unsigned / maximum plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(false, MAX_PLAINTEXT_BYTES),
      expectedBytes: 5986,
      expectedFrames: { 400: 15, 600: 10, 900: 7 },
    },
    {
      label: "signed / empty plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(true, 0),
      expectedBytes: 6613,
      expectedFrames: { 400: 17, 600: 12, 900: 8 },
    },
    {
      label: "signed / maximum plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(true, MAX_PLAINTEXT_BYTES),
      expectedBytes: 10711,
      expectedFrames: { 400: 27, 600: 18, 900: 12 },
    },
    {
      label: "OCI2 public bundle",
      artifactType: "pq-public-identity",
      bytes: encodePublicIdentityBundleV2(bundle),
      expectedBytes: 4402,
      expectedFrames: { 400: 12, 600: 8, 900: 5 },
    },
    {
      label: "OCP2 ML-KEM public key",
      artifactType: "pq-kem-public-key",
      bytes: encodeKemPublicKeyEnvelopeV2(kemKey),
      expectedBytes: 1733,
      expectedFrames: { 400: 5, 600: 3, 900: 2 },
    },
    {
      label: "OCS2 ML-DSA public key",
      artifactType: "pq-dsa-public-key",
      bytes: encodeDsaPublicKeyEnvelopeV2(dsaKey),
      expectedBytes: 2755,
      expectedFrames: { 400: 7, 600: 5, 900: 4 },
    },
    {
      label: "OCB2 encrypted-seed-backup reserved fixture",
      artifactType: "encrypted-seed-backup",
      bytes: encryptedSeedBackup,
      expectedBytes: 4637,
      expectedFrames: { 400: 12, 600: 8, 900: 6 },
    },
  ]
}

async function reservedBackupFrames(
  artifactBytes: Uint8Array,
  frameBytes: number,
): Promise<QrFrameV2[]> {
  const frameCount = Math.ceil(artifactBytes.byteLength / frameBytes)
  const digest = await sha256(artifactBytes)
  return Array.from({ length: frameCount }, (_, frameIndex) => ({
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16).fill(0xee),
    artifactType: "encrypted-seed-backup",
    frameIndex,
    frameCount,
    totalByteLength: artifactBytes.byteLength,
    payloadSha256: Uint8Array.from(digest),
    chunk: artifactBytes.slice(frameIndex * frameBytes, (frameIndex + 1) * frameBytes),
  }))
}

describe("maximum canonical CBOR artifact sizing", () => {
  for (const fixture of artifactFixtures()) {
    it(`${fixture.label} freezes bytes, OCF2 counts, and real EC-Q generation`, async () => {
      expect(fixture.bytes.byteLength).toBe(fixture.expectedBytes)
      for (const frameBytes of FRAME_BYTES) {
        const frames =
          fixture.artifactType === "encrypted-seed-backup"
            ? await reservedBackupFrames(fixture.bytes, frameBytes)
            : await splitIntoFrames({
                artifactType: fixture.artifactType,
                artifactBytes: fixture.bytes,
                frameBytes,
              })
        expect(frames).toHaveLength(fixture.expectedFrames[frameBytes])
        for (const frame of frames) {
          const payload = encodeFrameToPayload(frame)
          expect(payloadFits(payload, "Q")).toBe(true)
          const svg = await renderQrSvgString(payload, { ecLevel: "Q" })
          expect(svg).toContain("<svg")
        }
      }
    }, 60_000)
  }

  it("signed sizing formula stays exact across canonical byte-string header boundaries", () => {
    for (const [plaintextBytes, expectedArtifactBytes] of [
      [1, 6614],
      [23, 6636],
      [24, 6638],
      [255, 6869],
      [256, 6871],
      [16_384, 22_999],
    ] as const) {
      expect(messageArtifact(true, plaintextBytes)).toHaveLength(expectedArtifactBytes)
    }
  })

  it("env capacity guard matches generated signed artifact boundaries", () => {
    for (const plaintextBytes of [MAX_PLAINTEXT_BYTES, 16_384]) {
      const signedArtifactBytes = messageArtifact(true, plaintextBytes).byteLength
      for (const frameBytes of FRAME_BYTES) {
        const requiredFrames = Math.ceil(signedArtifactBytes / frameBytes)
        expect(
          parseAppEnv({
            VITE_MAX_PLAINTEXT_BYTES: String(plaintextBytes),
            VITE_QR_FRAME_BYTES: String(frameBytes),
            VITE_QR_MAX_FRAMES: String(requiredFrames),
          }),
        ).toMatchObject({
          maxPlaintextBytes: plaintextBytes,
          qrFrameBytes: frameBytes,
          qrMaxFrames: requiredFrames,
        })
        expect(() =>
          parseAppEnv({
            VITE_MAX_PLAINTEXT_BYTES: String(plaintextBytes),
            VITE_QR_FRAME_BYTES: String(frameBytes),
            VITE_QR_MAX_FRAMES: String(requiredFrames - 1),
          }),
        ).toThrow(
          "VITE_MAX_PLAINTEXT_BYTES の maximum 署名付き正準 CBOR が VITE_QR_MAX_FRAMES × VITE_QR_FRAME_BYTES に収まりません",
        )
      }
    }
  })

  it("key artifacts split at PQ_KEY_QR_FRAME_BYTES with EC-Q-fit frames", async () => {
    const expectedByType = {
      "pq-public-identity": 16,
      "pq-kem-public-key": 7,
      "pq-dsa-public-key": 10,
    } as const
    for (const fixture of artifactFixtures()) {
      if (!(fixture.artifactType in expectedByType)) continue
      const expectedFrames =
        expectedByType[fixture.artifactType as keyof typeof expectedByType]
      const frames = await splitIntoFrames({
        artifactType: fixture.artifactType,
        artifactBytes: fixture.bytes,
        frameBytes: PQ_KEY_QR_FRAME_BYTES,
      })
      expect(frames).toHaveLength(expectedFrames)
      for (const frame of frames) {
        const payload = encodeFrameToPayload(frame)
        expect(payloadFits(payload, "Q")).toBe(true)
      }
    }
  }, 60_000)
})
