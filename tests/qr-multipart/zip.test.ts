import { describe, expect, it } from "vitest"
import { storeOnlyZip } from "@/lib/best-effort-zip"

const decoder = new TextDecoder()
const encoder = new TextEncoder()

interface EndRecord {
  entries: number
  centralSize: number
  centralOffset: number
}

interface LocalRecord {
  offset: number
  name: string
  crc32: number
  compressedSize: number
  uncompressedSize: number
  method: number
  time: number
  date: number
  data: Uint8Array
}

interface CentralRecord {
  offset: number
  name: string
  crc32: number
  localOffset: number
  method: number
  time: number
  date: number
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

async function zipBytes(
  entries: Parameters<typeof storeOnlyZip>[0],
): Promise<Uint8Array> {
  return new Uint8Array(await storeOnlyZip(entries).arrayBuffer())
}

function endRecord(bytes: Uint8Array): EndRecord {
  const view = viewOf(bytes)
  const offset = bytes.byteLength - 22
  expect(u32(view, offset)).toBe(0x06054b50)
  expect(u16(view, offset + 4)).toBe(0)
  expect(u16(view, offset + 6)).toBe(0)
  expect(u16(view, offset + 20)).toBe(0)
  return {
    entries: u16(view, offset + 10),
    centralSize: u32(view, offset + 12),
    centralOffset: u32(view, offset + 16),
  }
}

function localRecords(bytes: Uint8Array, centralOffset: number): LocalRecord[] {
  const view = viewOf(bytes)
  const records: LocalRecord[] = []
  let offset = 0
  while (offset < centralOffset) {
    expect(u32(view, offset)).toBe(0x04034b50)
    const compressedSize = u32(view, offset + 18)
    const nameLength = u16(view, offset + 26)
    const extraLength = u16(view, offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    records.push({
      offset,
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      crc32: u32(view, offset + 14),
      compressedSize,
      uncompressedSize: u32(view, offset + 22),
      method: u16(view, offset + 8),
      time: u16(view, offset + 10),
      date: u16(view, offset + 12),
      data: bytes.slice(dataStart, dataStart + compressedSize),
    })
    offset = dataStart + compressedSize
  }
  expect(offset).toBe(centralOffset)
  return records
}

function centralRecords(bytes: Uint8Array, end: EndRecord): CentralRecord[] {
  const view = viewOf(bytes)
  const records: CentralRecord[] = []
  let offset = end.centralOffset
  const centralEnd = end.centralOffset + end.centralSize
  while (offset < centralEnd) {
    expect(u32(view, offset)).toBe(0x02014b50)
    const nameLength = u16(view, offset + 28)
    const extraLength = u16(view, offset + 30)
    const commentLength = u16(view, offset + 32)
    records.push({
      offset,
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      crc32: u32(view, offset + 16),
      localOffset: u32(view, offset + 42),
      method: u16(view, offset + 10),
      time: u16(view, offset + 12),
      date: u16(view, offset + 14),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  expect(offset).toBe(centralEnd)
  return records
}

describe("storeOnlyZip", () => {
  it("writes the known CRC32 for 123456789", async () => {
    const data = encoder.encode("123456789")
    const blob = storeOnlyZip([{ name: "known.txt", data }])
    expect(blob.type).toBe("application/zip")
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const end = endRecord(bytes)
    const [local] = localRecords(bytes, end.centralOffset)
    const [central] = centralRecords(bytes, end)

    expect(local?.crc32).toBe(0xcbf43926)
    expect(central?.crc32).toBe(0xcbf43926)
    expect(local?.method).toBe(0)
    expect(local?.compressedSize).toBe(data.byteLength)
    expect(local?.uncompressedSize).toBe(data.byteLength)
    expect(local?.data).toEqual(data)
  })

  it("writes valid local-to-central offsets for multiple entries", async () => {
    const bytes = await zipBytes([
      { name: "frames/frame-001.png", data: Uint8Array.of(1, 2, 3) },
      { name: "frames/frame-002.png", data: Uint8Array.of(4, 5) },
    ])
    const end = endRecord(bytes)
    const locals = localRecords(bytes, end.centralOffset)
    const centrals = centralRecords(bytes, end)

    expect(end.entries).toBe(2)
    expect(end.centralOffset + end.centralSize).toBe(bytes.byteLength - 22)
    expect(centrals.map((entry) => entry.localOffset)).toEqual(
      locals.map((entry) => entry.offset),
    )
    expect(centrals.map((entry) => entry.name)).toEqual(locals.map((entry) => entry.name))
    expect(centrals.map((entry) => entry.method)).toEqual([0, 0])
  })

  it("uses the fixed 1980-01-01 00:00 DOS timestamp", async () => {
    const bytes = await zipBytes([{ name: "frame.png", data: Uint8Array.of(1) }])
    const end = endRecord(bytes)
    const [local] = localRecords(bytes, end.centralOffset)
    const [central] = centralRecords(bytes, end)
    expect([local?.time, local?.date]).toEqual([0, 0x21])
    expect([central?.time, central?.date]).toEqual([0, 0x21])
  })

  it("is byte-for-byte deterministic", async () => {
    const entries = [
      { name: "a.txt", data: encoder.encode("alpha") },
      { name: "nested/b.bin", data: Uint8Array.of(0, 255) },
    ]
    expect(await zipBytes(entries)).toEqual(await zipBytes(entries))
  })

  it("creates a valid empty archive", async () => {
    const bytes = await zipBytes([])
    const end = endRecord(bytes)
    expect(bytes).toHaveLength(22)
    expect(end).toEqual({ entries: 0, centralSize: 0, centralOffset: 0 })
  })

  it("accepts the maximum 128 internally generated names", async () => {
    const entries = Array.from({ length: 128 }, (_, index) => ({
      name: `frame-${String(index).padStart(3, "0")}.png`,
      data: new Uint8Array(),
    }))
    const bytes = await zipBytes(entries)
    expect(endRecord(bytes).entries).toBe(128)
  })

  it.each([
    "",
    "../escape",
    "dir/../escape",
    "/absolute",
    "trailing/",
    "double//slash",
    "C:/drive",
    "back\\slash",
    "日本語.txt",
    "nul\0name",
    ".",
  ])("rejects the unsafe or non-ASCII name %j", (name) => {
    expect(() => storeOnlyZip([{ name, data: new Uint8Array() }])).toThrow(
      "ZIP_ENTRY_NAME_INVALID",
    )
  })

  it("rejects names beyond the ZIP16 name field", () => {
    expect(() =>
      storeOnlyZip([{ name: "a".repeat(65_536), data: new Uint8Array() }]),
    ).toThrow("ZIP_ENTRY_NAME_INVALID")
  })

  it("rejects more than 128 entries", () => {
    const entries = Array.from({ length: 129 }, (_, index) => ({
      name: `${index}.bin`,
      data: new Uint8Array(),
    }))
    expect(() => storeOnlyZip(entries)).toThrow("ZIP_ENTRY_LIMIT_EXCEEDED")
  })

  it("rejects a total payload over 256 MiB before copying data", () => {
    const shared = new Uint8Array(2 * 1024 * 1024 + 1)
    const entries = Array.from({ length: 128 }, (_, index) => ({
      name: `${index}.bin`,
      data: shared,
    }))
    expect(() => storeOnlyZip(entries)).toThrow("ZIP_TOTAL_SIZE_LIMIT_EXCEEDED")
  })

  it("rejects non-Uint8Array entry data", () => {
    expect(() =>
      storeOnlyZip([{ name: "bad.bin", data: [1, 2, 3] as unknown as Uint8Array }]),
    ).toThrow("ZIP_ENTRY_DATA_INVALID")
  })
})
