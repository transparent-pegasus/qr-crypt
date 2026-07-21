// CSPRNG ユーティリティ。Math.random の使用は全域で禁止(spec §33)。
import { AppError } from "@/crypto/errors"
import { toBase64Url } from "@/lib/base64url"

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65_536) {
    throw new AppError("ENCRYPTION_FAILED")
  }
  try {
    return crypto.getRandomValues(new Uint8Array(length))
  } catch {
    throw new AppError("ENCRYPTION_FAILED")
  }
}

// 16 バイト乱数 → base64url 22 文字(docs/qr-protocol.md §8)
export function generateKeyId(): string {
  return toBase64Url(randomBytes(16))
}

export function generateArtifactId(): string {
  return toBase64Url(randomBytes(16))
}

// ファイル名などに使う短縮 ID(先頭 8 文字)
export function shortId(id: string): string {
  return id.slice(0, 8)
}
