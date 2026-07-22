// v2 QR ペイロード(spec2 §11/§12、plan2.1 §D — WP-A2 がプレフィックス表と
// フレームコーデックを凍結)。型付きエンベロープの復号・組立・UI 配線は
// WP-12(multipart)/ WP-13(payload 統合)が本モジュールの上へ実装する。
//
// 方針(plan2.1 §D1):
//   - OCM2/OCP2/OCS2/OCI2 は「単一ペイロード表現(貼付・ファイル取込)と論理型」
//   - 表示は常に OCF2(frameCount≥1)。フレームの chunk は artifact CBOR の
//     生バイトを直接分割する(inner 文字列の再 base64url は禁止)
//   - OCB2 は予約のみ(VITE_ENABLE_ENCRYPTED_SEED_BACKUP=false — 生成・受理不可)
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { decodeQrFrameV2, encodeQrFrameV2 } from "@/crypto/pq/canonical-cbor"
import { fromBase64Url, toBase64Url } from "@/lib/base64url"
import { MAX_FRAME_PAYLOAD_CHARS } from "@/lib/limits"

// artifactType ↔ プレフィックスの対応表(v1 プレフィックスの再利用禁止 spec2 §11)
export const QR_PREFIX_V2 = {
  "pq-message": "OCM2:",
  "pq-kem-public-key": "OCP2:",
  "pq-dsa-public-key": "OCS2:",
  "pq-public-identity": "OCI2:",
  "encrypted-seed-backup": "OCB2:",
  frame: "OCF2:",
} as const

export type V2PayloadKind = V2ArtifactType | "frame"

// v2 ペイロード全体(貼付経路)の文字数上限: 最大 artifact(64×900B)の
// base64url + プレフィックス。フレーム経路は MAX_FRAME_PAYLOAD_CHARS が別途上限。
export const MAX_V2_PAYLOAD_CHARS = 80_000

export interface ClassifiedV2Payload {
  kind: V2PayloadKind
  prefix: string
}

// v2 プレフィックス判定。v2 でなければ null(呼出側が v1 経路へ委譲する)。
export function classifyV2Payload(text: string): ClassifiedV2Payload | null {
  for (const [kind, prefix] of Object.entries(QR_PREFIX_V2) as [
    V2PayloadKind,
    string,
  ][]) {
    if (text.startsWith(prefix)) return { kind, prefix }
  }
  return null
}

// 単一ペイロード(bare OC?2)→ artifact 生バイト。型付き検証は呼出側
// (validation.ts / canonical-cbor の各 decode)が行う。
export function splitV2Payload(text: string): { kind: V2ArtifactType; bytes: Uint8Array } {
  const classified = classifyV2Payload(text)
  if (classified === null) throw new AppError("INVALID_QR_PREFIX")
  if (classified.kind === "frame") throw new AppError("INVALID_QR_PAYLOAD")
  if (classified.kind === "encrypted-seed-backup") {
    // 予約プレフィックス(機能フラグ既定 OFF)。受理しない。
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  if (text.length > MAX_V2_PAYLOAD_CHARS) throw new AppError("INVALID_QR_PAYLOAD")
  const body = text.slice(classified.prefix.length)
  if (body.length === 0) throw new AppError("INVALID_QR_PAYLOAD")
  try {
    return { kind: classified.kind, bytes: fromBase64Url(body) }
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}

// artifact 生バイト → 単一ペイロード文字列(bare OC?2)
export function buildV2Payload(kind: V2ArtifactType, bytes: Uint8Array): string {
  if (kind === "encrypted-seed-backup") throw new AppError("UNSUPPORTED_ALGORITHM")
  return `${QR_PREFIX_V2[kind]}${toBase64Url(bytes)}`
}

// ---------------------------------------------------------------------------
// OCF2 フレームコーデック(WP-A2 凍結。split/assemble は WP-12)
// ---------------------------------------------------------------------------

export function encodeFrameToPayload(frame: QrFrameV2): string {
  const payload = `${QR_PREFIX_V2.frame}${toBase64Url(encodeQrFrameV2(frame))}`
  if (payload.length > MAX_FRAME_PAYLOAD_CHARS) {
    // frameBytes の clamp 誤りなど生成側バグ。EC-Q で表示不能な文字列を返さない
    throw new AppError("QR_TOO_LARGE")
  }
  return payload
}

export function decodeFramePayload(text: string): QrFrameV2 {
  if (!text.startsWith(QR_PREFIX_V2.frame)) throw new AppError("INVALID_QR_PREFIX")
  if (text.length > MAX_FRAME_PAYLOAD_CHARS) throw new AppError("INVALID_QR_PAYLOAD")
  const body = text.slice(QR_PREFIX_V2.frame.length)
  if (body.length === 0) throw new AppError("INVALID_QR_PAYLOAD")
  try {
    return decodeQrFrameV2(fromBase64Url(body))
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}
