// Centralized Base64URL conversion without padding.
// Direct use of btoa/atob in other modules is prohibited.

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

// Throw on invalid characters, padding, or inconsistent length; callers convert
// the error to AppError.
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

// Standard base64 (as found after the comma of a data: URL). Padding required
// where length demands it; throws TypeError like fromBase64Url above.
export function fromStandardBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(text) || text.length % 4 !== 0) {
    throw new TypeError("invalid base64")
  }
  let binary: string
  try {
    binary = atob(text)
  } catch {
    throw new TypeError("invalid base64")
  }
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index)
  }
  return result
}
