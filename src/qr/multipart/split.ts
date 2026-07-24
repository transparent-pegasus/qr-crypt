// artifact 生バイト → OCF2 フレーム列(spec2 §12、plan2.1 §D1/§D3 — WP-12)。
// chunk は artifact CBOR の生バイトを直接分割する(inner 文字列の再 base64url 禁止)。
// transferId は 16B CSPRNG。生成後は各フレーム文字列が EC-Q に収まることを
// payloadFits(…, "Q") で確認し、収まらなければ QR_TOO_LARGE(plan2.1 §D3)。
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { sha256 } from "@/lib/bytes"
import { FRAME_BYTES_MAX, FRAME_CHUNK_MIN_BYTES } from "@/lib/limits"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import { payloadFits } from "@/qr/encode"
import { env } from "@/schemas/env-schema"

export interface SplitIntoFramesArgs {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
  // FRAME_CHUNK_MIN_BYTES..FRAME_BYTES_MAX(Preferences 由来、または鍵 QR 固定 chunk)
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
  if (
    !Number.isSafeInteger(frameBytes) ||
    frameBytes < FRAME_CHUNK_MIN_BYTES ||
    frameBytes > FRAME_BYTES_MAX
  ) {
    throw new AppError("QR_TOO_LARGE")
  }

  const frameCount = Math.ceil(artifactBytes.byteLength / frameBytes)
  if (frameCount > env.qrMaxFrames) throw new AppError("QR_TOO_LARGE")

  // digest の await 中に caller が入力 view を変更しても、hash と chunk が
  // 異なる snapshot を参照しないよう先に所有コピーへ固定する。
  const stableArtifactBytes = Uint8Array.from(artifactBytes)
  const transferId = randomBytes(16)
  const payloadSha256 = await sha256(stableArtifactBytes)
  const frames: QrFrameV2[] = []

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const chunkStart = frameIndex * frameBytes
    const frame: QrFrameV2 = {
      version: 2,
      type: "qr-frame",
      transferId: Uint8Array.from(transferId),
      artifactType,
      frameIndex,
      frameCount,
      totalByteLength: stableArtifactBytes.byteLength,
      payloadSha256: Uint8Array.from(payloadSha256),
      chunk: stableArtifactBytes.slice(chunkStart, chunkStart + frameBytes),
    }
    const payload = encodeFrameToPayload(frame)
    if (!payloadFits(payload, "Q")) throw new AppError("QR_TOO_LARGE")
    frames.push(frame)
  }

  return frames
}
