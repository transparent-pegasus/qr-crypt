// CSPRNG ユーティリティ。Math.random の使用は全域で禁止(spec §33)。

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function randomBytes(length: number): Uint8Array {
  return notImplemented(length)
}

// 16 バイト乱数 → base64url 22 文字(docs/qr-protocol.md §8)
export function generateKeyId(): string {
  return notImplemented()
}

export function generateArtifactId(): string {
  return notImplemented()
}

// ファイル名などに使う短縮 ID(先頭 8 文字)
export function shortId(id: string): string {
  return notImplemented(id)
}
