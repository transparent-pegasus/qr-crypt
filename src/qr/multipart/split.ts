// artifact 生バイト → OCF2 フレーム列(spec2 §12、plan2.1 §D1/§D3 — WP-12)。
// chunk は artifact CBOR の生バイトを直接分割する(inner 文字列の再 base64url 禁止)。
// transferId は 16B CSPRNG。生成後は各フレーム文字列が EC-Q に収まることを
// payloadFits(…, "Q") で確認し、収まらなければ QR_TOO_LARGE(plan2.1 §D3)。
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { sha256 } from "@/lib/bytes"
import {
  FRAME_BYTES_MAX,
  FRAME_CHUNK_MAX_BYTES,
  FRAME_CHUNK_MIN_BYTES,
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
        // FRAME_CHUNK_MIN_BYTES..FRAME_BYTES_MAX(Preferences 由来、または単鍵 QR 固定 chunk)
        frameBytes: number
        frameCount?: never
      }
    | {
        // 指定枚数へ非空・均等分割する。frameBytes mode とは排他的。
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
      frameBytes < FRAME_CHUNK_MIN_BYTES ||
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

  // digest の await 中に caller が入力 view を変更しても、hash と chunk が
  // 異なる snapshot を参照しないよう先に所有コピーへ固定する。
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
