// CSPRNG utilities. Math.random is prohibited throughout the application.
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

// 16 random bytes → 22 base64url characters (docs/qr-protocol.md §8).
export function generateKeyId(): string {
  return toBase64Url(randomBytes(16))
}

export function generateArtifactId(): string {
  return toBase64Url(randomBytes(16))
}

// Abbreviated ID for filenames and similar uses (first 8 characters).
export function shortId(id: string): string {
  return id.slice(0, 8)
}
