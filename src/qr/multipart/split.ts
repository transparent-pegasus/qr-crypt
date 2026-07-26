// Raw artifact bytes → OCF2 frame sequence; see docs/qr-protocol-v2.md §6.
// Split raw artifact-CBOR bytes directly into chunks; re-encoding an inner string as
// base64url is prohibited. transferId is 16B from the CSPRNG. After generation, verify
// with payloadFits(…, "Q") that every frame string fits EC-Q; otherwise fail with
// QR_TOO_LARGE.
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { sha256 } from "@/lib/bytes"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_CHUNK_MAX_BYTES,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
} from "@/lib/limits"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import { payloadFits } from "@/qr/encode"
import { env } from "@/schemas/env-schema"

interface SplitIntoFramesBaseArgs {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
}

export type SplitIntoFramesArgs = SplitIntoFramesBaseArgs &
  (
    | {
        // FRAME_BYTES_MIN..FRAME_BYTES_MAX (from Preferences or an automatic
        // per-artifact clamp).
        frameBytes: number
        frameCount?: never
      }
    | {
        // Split evenly into the requested number of non-empty frames.
        // This is mutually exclusive with frameBytes mode.
        frameCount: number
        frameBytes?: never
      }
  )

export async function splitIntoFrames(args: SplitIntoFramesArgs): Promise<QrFrameV2[]> {
  const { artifactType, artifactBytes } = args
  if (artifactType === "encrypted-seed-backup") {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  if (!(artifactBytes instanceof Uint8Array) || artifactBytes.byteLength === 0) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (artifactBytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE) {
    throw new AppError("QR_TOO_LARGE")
  }

  const frameBytes = "frameBytes" in args ? args.frameBytes : undefined
  const requestedFrameCount = "frameCount" in args ? args.frameCount : undefined
  if ((frameBytes === undefined) === (requestedFrameCount === undefined)) {
    throw new AppError("QR_TOO_LARGE")
  }

  let frameCount: number
  let balancedChunkBytes = 0
  let largerBalancedChunks = 0
  if (frameBytes !== undefined) {
    if (
      !Number.isSafeInteger(frameBytes) ||
      frameBytes < FRAME_BYTES_MIN ||
      frameBytes > FRAME_BYTES_MAX
    ) {
      throw new AppError("QR_TOO_LARGE")
    }
    frameCount = Math.ceil(artifactBytes.byteLength / frameBytes)
  } else {
    if (
      typeof requestedFrameCount !== "number" ||
      !Number.isSafeInteger(requestedFrameCount) ||
      requestedFrameCount < 1 ||
      requestedFrameCount > env.qrMaxFrames ||
      requestedFrameCount > artifactBytes.byteLength
    ) {
      throw new AppError("QR_TOO_LARGE")
    }
    frameCount = requestedFrameCount
    balancedChunkBytes = Math.floor(artifactBytes.byteLength / frameCount)
    largerBalancedChunks = artifactBytes.byteLength % frameCount
    if (balancedChunkBytes + (largerBalancedChunks > 0 ? 1 : 0) > FRAME_CHUNK_MAX_BYTES) {
      throw new AppError("QR_TOO_LARGE")
    }
  }
  if (frameCount > env.qrMaxFrames) throw new AppError("QR_TOO_LARGE")

  // Pin an owned copy first so the hash and chunks cannot observe different snapshots
  // if the caller mutates the input view while the digest is pending.
  const stableArtifactBytes = Uint8Array.from(artifactBytes)
  const transferId = randomBytes(16)
  const payloadSha256 = await sha256(stableArtifactBytes)
  const frames: QrFrameV2[] = []
  let chunkStart = 0

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const chunkLength =
      frameBytes ?? balancedChunkBytes + (frameIndex < largerBalancedChunks ? 1 : 0)
    const chunkEnd = Math.min(stableArtifactBytes.byteLength, chunkStart + chunkLength)
    const frame: QrFrameV2 = {
      version: 2,
      type: "qr-frame",
      transferId: Uint8Array.from(transferId),
      artifactType,
      frameIndex,
      frameCount,
      totalByteLength: stableArtifactBytes.byteLength,
      payloadSha256: Uint8Array.from(payloadSha256),
      chunk: stableArtifactBytes.slice(chunkStart, chunkEnd),
    }
    const payload = encodeFrameToPayload(frame)
    if (!payloadFits(payload, "Q")) throw new AppError("QR_TOO_LARGE")
    frames.push(frame)
    chunkStart = chunkEnd
  }

  return frames
}
