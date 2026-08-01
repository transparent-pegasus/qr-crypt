// v2 deterministic CBOR; changes require a protocol revision.
// See docs/spec/qr-protocol-v2.md §2 and §8.
//
// Profile: a subset of RFC 8949 §4.2.1 core deterministic encoding.
//   - Values are restricted to maps (text keys only), text strings, byte strings,
//     and nonnegative integers.
//   - All lengths are definite; tags, floats, negative integers, arrays, null, and
//     booleans are prohibited.
//   - Integers and length headers use preferred encoding (the shortest representation).
//   - Map keys are sorted bytewise by each key's encoded bytes; duplicates are prohibited.
//   - Unknown keys, trailing data, and non-canonical input are rejected.
//
// Implementation: encode and decode this profile directly so the wire contract is isolated
// from version-dependent behavior in external encoders. Decoding structurally enforces shortest forms,
// ascending keys, and a single value, then defensively checks re-encoded byte equality.
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  MlKemAadV2,
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
  SignedMessageBodyV2,
  SignedMessageV2,
  SymAadV2,
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
} from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { bytesEqual } from "@/lib/bytes"
import {
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  FRAME_CHUNK_MAX_BYTES,
  HKDF_SALT_BYTES,
  IV_BYTES,
  KEY_ID_PATTERN,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  MAX_SYM_PLAINTEXT_BYTES,
  MESSAGE_ID_BYTES,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { suiteComponents } from "@/crypto/pq/suites"
import {
  ML_DSA_ALGORITHMS,
  ML_KEM_ALGORITHMS,
  SYM_SUITE,
  V2_ARTIFACT_TYPES,
  WIRE_SUITES,
} from "@/schemas/domain"

export type CanonicalCborValue =
  | string
  | number
  | Uint8Array
  | { [key: string]: CanonicalCborValue }

const MAJOR_UINT = 0
const MAJOR_BYTES = 2
const MAJOR_TEXT = 3
const MAJOR_MAP = 5

// Structural allocation limits follow the largest active protocol shapes:
// the largest single map has 8 entries (QrFrameV2, MlKemMessageEnvelopeV2,
// and SymMessageEnvelopeV2);
// PublicIdentityBundleV2 has 13 entries across its root and two nested key
// maps. The longest decoded key is "senderSigningKeyId" (18 UTF-8 bytes) —
// "kemCiphertextSha256" (19) exists only in the encode-side AAD, which is
// never decoded. The only free text is a display name, capped by its guard at
// 100 UTF-16 code units (at most 300 UTF-8 bytes for valid scalar values).
const MAX_MAP_ENTRIES = 8
const MAX_TOTAL_MAP_ENTRIES = 13
const MAX_KEY_UTF8_BYTES = 18
const MAX_TEXT_UTF8_BYTES = 300

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function headerBytes(major: number, value: number): Uint8Array {
  if (value < 24) return Uint8Array.of((major << 5) | value)
  if (value < 0x100) return Uint8Array.of((major << 5) | 24, value)
  if (value < 0x1_0000) {
    return Uint8Array.of((major << 5) | 25, value >>> 8, value & 0xff)
  }
  if (value < 0x1_0000_0000) {
    const out = new Uint8Array(5)
    out[0] = (major << 5) | 26
    new DataView(out.buffer).setUint32(1, value)
    return out
  }
  const out = new Uint8Array(9)
  out[0] = (major << 5) | 27
  const view = new DataView(out.buffer)
  view.setUint32(1, Math.floor(value / 0x1_0000_0000))
  view.setUint32(5, value % 0x1_0000_0000)
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  if (value instanceof Uint8Array) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.byteLength, b.byteLength)
  for (let index = 0; index < length; index += 1) {
    const difference = a[index]! - b[index]!
    if (difference !== 0) return difference
  }
  return a.byteLength - b.byteLength
}

function encodedKeyBytes(key: string): Uint8Array {
  const utf8 = utf8Encoder.encode(key)
  const header = headerBytes(MAJOR_TEXT, utf8.byteLength)
  const bytes = new Uint8Array(header.byteLength + utf8.byteLength)
  bytes.set(header, 0)
  bytes.set(utf8, header.byteLength)
  return bytes
}

