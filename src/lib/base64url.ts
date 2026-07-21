// Base64URL(パディング無し)変換の集約点(spec §23)。
// 他モジュールでの btoa/atob 直接使用は禁止。

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function toBase64Url(bytes: Uint8Array): string {
  return notImplemented(bytes)
}

// 不正文字・パディング付き・長さ不整合は throw(呼出側で AppError へ変換)
export function fromBase64Url(text: string): Uint8Array {
  return notImplemented(text)
}
