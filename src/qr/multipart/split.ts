// Raw artifact bytes → OCF2 frame sequence; see docs/spec/qr-protocol-v2.md §6.
// Split raw artifact-CBOR bytes directly into chunks; re-encoding an inner string as
// base64url is prohibited. transferId is 16B from the CSPRNG. After generation, verify
// with payloadFits(…, "Q") that every frame string fits EC-Q; otherwise fail with
// QR_TOO_LARGE.
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
} from "@/lib/limits"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import { payloadFits } from "@/qr/encode"
import { env } from "@/schemas/env-schema"

export interface SplitIntoFramesArgs {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
  // FRAME_BYTES_MIN..FRAME_BYTES_MAX (from Preferences or an automatic
  // per-artifact clamp). Every chunk but the last carries exactly this many
  // bytes; receivers accept any chunk partition, so an uneven one from another
  // sender still assembles.
  frameBytes: number
}

export async function splitIntoFrames(args: SplitIntoFramesArgs): Promise<QrFrameV2[]> {
  const { artifactType, artifactBytes, frameBytes } = args
  if (artifactType === "encrypted-seed-backup") {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  if (!(artifactBytes instanceof Uint8Array) || artifactBytes.byteLength === 0) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (artifactBytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE) {
    throw new AppError("QR_TOO_LARGE")
  }
  if (
    !Number.isSafeInteger(frameBytes) ||
    frameBytes < FRAME_BYTES_MIN ||
    frameBytes > FRAME_BYTES_MAX
  ) {
    throw new AppError("QR_TOO_LARGE")
  }

  const frameCount = Math.ceil(artifactBytes.byteLength / frameBytes)
  if (frameCount > env.qrMaxFrames) throw new AppError("QR_TOO_LARGE")

  // Pin an owned copy first so every chunk is sliced from the same snapshot even
  // if the caller mutates the input view while frames are being built.
  const stableArtifactBytes = Uint8Array.from(artifactBytes)
  const transferId = randomBytes(16)
  const frames: QrFrameV2[] = []
  let chunkStart = 0

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const chunkEnd = Math.min(stableArtifactBytes.byteLength, chunkStart + frameBytes)
    const frame: QrFrameV2 = {
      version: 2,
      type: "qr-frame",
      transferId: Uint8Array.from(transferId),
      artifactType,
      frameIndex,
      frameCount,
      totalByteLength: stableArtifactBytes.byteLength,
      chunk: stableArtifactBytes.slice(chunkStart, chunkEnd),
    }
    const payload = encodeFrameToPayload(frame)
    if (!payloadFits(payload, "Q")) throw new AppError("QR_TOO_LARGE")
    frames.push(frame)
    chunkStart = chunkEnd
  }

  return frames
}
