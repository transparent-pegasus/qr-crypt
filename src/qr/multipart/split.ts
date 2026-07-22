// artifact 生バイト → OCF2 フレーム列(spec2 §12、plan2.1 §D1/§D3 — WP-12)。
// chunk は artifact CBOR の生バイトを直接分割する(inner 文字列の再 base64url 禁止)。
// transferId は 16B CSPRNG。payloadSha256 は WebCrypto(async)で計算する。
// 生成後は各フレーム文字列が EC-Q に収まることを payloadFits(…, "Q") で確認し、
// 収まらなければ QR_TOO_LARGE(plan2.1 §D3)。
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"

export interface SplitIntoFramesArgs {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
  frameBytes: number // FRAME_BYTES_MIN..FRAME_BYTES_MAX(Preferences 由来)
}

export function splitIntoFrames(args: SplitIntoFramesArgs): Promise<QrFrameV2[]> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-12 splitIntoFrames")
}
