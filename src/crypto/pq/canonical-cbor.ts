// v2 決定的 CBOR(plan2.1 §C9 — WP-A2 が実装・凍結。変更はプロトコル改版)。
//
// プロファイル: RFC 8949 §4.2.1 core deterministic encoding のサブセット。
//   - 値は map(text key のみ)/ text string / byte string / 非負整数 に限定
//   - すべて definite length。タグ・浮動小数・負数・配列・null・bool は禁止
//   - 整数・長さヘッダーは preferred encoding(最小表現)
//   - map キーは「キー単体の符号化バイト列」の bytewise 辞書順・重複禁止
//   - 未知キー・後続データ・非正準入力は拒否
//
// 実装方式: ワイヤー契約を外部エンコーダーの版依存挙動から切り離すため、
// 本プロファイル専用の符号化・復号を自前実装する(cbor-x は v1 経路専用。
// cbor-x の既定は map 長 2 バイト固定・2^32 超の整数を float64 化するため
// 本プロファイルには使用できない)。復号は最小表現・キー昇順・単一値を構造的に
// 強制した上で、防御として再符号化バイト一致も検査する。
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  MlKemAadV2,
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
  SignedMessageBodyV2,
  SignedMessageV2,
  UnsignedMessageBodyV2,
} from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { bytesEqual } from "@/lib/bytes"
import {
  FRAME_CHUNK_MAX_BYTES,
  HKDF_SALT_BYTES,
  IV_BYTES,
  KEY_ID_PATTERN,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  MESSAGE_ID_BYTES,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { suiteComponents } from "@/crypto/pq/suites"
import {
  ML_DSA_ALGORITHMS,
  ML_KEM_ALGORITHMS,
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

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

// ---------------------------------------------------------------------------
// 符号化
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

const encodedKeyCache = new Map<string, Uint8Array>()

function encodedKeyBytes(key: string): Uint8Array {
  let bytes = encodedKeyCache.get(key)
  if (bytes === undefined) {
    const utf8 = utf8Encoder.encode(key)
    const header = headerBytes(MAJOR_TEXT, utf8.byteLength)
    bytes = new Uint8Array(header.byteLength + utf8.byteLength)
    bytes.set(header, 0)
    bytes.set(utf8, header.byteLength)
    encodedKeyCache.set(key, bytes)
  }
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
// 復号(strict: 最小表現・definite length・キー昇順・単一値を構造的に強制)
// ---------------------------------------------------------------------------

interface CborReader {
  bytes: Uint8Array
  offset: number
}

function readU8(reader: CborReader): number {
  const byte = reader.bytes[reader.offset]
  if (byte === undefined) throw new AppError("INVALID_QR_PAYLOAD")
  reader.offset += 1
  return byte
}

// additional info から長さ/値を最小表現強制付きで読む
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
  // 28–30(予約)と 31(不定長)は禁止
  throw new AppError("INVALID_QR_PAYLOAD")
}

function readSlice(reader: CborReader, length: number): Uint8Array {
  if (reader.offset + length > reader.bytes.byteLength) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  // 呼出側での保持・zeroize 所有を単純化するためコピーを返す
  const slice = reader.bytes.slice(reader.offset, reader.offset + length)
  reader.offset += length
  return slice
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
    const slice = readSlice(reader, readLength(reader, additional))
    try {
      return utf8Decoder.decode(slice)
    } catch {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
  }
  if (major === MAJOR_MAP) {
    const count = readLength(reader, additional)
    const result: Record<string, CanonicalCborValue> = {}
    let previousKeyBytes: Uint8Array | undefined
    for (let index = 0; index < count; index += 1) {
      const keyStart = reader.offset
      const key = readValue(reader, depth + 1)
      if (typeof key !== "string") throw new AppError("INVALID_QR_PAYLOAD")
      const keyBytes = reader.bytes.slice(keyStart, reader.offset)
      // 重複キーを含む非昇順は拒否(strict ascending)
      if (previousKeyBytes !== undefined && compareBytes(previousKeyBytes, keyBytes) >= 0) {
        throw new AppError("INVALID_QR_PAYLOAD")
      }
      previousKeyBytes = keyBytes
      result[key] = readValue(reader, depth + 1)
    }
    return result
  }
  // 負数(1)・配列(4)・タグ(6)・float/simple(7)は本プロファイル外
  throw new AppError("INVALID_QR_PAYLOAD")
}

// 単一の正準 CBOR 値のみ受理する。非正準(キー順・重複キー・不定長・
// 非最小整数・タグ等)は構造検査で拒否し、防御として再符号化一致も確認する。
export function decodeCanonicalCbor(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) throw new AppError("INVALID_QR_PAYLOAD")
  const reader: CborReader = { bytes, offset: 0 }
  const value = readValue(reader, 0)
  if (reader.offset !== bytes.byteLength) throw new AppError("INVALID_QR_PAYLOAD")
  const reencoded = encodeCanonicalCbor(value)
  if (!bytesEqual(reencoded, bytes)) throw new AppError("INVALID_QR_PAYLOAD")
  return value
}

// ---------------------------------------------------------------------------
// 構造ガード(プロトコル定数レベルの検証。zod strict の完全検証は
// validation.ts(WP-13)がこの上へ重ねる)
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

// 表示名: 未認証入力のため構造層で resource 上限を張る(1–100 UTF-16 単位)
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
// MlKemAadV2(encode のみ — AAD はワイヤーへ載せず両側で再構築する)
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
  // AES-GCM は 128bit タグを末尾付加するため 16B 未満はあり得ない
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
// 内部メッセージ(plan2.1 §C3)。ワイヤー形状は suite が権威:
//   unsigned suite → UnsignedMessageBodyV2 の map 単体
//   signed suite   → { body: SignedMessageBodyV2, signature } の map
// 平文サイズ上限(env 依存)は validation.ts(WP-13)が検証する。
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

export function guardUnsignedMessageBodyV2(value: unknown): UnsignedMessageBodyV2 {
  const record = guardKeys(value, [
    "version",
    "messageId",
    "createdAt",
    "recipientKemKeyId",
    "plaintext",
  ])
  return guardBodyCommon(record)
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

export function encodeUnsignedMessageBodyV2(body: UnsignedMessageBodyV2): Uint8Array {
  return encodeCanonicalCbor(
    guardUnsignedMessageBodyV2(body) as unknown as CanonicalCborValue,
  )
}

export function decodeUnsignedMessageBodyV2(bytes: Uint8Array): UnsignedMessageBodyV2 {
  return guardUnsignedMessageBodyV2(decodeCanonicalCbor(bytes))
}

// 署名対象 = SignedMessageBodyV2 の map 単体の正準 CBOR(docs/qr-protocol-v2.md §5)
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
// PublicIdentityBundleV2(spec2 §10)
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
  // 同一プロファイル対のみ受理(plan2.1 §C1: 768+87 等の混在禁止)
  const pairValid =
    (kemAlgorithm === "ML-KEM-768" && dsaAlgorithm === "ML-DSA-65") ||
    (kemAlgorithm === "ML-KEM-1024" && dsaAlgorithm === "ML-DSA-87")
  if (!pairValid) throw new AppError("INVALID_QR_PAYLOAD")
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
// 単鍵公開鍵エンベロープ(OCP2/OCS2)
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
// QrFrameV2(spec2 §12、plan2.1 §D4 のプロトコル定数検査を含む)
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
    "payloadSha256",
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
    payloadSha256: guardBytes(record["payloadSha256"], 32),
    chunk,
  }
}

export function encodeQrFrameV2(frame: QrFrameV2): Uint8Array {
  return encodeCanonicalCbor(guardQrFrameV2(frame) as unknown as CanonicalCborValue)
}

export function decodeQrFrameV2(bytes: Uint8Array): QrFrameV2 {
  return guardQrFrameV2(decodeCanonicalCbor(bytes))
}
