// Base64URL(パディング無し)変換の集約点(spec §23)。
// 他モジュールでの btoa/atob 直接使用は禁止。

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

// 不正文字・パディング付き・長さ不整合は throw(呼出側で AppError へ変換)
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(text) || text.length % 4 === 1) {
    throw new TypeError("invalid base64url")
  }
  const paddingLength = (4 - (text.length % 4)) % 4
  const base64 =
    text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(paddingLength)
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    throw new TypeError("invalid base64url")
  }
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index)
  }
  if (toBase64Url(result) !== text) throw new TypeError("non-canonical base64url")
  return result
}
