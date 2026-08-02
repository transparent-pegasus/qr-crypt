// Byte-array utilities. Use toOwnedArrayBuffer to ensure values crossing a
// cryptographic boundary have an owned ArrayBuffer.

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// TextDecoder(fatal: true) throws on invalid UTF-8.
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

// `Cf` alone misses invisible code points that are not format characters:
// variation selectors (U+FE00–FE0F, U+E0100–E01EF) and the combining grapheme
// joiner are `Mn`, and default-ignorable. Match the union so a covert sender
// cannot simply choose a class the scan does not look at.
//
// U+FE0F is the one deliberate exclusion. It is the emoji presentation
// selector, so flagging it would warn on ordinary messages containing emoji;
// an alert that fires constantly stops being read, which costs more than the
// one bit per emoji position it denies. Recorded as residual in
// docs/security/threat-model.md T21.
const INVISIBLE_CHARACTER = /\p{Cf}|\p{Default_Ignorable_Code_Point}/u
const EMOJI_PRESENTATION_SELECTOR = "️"

export function countUnicodeFormatCharacters(text: string): number {
  let count = 0
  for (const character of text) {
    if (character === EMOJI_PRESENTATION_SELECTOR) continue
    if (INVISIBLE_CHARACTER.test(character)) count += 1
  }
  return count
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

// Call immediately before passing data to subtle or Blob. Copy when necessary
// to normalize it to an owned buffer independent of SharedArrayBuffer.
export function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toOwnedArrayBuffer(data)))
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(data))
}