function writeValue(value: unknown, out: Uint8Array[]): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
    out.push(headerBytes(MAJOR_UINT, value))
    return
  }
  if (typeof value === "string") {
    const utf8 = utf8Encoder.encode(value)
    out.push(headerBytes(MAJOR_TEXT, utf8.byteLength), utf8)
    return
  }
  if (value instanceof Uint8Array) {
    out.push(headerBytes(MAJOR_BYTES, value.byteLength), value)
    return
  }
  if (Array.isArray(value) || !isPlainObject(value)) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  const keys = Object.keys(value)
  keys.sort((a, b) => compareBytes(encodedKeyBytes(a), encodedKeyBytes(b)))
  out.push(headerBytes(MAJOR_MAP, keys.length))
  for (const key of keys) {
    out.push(encodedKeyBytes(key))
    writeValue(value[key], out)
  }
}

export function encodeCanonicalCbor(value: CanonicalCborValue): Uint8Array {
  const parts: Uint8Array[] = []
  writeValue(value, parts)
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

// ---------------------------------------------------------------------------
// Decoding (strict: structurally enforce shortest forms, definite lengths,
// ascending keys, and a single value)
// ---------------------------------------------------------------------------

interface CborReader {
  bytes: Uint8Array
  offset: number
  mapEntries: number
}

function readU8(reader: CborReader): number {
  const byte = reader.bytes[reader.offset]
  if (byte === undefined) throw new AppError("INVALID_QR_PAYLOAD")
  reader.offset += 1
  return byte
}

// Read a length/value from additional info while enforcing the shortest representation.
function readLength(reader: CborReader, additional: number): number {
  if (additional < 24) return additional
  if (additional === 24) {
    const value = readU8(reader)
    if (value < 24) throw new AppError("INVALID_QR_PAYLOAD")
    return value
  }
  if (additional === 25) {
    const value = (readU8(reader) << 8) | readU8(reader)
    if (value < 0x100) throw new AppError("INVALID_QR_PAYLOAD")
    return value
  }
  if (additional === 26) {
    let value = 0
    for (let index = 0; index < 4; index += 1) value = value * 0x100 + readU8(reader)
    if (value < 0x1_0000) throw new AppError("INVALID_QR_PAYLOAD")
    return value
  }
  if (additional === 27) {
    let high = 0
    for (let index = 0; index < 4; index += 1) high = high * 0x100 + readU8(reader)
    let low = 0
    for (let index = 0; index < 4; index += 1) low = low * 0x100 + readU8(reader)
    const value = high * 0x1_0000_0000 + low
    if (value < 0x1_0000_0000 || !Number.isSafeInteger(value)) {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
    return value
  }
  // Additional-info values 28–30 (reserved) and 31 (indefinite length) are prohibited.
  throw new AppError("INVALID_QR_PAYLOAD")
}

function readSlice(reader: CborReader, length: number): Uint8Array {
  if (length > reader.bytes.byteLength - reader.offset) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  // Return a copy to simplify caller ownership for retention and zeroization.
  const slice = reader.bytes.slice(reader.offset, reader.offset + length)
  reader.offset += length
  return slice
}

function readText(
  reader: CborReader,
  additional: number,
  maximumUtf8Bytes: number,
): string {
  const length = readLength(reader, additional)
  if (length > maximumUtf8Bytes) throw new AppError("INVALID_QR_PAYLOAD")
  const slice = readSlice(reader, length)
  try {
    return utf8Decoder.decode(slice)
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
}

function readMapKey(
  reader: CborReader,
): { key: string; encodedBytes: Uint8Array } {
  const keyStart = reader.offset
  const initial = readU8(reader)
  if (initial >> 5 !== MAJOR_TEXT) throw new AppError("INVALID_QR_PAYLOAD")
  const key = readText(reader, initial & 0x1f, MAX_KEY_UTF8_BYTES)
  return {
    key,
    encodedBytes: reader.bytes.slice(keyStart, reader.offset),
  }
}

function readValue(reader: CborReader, depth: number): CanonicalCborValue {
  if (depth > 8) throw new AppError("INVALID_QR_PAYLOAD")
  const initial = readU8(reader)
  const major = initial >> 5
  const additional = initial & 0x1f
  if (major === MAJOR_UINT) return readLength(reader, additional)
  if (major === MAJOR_BYTES) {
    return readSlice(reader, readLength(reader, additional))
  }
  if (major === MAJOR_TEXT) {
    return readText(reader, additional, MAX_TEXT_UTF8_BYTES)
  }
  if (major === MAJOR_MAP) {
    const count = readLength(reader, additional)
    if (
      count > MAX_MAP_ENTRIES ||
      reader.mapEntries > MAX_TOTAL_MAP_ENTRIES - count
    ) {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
    reader.mapEntries += count
    const result = Object.create(null) as Record<string, CanonicalCborValue>
    let previousKeyBytes: Uint8Array | undefined
    for (let index = 0; index < count; index += 1) {
      const { key, encodedBytes: keyBytes } = readMapKey(reader)
      // Reject non-ascending keys, including duplicates (strictly ascending).
      if (previousKeyBytes !== undefined && compareBytes(previousKeyBytes, keyBytes) >= 0) {
        throw new AppError("INVALID_QR_PAYLOAD")
      }
      previousKeyBytes = keyBytes
      result[key] = readValue(reader, depth + 1)
    }
    return result
  }
  // Negative integers (1), arrays (4), tags (6), and float/simple values (7)
  // are outside this profile.
  throw new AppError("INVALID_QR_PAYLOAD")
}

// Accept exactly one canonical CBOR value. Structural checks reject non-canonical input
// (key order, duplicate keys, indefinite lengths, non-minimal integers, tags, and so on);
// re-encoded equality is also checked defensively.
export function decodeCanonicalCbor(bytes: Uint8Array): unknown {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE
  ) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  const reader: CborReader = { bytes, offset: 0, mapEntries: 0 }
  const value = readValue(reader, 0)
  if (reader.offset !== bytes.byteLength) throw new AppError("INVALID_QR_PAYLOAD")
  const reencoded = encodeCanonicalCbor(value)
  if (!bytesEqual(reencoded, bytes)) throw new AppError("INVALID_QR_PAYLOAD")
  return value
}

// ---------------------------------------------------------------------------
// Structural guards validate protocol-level constants. validation.ts
// layers complete strict Zod validation on top.
// ---------------------------------------------------------------------------

function guardKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(value)) throw new AppError("INVALID_QR_PAYLOAD")
  const keys = Object.keys(value)
  for (const key of required) {
    if (!keys.includes(key)) throw new AppError("INVALID_QR_PAYLOAD")
  }
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
  }
  return value
}

