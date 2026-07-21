// サイズ制約の単一導出表(plan §13 C12)。個別モジュールでの再定義禁止。
import { env } from "@/schemas/env-schema"

// 平文の最大 UTF-8 バイト数(spec §7.2、env で調整可能)
export const MAX_PLAINTEXT_BYTES = env.maxPlaintextBytes

// AES-256-GCM は平文長 + 認証タグ 16B(WebCrypto は末尾付加)
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 16

// AAD("OCAAD1|v|type|alg|keyId|createdAt")の実寸は 60B 前後。余裕を見た上限。
export const MAX_AAD_BYTES = 128

// ペイロード文字列のパース前上限。
// 最大 RSA ハイブリッドエンベロープ ≈ CBOR(固定キー 9 個 + ciphertext 4112B
// + wrappedKey 384B + iv 12B + aad ≤128B + 文字列 ID 群) ≈ 4.7KB
// → base64url ≈ ceil(4700×4/3) ≈ 6267 + プレフィックス 5 ≈ 6.3K < 8192(余裕込み)
export const MAX_PAYLOAD_CHARS = 8192

// 鍵 ID / アーティファクト ID: 16 バイト乱数の base64url(22 文字)
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

// RSA-OAEP-3072 の wrap 出力は常に modulus 長 = 384B
export const WRAPPED_KEY_BYTES = 384

// AES-GCM の IV は 96bit 固定(spec §8)
export const IV_BYTES = 12

// AES-256 raw 鍵長
export const AES_KEY_BYTES = 32
