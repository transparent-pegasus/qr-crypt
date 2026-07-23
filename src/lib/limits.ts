// サイズ制約の単一導出表(plan §13 C12、v2: plan2.1 §D2)。個別モジュールでの再定義禁止。
import { env } from "@/schemas/env-schema"

// 平文の最大 UTF-8 バイト数(spec §7.2、env で調整可能)
export const MAX_PLAINTEXT_BYTES = env.maxPlaintextBytes

// AES-256-GCM は平文長 + 認証タグ 16B(WebCrypto は末尾付加)
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 16

// AAD("OCAAD1|v|type|alg|keyId|createdAt")の実寸は 60B 前後。余裕を見た上限。
export const MAX_AAD_BYTES = 128

// v1 経路専用のペイロード文字列上限(plan2.1 §D2 — v2 経路では使用しない)。
// 最大 RSA ハイブリッドエンベロープ ≈ CBOR(固定キー 9 個 + ciphertext 4112B
// + wrappedKey 384B + iv 12B + aad ≤128B + 文字列 ID 群) ≈ 4.7KB
// → base64url ≈ ceil(4700×4/3) ≈ 6267 + プレフィックス 5 ≈ 6.3K < 8192(余裕込み)
export const MAX_PAYLOAD_CHARS = 8192

// 鍵 ID / アーティファクト ID: 16 バイト乱数の base64url(22 文字)
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
export const KEY_ID_RAW_BYTES = 16

// RSA-OAEP-3072 の wrap 出力は常に modulus 長 = 384B
export const WRAPPED_KEY_BYTES = 384

// AES-GCM の IV は 96bit 固定(spec §8)
export const IV_BYTES = 12

// AES-256 raw 鍵長
export const AES_KEY_BYTES = 32

// ---------------------------------------------------------------------------
// v2 ポスト量子(spec2 §5/§6/§12、plan2.1 §C5/§D2/§G)
// ---------------------------------------------------------------------------

// HKDF-SHA-256 の salt は暗号化ごとの CSPRNG 32B(spec2 §5)
export const HKDF_SALT_BYTES = 32

// messageId は CSPRNG 16B 固定長(plan2.1 §G。リプレイ防止機構ではない)
export const MESSAGE_ID_BYTES = 16

// 鍵生成シード長(spec2 §8。FIPS 203/204 の KeyGen シード)
export const KEM_SEED_BYTES = 64
export const DSA_SEED_BYTES = 32

// フレーム設定の範囲と既定(spec2 §12。Preferences/env の検証は本表を参照)
export const FRAME_BYTES_MIN = 400
export const FRAME_BYTES_MAX = 900
export const FRAME_BYTES_DEFAULT = 600
export const FRAME_INTERVAL_MS_MIN = 150
export const FRAME_INTERVAL_MS_MAX = 2000
export const FRAME_INTERVAL_MS_DEFAULT = 450
export const TRANSFER_TIMEOUT_MINUTES_MIN = 1
export const TRANSFER_TIMEOUT_MINUTES_MAX = 120
export const TRANSFER_TIMEOUT_MINUTES_DEFAULT = 10
export const RESET_CHURN_MB_MIN = 0
export const RESET_CHURN_MB_MAX = 512

// プロトコル上の絶対上限(受信側 resource 検査。plan2.1 §D4)。
// 送信側の生成上限は env.qrMaxFrames(≤64)で別途絞る。
// 2026-07-23 maximum 正準 CBOR 実測(maxPlaintext=4,096B、name="テスト"):
// artifact                         bytes   OCF2 frames (400 / 600 / 900B)
// unsigned empty / max          1,887 / 5,986       5/4/3 / 15/10/7
// signed empty / max            6,613 / 10,711     17/12/8 / 27/18/12
// OCI2 bundle                    4,402              12/8/5
// OCP2 KEM / OCS2 DSA           1,733 / 2,755       5/3/2 / 7/5/4
// OCB2 reserved sizing fixture   4,637              12/8/6
// 各 OCF2 文字列の EC-Q 実生成も maximum-artifact-size.golden.test.ts で固定する。
export const PROTOCOL_MAX_FRAMES = 64
export const FRAME_CHUNK_MAX_BYTES = FRAME_BYTES_MAX
export const MAX_ARTIFACT_BYTES_ABSOLUTE = PROTOCOL_MAX_FRAMES * FRAME_CHUNK_MAX_BYTES

// 送信側: 現在の frameBytes 設定で生成可能な artifact 生バイト上限(plan2.1 §D2)
export function maxArtifactBytes(frameBytes: number): number {
  if (
    !Number.isSafeInteger(frameBytes) ||
    frameBytes < FRAME_BYTES_MIN ||
    frameBytes > FRAME_BYTES_MAX
  ) {
    throw new RangeError("frameBytes out of range")
  }
  return env.qrMaxFrames * frameBytes
}

// OCF2 フレーム文字列(プレフィックス込み)の上限 = QR v40・EC-Q のバイト容量。
// ペイロードは ASCII のみのため文字数 = バイト数(qr/encode.ts の容量表と一致
// していることを tests/pq のゴールデンテストで固定する)。
export const MAX_FRAME_PAYLOAD_CHARS = 1663
