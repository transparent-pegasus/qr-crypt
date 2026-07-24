// Store-only (uncompressed) ZIP output for bulk OCF2-frame export.
// Do not add a dependency; fflate was rejected because it lacks provenance.
//
// Frozen constraints:
//   - Entry names are internally generated ASCII only. They are not exposed to zip-slip,
//     but still validate them.
//   - Fixed timestamps for deterministic output.
//   - Bound entry count and total size, and explicitly reject ZIP32 overflow.
//   - Unit tests are required for CRC32 and local/central-directory offsets.
//   - Keep this separate from cryptographic-artifact generation so a ZIP failure
//     does not discard the cryptographic result.
export interface ZipEntry {
  name: string
  data: Uint8Array
}

const ZIP_MAX_ENTRIES = 128
const ZIP_MAX_TOTAL_DATA_BYTES = 256 * 1024 * 1024
const ZIP32_MAX = 0xffff_ffff
const ZIP_FIELD_MAX = 0xffff
const LOCAL_HEADER_BYTES = 30
const CENTRAL_HEADER_BYTES = 46
const END_OF_CENTRAL_DIRECTORY_BYTES = 22
const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
    }
    table[index] = value >>> 0
  }
  return table
})()

interface PreparedEntry {
  data: Uint8Array
  nameBytes: Uint8Array
  crc32: number
  localHeaderOffset: number
}

interface ValidatedEntry {
  data: Uint8Array
  nameBytes: Uint8Array
}

function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

function encodeEntryName(name: string): Uint8Array {
  if (typeof name !== "string" || name.length === 0 || name.length > ZIP_FIELD_MAX) {
    throw new TypeError("ZIP_ENTRY_NAME_INVALID")
  }
  const bytes = new Uint8Array(name.length)
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) throw new TypeError("ZIP_ENTRY_NAME_INVALID")
    bytes[index] = code
  }

  if (
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.includes("\\") ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw new TypeError("ZIP_ENTRY_NAME_INVALID")
  }
  const pathSegments = name.split("/")
  if (
    pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError("ZIP_ENTRY_NAME_INVALID")
  }
  return bytes
}

function checkedAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result) || result > ZIP32_MAX) {
    throw new RangeError("ZIP32_LIMIT_EXCEEDED")
  }
  return result
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

export function storeOnlyZip(entries: readonly ZipEntry[]): Blob {
  if (!Array.isArray(entries)) throw new TypeError("ZIP_ENTRIES_INVALID")
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new RangeError("ZIP_ENTRY_LIMIT_EXCEEDED")
  }

  const validatedEntries: ValidatedEntry[] = []
  let totalDataBytes = 0
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError("ZIP_ENTRY_INVALID")
    }
    const nameBytes = encodeEntryName(entry.name)
    const data = entry.data
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("ZIP_ENTRY_DATA_INVALID")
    }
    if (data.byteLength > ZIP32_MAX) throw new RangeError("ZIP32_LIMIT_EXCEEDED")
    totalDataBytes += data.byteLength
    if (
      !Number.isSafeInteger(totalDataBytes) ||
      totalDataBytes > ZIP_MAX_TOTAL_DATA_BYTES
    ) {
      throw new RangeError("ZIP_TOTAL_SIZE_LIMIT_EXCEEDED")
    }

    validatedEntries.push({ data, nameBytes })
  }

  const preparedEntries: PreparedEntry[] = []
  let localBytes = 0
  let centralBytes = 0
  for (const entry of validatedEntries) {
    const localHeaderOffset = localBytes
    localBytes = checkedAdd(localBytes, LOCAL_HEADER_BYTES + entry.nameBytes.byteLength)
    localBytes = checkedAdd(localBytes, entry.data.byteLength)
    centralBytes = checkedAdd(
      centralBytes,
      CENTRAL_HEADER_BYTES + entry.nameBytes.byteLength,
    )
    preparedEntries.push({
      ...entry,
      crc32: crc32(entry.data),
      localHeaderOffset,
    })
  }

  const centralOffset = localBytes
  const endOffset = checkedAdd(centralOffset, centralBytes)
  const archiveByteLength = checkedAdd(endOffset, END_OF_CENTRAL_DIRECTORY_BYTES)
  const archive = new Uint8Array(archiveByteLength)
  const view = new DataView(archive.buffer)

  let offset = 0
  for (const entry of preparedEntries) {
    writeUint32(view, offset, 0x04034b50)
    writeUint16(view, offset + 4, 20)
    writeUint16(view, offset + 6, 0)
    writeUint16(view, offset + 8, 0)
    writeUint16(view, offset + 10, DOS_TIME)
    writeUint16(view, offset + 12, DOS_DATE)
    writeUint32(view, offset + 14, entry.crc32)
    writeUint32(view, offset + 18, entry.data.byteLength)
    writeUint32(view, offset + 22, entry.data.byteLength)
    writeUint16(view, offset + 26, entry.nameBytes.byteLength)
    writeUint16(view, offset + 28, 0)
    archive.set(entry.nameBytes, offset + LOCAL_HEADER_BYTES)
    archive.set(entry.data, offset + LOCAL_HEADER_BYTES + entry.nameBytes.byteLength)
    offset += LOCAL_HEADER_BYTES + entry.nameBytes.byteLength + entry.data.byteLength
  }

  for (const entry of preparedEntries) {
    writeUint32(view, offset, 0x02014b50)
    writeUint16(view, offset + 4, 20)
    writeUint16(view, offset + 6, 20)
    writeUint16(view, offset + 8, 0)
    writeUint16(view, offset + 10, 0)
    writeUint16(view, offset + 12, DOS_TIME)
    writeUint16(view, offset + 14, DOS_DATE)
    writeUint32(view, offset + 16, entry.crc32)
    writeUint32(view, offset + 20, entry.data.byteLength)
    writeUint32(view, offset + 24, entry.data.byteLength)
    writeUint16(view, offset + 28, entry.nameBytes.byteLength)
    writeUint16(view, offset + 30, 0)
    writeUint16(view, offset + 32, 0)
    writeUint16(view, offset + 34, 0)
    writeUint16(view, offset + 36, 0)
    writeUint32(view, offset + 38, 0)
    writeUint32(view, offset + 42, entry.localHeaderOffset)
    archive.set(entry.nameBytes, offset + CENTRAL_HEADER_BYTES)
    offset += CENTRAL_HEADER_BYTES + entry.nameBytes.byteLength
  }

  writeUint32(view, offset, 0x06054b50)
  writeUint16(view, offset + 4, 0)
  writeUint16(view, offset + 6, 0)
  writeUint16(view, offset + 8, preparedEntries.length)
  writeUint16(view, offset + 10, preparedEntries.length)
  writeUint32(view, offset + 12, centralBytes)
  writeUint32(view, offset + 16, centralOffset)
  writeUint16(view, offset + 20, 0)

  return new Blob([archive], { type: "application/zip" })
}