function guardBytes(value: unknown, exactLength?: number): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new AppError("INVALID_QR_PAYLOAD")
  if (exactLength !== undefined && value.byteLength !== exactLength) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return value
}

function guardInt(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (value < min || value > max) throw new AppError("INVALID_QR_PAYLOAD")
  return value
}

function guardKeyId(value: unknown): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return value
}

function guardEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return value as T
}

// Display name: because this is untrusted input, enforce a resource bound at the
// structural layer (1–100 UTF-16 code units).
function guardOptionalName(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return value
}

function guardLiteral<T extends string | number>(value: unknown, literal: T): T {
  if (value !== literal) throw new AppError("INVALID_QR_PAYLOAD")
  return literal
}

// ---------------------------------------------------------------------------
// MlKemAadV2 (encode only — AAD is not carried on the wire; both sides reconstruct it).
// ---------------------------------------------------------------------------

export function guardMlKemAadV2(value: unknown): MlKemAadV2 {
  const record = guardKeys(value, [
    "version",
    "type",
    "suite",
    "recipientKemKeyId",
    "kemCiphertextSha256",
  ])
  return {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "pq-message"),
    suite: guardEnum(record["suite"], WIRE_SUITES),
    recipientKemKeyId: guardKeyId(record["recipientKemKeyId"]),
    kemCiphertextSha256: guardBytes(record["kemCiphertextSha256"], 32),
  }
}

export function encodeMlKemAadV2(aad: MlKemAadV2): Uint8Array {
  return encodeCanonicalCbor(
    guardMlKemAadV2(aad) as unknown as CanonicalCborValue,
  )
}

// ---------------------------------------------------------------------------
// MlKemMessageEnvelopeV2
// ---------------------------------------------------------------------------

export function guardMlKemEnvelopeV2(value: unknown): MlKemMessageEnvelopeV2 {
  const record = guardKeys(value, [
    "version",
    "type",
    "suite",
    "recipientKemKeyId",
    "kemCiphertext",
    "hkdfSalt",
    "iv",
    "ciphertext",
  ])
  const suite = guardEnum(record["suite"], WIRE_SUITES)
  const kemCiphertextBytes = KEM_SIZES[suiteComponents(suite).kem].ciphertextBytes
  const ciphertext = guardBytes(record["ciphertext"])
  // AES-GCM appends a 128-bit tag, so fewer than 16 bytes is impossible.
  if (ciphertext.byteLength < 16) throw new AppError("INVALID_QR_PAYLOAD")
  return {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "pq-message"),
    suite,
    recipientKemKeyId: guardKeyId(record["recipientKemKeyId"]),
    kemCiphertext: guardBytes(record["kemCiphertext"], kemCiphertextBytes),
    hkdfSalt: guardBytes(record["hkdfSalt"], HKDF_SALT_BYTES),
    iv: guardBytes(record["iv"], IV_BYTES),
    ciphertext,
  }
}

