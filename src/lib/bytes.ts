// バイト列ユーティリティ。暗号境界へ渡す値は toOwnedArrayBuffer で
// owned ArrayBuffer を保証する(plan §13 C25)。

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function utf8ToBytes(text: string): Uint8Array {
  return notImplemented(text)
}

// TextDecoder(fatal: true)— 不正 UTF-8 は throw
export function bytesToUtf8(bytes: Uint8Array): string {
  return notImplemented(bytes)
}

export function utf8ByteLength(text: string): number {
  return notImplemented(text)
}

export function bytesToHex(bytes: Uint8Array): string {
  return notImplemented(bytes)
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  return notImplemented(parts)
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return notImplemented(a, b)
}

// subtle / Blob へ渡す直前に呼び、必要ならコピーして
// SharedArrayBuffer 非依存の owned バッファへ正規化する
export function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return notImplemented(bytes)
}

export function sha256(data: Uint8Array): Promise<Uint8Array> {
  return notImplemented(data)
}

export function sha256Hex(data: Uint8Array): Promise<string> {
  return notImplemented(data)
}
