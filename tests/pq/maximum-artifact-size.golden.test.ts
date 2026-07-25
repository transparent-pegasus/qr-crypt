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
import { concatBytes, sha256 } from "@/lib/bytes"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_BYTES_STEP,
  MAX_PLAINTEXT_BYTES,
  minimumFrameBytesForArtifact,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { payloadFits, renderQrSvgString } from "@/qr/encode"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { env, parseAppEnv } from "@/schemas/env-schema"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const CREATED_AT = 1_700_000_000_000
const FRAME_BYTES = [100, 200, 300, 400, 600, 900] as const

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
    // WebCrypto AES-GCM output length is canonical inner CBOR plus a 128-bit tag.
    ciphertext: new Uint8Array(innerBytes.byteLength + 16).fill(0x77),
  })
}

function publicIdentityArtifact(name: string): Uint8Array {
  return encodePublicIdentityBundleV2({
    version: 2 as const,
    type: "pq-public-identity" as const,
    identityId: KEY_ID,
    name,
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
  })
}

function artifactFixtures(): ArtifactFixture[] {
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
  // OCB2 is reserved and does not yet have a wire schema. Pin this as a capacity fixture
  // for the maximum public keys + encrypted seeds currently stored, not as a contract
  // for future enablement.
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
      expectedFrames: { 100: 19, 200: 10, 300: 7, 400: 5, 600: 4, 900: 3 },
    },
    {
      label: "unsigned / maximum plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(false, MAX_PLAINTEXT_BYTES),
      expectedBytes: 5986,
      expectedFrames: { 100: 60, 200: 30, 300: 20, 400: 15, 600: 10, 900: 7 },
    },
    {
      label: "signed / empty plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(true, 0),
      expectedBytes: 6613,
      expectedFrames: { 100: 67, 200: 34, 300: 23, 400: 17, 600: 12, 900: 8 },
    },
    {
      label: "signed / maximum plaintext",
      artifactType: "pq-message",
      bytes: messageArtifact(true, MAX_PLAINTEXT_BYTES),
      expectedBytes: 10711,
      expectedFrames: {
        100: 108,
        200: 54,
        300: 36,
        400: 27,
        600: 18,
        900: 12,
      },
    },
    {
      label: "OCI2 public bundle",
      artifactType: "pq-public-identity",
      bytes: publicIdentityArtifact("テスト"),
      expectedBytes: 4402,
      expectedFrames: { 100: 45, 200: 23, 300: 15, 400: 12, 600: 8, 900: 5 },
    },
    {
      label: "OCP2 ML-KEM public key",
      artifactType: "pq-kem-public-key",
      bytes: encodeKemPublicKeyEnvelopeV2(kemKey),
      expectedBytes: 1733,
      expectedFrames: { 100: 18, 200: 9, 300: 6, 400: 5, 600: 3, 900: 2 },
    },
    {
      label: "OCS2 ML-DSA public key",
      artifactType: "pq-dsa-public-key",
      bytes: encodeDsaPublicKeyEnvelopeV2(dsaKey),
      expectedBytes: 2755,
      expectedFrames: { 100: 28, 200: 14, 300: 10, 400: 7, 600: 5, 900: 4 },
    },
    {
      label: "OCB2 encrypted-seed-backup reserved fixture",
      artifactType: "encrypted-seed-backup",
      bytes: encryptedSeedBackup,
      expectedBytes: 4637,
      expectedFrames: { 100: 47, 200: 24, 300: 16, 400: 12, 600: 8, 900: 6 },
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
        const expectedFrames = fixture.expectedFrames[frameBytes]
        if (
          fixture.artifactType !== "encrypted-seed-backup" &&
          expectedFrames > env.qrMaxFrames
        ) {
          await expect(
            splitIntoFrames({
              artifactType: fixture.artifactType,
              artifactBytes: fixture.bytes,
              frameBytes,
            }),
          ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
          continue
        }
        const frames =
          fixture.artifactType === "encrypted-seed-backup"
            ? await reservedBackupFrames(fixture.bytes, frameBytes)
            : await splitIntoFrames({
                artifactType: fixture.artifactType,
                artifactBytes: fixture.bytes,
                frameBytes,
              })
        expect(frames).toHaveLength(expectedFrames)
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

  it("env capacity guard uses maximum selectable density, including a stored 100B density", () => {
    for (const plaintextBytes of [MAX_PLAINTEXT_BYTES, 16_384]) {
      const signedArtifactBytes = messageArtifact(true, plaintextBytes).byteLength
      const requiredFrames = Math.ceil(signedArtifactBytes / FRAME_BYTES_MAX)
      for (const frameBytes of FRAME_BYTES) {
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
          "the maximum signed canonical CBOR for VITE_MAX_PLAINTEXT_BYTES does not fit within VITE_QR_MAX_FRAMES × the maximum selectable frame density",
        )
      }
    }
    expect(
      parseAppEnv({
        VITE_QR_FRAME_BYTES: "250",
      }).qrFrameBytes,
    ).toBe(250)
  })

  it("uses the same preference-controlled density for identity and single-key artifacts", async () => {
    for (const fixture of artifactFixtures()) {
      if (
        fixture.artifactType !== "pq-public-identity" &&
        fixture.artifactType !== "pq-kem-public-key" &&
        fixture.artifactType !== "pq-dsa-public-key"
      ) {
        continue
      }
      const frames = await splitIntoFrames({
        artifactType: fixture.artifactType,
        artifactBytes: fixture.bytes,
        frameBytes: 200,
      })
      expect(frames).toHaveLength(fixture.expectedFrames[200])
      expect(concatBytes(...frames.map((frame) => frame.chunk))).toEqual(fixture.bytes)
    }
  })

  it.each([
    { caseName: "signed empty", plaintextBytes: 0, expectedFrames: 34 },
    {
      caseName: "signed maximum",
      plaintextBytes: MAX_PLAINTEXT_BYTES,
      expectedFrames: 54,
    },
  ])(
    "clamps a stored 100B density before the first $caseName split",
    async ({ plaintextBytes, expectedFrames }) => {
      const artifactBytes = messageArtifact(true, plaintextBytes)
      const minimum = minimumFrameBytesForArtifact(artifactBytes.byteLength)
      expect(minimum).toBe(200)
      const frames = await splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes,
        frameBytes: Math.max(FRAME_BYTES_MIN, minimum),
      })
      expect(frames).toHaveLength(expectedFrames)
    },
  )

  it("rounds the effective minimum on the 100B grid for a lower frame ceiling", async () => {
    const artifactBytes = messageArtifact(true, MAX_PLAINTEXT_BYTES)
    const originalMaximum = env.qrMaxFrames
    try {
      env.qrMaxFrames = 16
      const minimum = minimumFrameBytesForArtifact(artifactBytes.byteLength)
      expect(minimum).toBe(700)
      expect(minimum % FRAME_BYTES_STEP).toBe(0)
      const frames = await splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes,
        frameBytes: minimum,
      })
      expect(frames).toHaveLength(16)
    } finally {
      env.qrMaxFrames = originalMaximum
    }
  })

  it("fails a genuine over-maximum artifact before generation", async () => {
    const artifactBytes = new Uint8Array(PROTOCOL_MAX_FRAMES * FRAME_BYTES_MAX + 1)
    expect(minimumFrameBytesForArtifact(artifactBytes.byteLength)).toBe(1_000)
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes,
        frameBytes: FRAME_BYTES_MAX,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
  })
})