export function encodeMlKemEnvelopeV2(envelope: MlKemMessageEnvelopeV2): Uint8Array {
  return encodeCanonicalCbor(
    guardMlKemEnvelopeV2(envelope) as unknown as CanonicalCborValue,
  )
}

export function decodeMlKemEnvelopeV2(bytes: Uint8Array): MlKemMessageEnvelopeV2 {
  return guardMlKemEnvelopeV2(decodeCanonicalCbor(bytes))
}

// ---------------------------------------------------------------------------
// SymMessageEnvelopeV2 and its reconstructed AAD
// ---------------------------------------------------------------------------

export function guardSymAadV2(value: unknown): SymAadV2 {
  const record = guardKeys(value, [
    "version",
    "type",
    "suite",
    "keyId",
    "createdAt",
  ])
  return {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "sym-message"),
    suite: guardLiteral(record["suite"], SYM_SUITE),
    keyId: guardKeyId(record["keyId"]),
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
  }
}

export function encodeSymAadV2(aad: SymAadV2): Uint8Array {
  return encodeCanonicalCbor(
    guardSymAadV2(aad) as unknown as CanonicalCborValue,
  )
}

export function guardSymMessageEnvelopeV2(
  value: unknown,
): SymMessageEnvelopeV2 {
  const record = guardKeys(value, [
    "version",
    "type",
    "suite",
    "keyId",
    "createdAt",
    "hkdfSalt",
    "iv",
    "ciphertext",
  ])
  const ciphertext = guardBytes(record["ciphertext"])
  if (
    ciphertext.byteLength < AES_GCM_TAG_BYTES ||
    ciphertext.byteLength > MAX_SYM_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES
  ) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "sym-message"),
    suite: guardLiteral(record["suite"], SYM_SUITE),
    keyId: guardKeyId(record["keyId"]),
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
    hkdfSalt: guardBytes(record["hkdfSalt"], HKDF_SALT_BYTES),
    iv: guardBytes(record["iv"], IV_BYTES),
    ciphertext,
  }
}

export function encodeSymMessageEnvelopeV2(
  envelope: SymMessageEnvelopeV2,
): Uint8Array {
  return encodeCanonicalCbor(
    guardSymMessageEnvelopeV2(envelope) as unknown as CanonicalCborValue,
  )
}

export function decodeSymMessageEnvelopeV2(
  bytes: Uint8Array,
): SymMessageEnvelopeV2 {
  return guardSymMessageEnvelopeV2(decodeCanonicalCbor(bytes))
}

// ---------------------------------------------------------------------------
// SymmetricKeyEnvelopeV2
// ---------------------------------------------------------------------------

export function guardSymmetricKeyEnvelopeV2(
  value: unknown,
): SymmetricKeyEnvelopeV2 {
  const record = guardKeys(value, [
    "version",
    "type",
    "algorithm",
    "keyId",
    "createdAt",
    "key",
  ])
  return {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "symmetric-key"),
    algorithm: guardLiteral(record["algorithm"], "A256GCM"),
    keyId: guardKeyId(record["keyId"]),
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
    key: guardBytes(record["key"], AES_KEY_BYTES),
  }
}

export function encodeSymmetricKeyEnvelopeV2(
  envelope: SymmetricKeyEnvelopeV2,
): Uint8Array {
  return encodeCanonicalCbor(
    guardSymmetricKeyEnvelopeV2(envelope) as unknown as CanonicalCborValue,
  )
}

export function decodeSymmetricKeyEnvelopeV2(
  bytes: Uint8Array,
): SymmetricKeyEnvelopeV2 {
  return guardSymmetricKeyEnvelopeV2(decodeCanonicalCbor(bytes))
}

// ---------------------------------------------------------------------------
// Inner signed message: { body: SignedMessageBodyV2, signature }.
// validation.ts enforces the environment-dependent plaintext size limit.
// ---------------------------------------------------------------------------

