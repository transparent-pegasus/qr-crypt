// バイト列ユーティリティ。暗号境界へ渡す値は toOwnedArrayBuffer で
// owned ArrayBuffer を保証する(plan §13 C25)。

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// TextDecoder(fatal: true)— 不正 UTF-8 は throw
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

export function utf8ByteLength(text: string): number {
  return utf8ToBytes(text).byteLength
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = ""
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0")
  return result
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let difference = 0
  for (let index = 0; index < a.byteLength; index += 1) {
    difference |= a[index]! ^ b[index]!
  }
  return difference === 0
}

// subtle / Blob へ渡す直前に呼び、必要ならコピーして
// SharedArrayBuffer 非依存の owned バッファへ正規化する
export function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toOwnedArrayBuffer(data)))
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(data))
}