function guardBodyCommon(record: Record<string, unknown>): {
  version: 2
  messageId: Uint8Array
  createdAt: number
  recipientKemKeyId: string
  plaintext: Uint8Array
} {
  return {
    version: guardLiteral(record["version"], 2),
    messageId: guardBytes(record["messageId"], MESSAGE_ID_BYTES),
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
    recipientKemKeyId: guardKeyId(record["recipientKemKeyId"]),
    plaintext: guardBytes(record["plaintext"]),
  }
}

export function guardSignedMessageBodyV2(value: unknown): SignedMessageBodyV2 {
  const record = guardKeys(value, [
    "version",
    "messageId",
    "createdAt",
    "recipientKemKeyId",
    "plaintext",
    "senderSigningKeyId",
  ])
  return {
    ...guardBodyCommon(record),
    senderSigningKeyId: guardKeyId(record["senderSigningKeyId"]),
  }
}

export function guardSignedMessageV2(value: unknown): Omit<SignedMessageV2, "kind"> {
  const record = guardKeys(value, ["body", "signature"])
  const signatureRecord = guardKeys(record["signature"], ["algorithm", "value"])
  const algorithm = guardEnum(signatureRecord["algorithm"], ML_DSA_ALGORITHMS)
  return {
    body: guardSignedMessageBodyV2(record["body"]),
    signature: {
      algorithm,
      value: guardBytes(signatureRecord["value"], DSA_SIZES[algorithm].signatureBytes),
    },
  }
}

// Signing target = canonical CBOR of the standalone SignedMessageBodyV2 map
// (docs/spec/qr-protocol-v2.md §5).
export function signingTargetBytes(body: SignedMessageBodyV2): Uint8Array {
  return encodeCanonicalCbor(
    guardSignedMessageBodyV2(body) as unknown as CanonicalCborValue,
  )
}

export function encodeSignedMessageV2(
  message: Omit<SignedMessageV2, "kind">,
): Uint8Array {
  return encodeCanonicalCbor(
    guardSignedMessageV2(message) as unknown as CanonicalCborValue,
  )
}

export function decodeSignedMessageV2(bytes: Uint8Array): Omit<SignedMessageV2, "kind"> {
  return guardSignedMessageV2(decodeCanonicalCbor(bytes))
}

// ---------------------------------------------------------------------------
// PublicIdentityBundleV2; see docs/spec/qr-protocol-v2.md §7.1.
// ---------------------------------------------------------------------------

export function guardPublicIdentityBundleV2(value: unknown): PublicIdentityBundleV2 {
  const record = guardKeys(
    value,
    ["version", "type", "identityId", "kem", "signing", "createdAt"],
    ["name"],
  )
  const kemRecord = guardKeys(record["kem"], ["algorithm", "keyId", "publicKey"])
  const signingRecord = guardKeys(record["signing"], ["algorithm", "keyId", "publicKey"])
  const kemAlgorithm = guardEnum(kemRecord["algorithm"], ML_KEM_ALGORITHMS)
  const dsaAlgorithm = guardEnum(signingRecord["algorithm"], ML_DSA_ALGORITHMS)
  const name = guardOptionalName(record["name"])
  const bundle: PublicIdentityBundleV2 = {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "pq-public-identity"),
    identityId: guardKeyId(record["identityId"]),
    kem: {
      algorithm: kemAlgorithm,
      keyId: guardKeyId(kemRecord["keyId"]),
      publicKey: guardBytes(
        kemRecord["publicKey"],
        KEM_SIZES[kemAlgorithm].publicKeyBytes,
      ),
    },
    signing: {
      algorithm: dsaAlgorithm,
      keyId: guardKeyId(signingRecord["keyId"]),
      publicKey: guardBytes(
        signingRecord["publicKey"],
        DSA_SIZES[dsaAlgorithm].publicKeyBytes,
      ),
    },
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
  }
  if (name !== undefined) bundle.name = name
  return bundle
}

export function encodePublicIdentityBundleV2(
  bundle: PublicIdentityBundleV2,
): Uint8Array {
  return encodeCanonicalCbor(
    guardPublicIdentityBundleV2(bundle) as unknown as CanonicalCborValue,
  )
}

export function decodePublicIdentityBundleV2(bytes: Uint8Array): PublicIdentityBundleV2 {
  return guardPublicIdentityBundleV2(decodeCanonicalCbor(bytes))
}

// ---------------------------------------------------------------------------
// Single public-key envelopes (OCP2/OCS2).
// ---------------------------------------------------------------------------

export function guardKemPublicKeyEnvelopeV2(value: unknown): KemPublicKeyEnvelopeV2 {
  const record = guardKeys(
    value,
    ["version", "type", "identityId", "algorithm", "keyId", "publicKey", "createdAt"],
    ["name"],
  )
  const algorithm = guardEnum(record["algorithm"], ML_KEM_ALGORITHMS)
  const name = guardOptionalName(record["name"])
  const envelope: KemPublicKeyEnvelopeV2 = {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "pq-kem-public-key"),
    identityId: guardKeyId(record["identityId"]),
    algorithm,
    keyId: guardKeyId(record["keyId"]),
    publicKey: guardBytes(record["publicKey"], KEM_SIZES[algorithm].publicKeyBytes),
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
  }
  if (name !== undefined) envelope.name = name
  return envelope
}

export function guardDsaPublicKeyEnvelopeV2(value: unknown): DsaPublicKeyEnvelopeV2 {
  const record = guardKeys(
    value,
    ["version", "type", "identityId", "algorithm", "keyId", "publicKey", "createdAt"],
    ["name"],
  )
  const algorithm = guardEnum(record["algorithm"], ML_DSA_ALGORITHMS)
  const name = guardOptionalName(record["name"])
  const envelope: DsaPublicKeyEnvelopeV2 = {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "pq-dsa-public-key"),
    identityId: guardKeyId(record["identityId"]),
    algorithm,
    keyId: guardKeyId(record["keyId"]),
    publicKey: guardBytes(record["publicKey"], DSA_SIZES[algorithm].publicKeyBytes),
    createdAt: guardInt(record["createdAt"], 0, Number.MAX_SAFE_INTEGER),
  }
  if (name !== undefined) envelope.name = name
  return envelope
}

export function encodeKemPublicKeyEnvelopeV2(
  envelope: KemPublicKeyEnvelopeV2,
): Uint8Array {
  return encodeCanonicalCbor(
    guardKemPublicKeyEnvelopeV2(envelope) as unknown as CanonicalCborValue,
  )
}

export function decodeKemPublicKeyEnvelopeV2(bytes: Uint8Array): KemPublicKeyEnvelopeV2 {
  return guardKemPublicKeyEnvelopeV2(decodeCanonicalCbor(bytes))
}

export function encodeDsaPublicKeyEnvelopeV2(
  envelope: DsaPublicKeyEnvelopeV2,
): Uint8Array {
  return encodeCanonicalCbor(
    guardDsaPublicKeyEnvelopeV2(envelope) as unknown as CanonicalCborValue,
  )
}

export function decodeDsaPublicKeyEnvelopeV2(bytes: Uint8Array): DsaPublicKeyEnvelopeV2 {
  return guardDsaPublicKeyEnvelopeV2(decodeCanonicalCbor(bytes))
}

// ---------------------------------------------------------------------------
// QrFrameV2, including the protocol-constant validation in docs/spec/qr-protocol-v2.md §6.
// ---------------------------------------------------------------------------

export function guardQrFrameV2(value: unknown): QrFrameV2 {
  const record = guardKeys(value, [
    "version",
    "type",
    "transferId",
    "artifactType",
    "frameIndex",
    "frameCount",
    "totalByteLength",
    "chunk",
  ])
  const frameCount = guardInt(record["frameCount"], 1, PROTOCOL_MAX_FRAMES)
  const frameIndex = guardInt(record["frameIndex"], 0, frameCount - 1)
  const totalByteLength = guardInt(
    record["totalByteLength"],
    1,
    MAX_ARTIFACT_BYTES_ABSOLUTE,
  )
  const chunk = guardBytes(record["chunk"])
  if (chunk.byteLength < 1 || chunk.byteLength > FRAME_CHUNK_MAX_BYTES) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (chunk.byteLength > totalByteLength) throw new AppError("INVALID_QR_PAYLOAD")
  return {
    version: guardLiteral(record["version"], 2),
    type: guardLiteral(record["type"], "qr-frame"),
    transferId: guardBytes(record["transferId"], 16),
    artifactType: guardEnum(record["artifactType"], V2_ARTIFACT_TYPES),
    frameIndex,
    frameCount,
    totalByteLength,
    chunk,
  }
}

export function encodeQrFrameV2(frame: QrFrameV2): Uint8Array {
  return encodeCanonicalCbor(guardQrFrameV2(frame) as unknown as CanonicalCborValue)
}

export function decodeQrFrameV2(bytes: Uint8Array): QrFrameV2 {
  return guardQrFrameV2(decodeCanonicalCbor(bytes))
}
