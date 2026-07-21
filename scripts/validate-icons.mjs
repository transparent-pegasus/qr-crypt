import { Buffer } from "node:buffer"
import { existsSync, readFileSync } from "node:fs"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const EXPECTED_PNGS = [
  { path: "public/icons/icon-192.png", width: 192, height: 192 },
  { path: "public/icons/icon-512.png", width: 512, height: 512 },
  { path: "public/icons/maskable-512.png", width: 512, height: 512 },
  {
    path: "public/icons/apple-touch-icon-180.png",
    width: 180,
    height: 180,
  },
]

function fail(message) {
  throw new Error(message)
}

function crc32(buffer) {
  let crc = 0xffffffff

  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

function validatePng(expected) {
  const file = readFileSync(expected.path)

  if (
    file.length < PNG_SIGNATURE.length ||
    !file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    fail(`${expected.path}: invalid PNG signature`)
  }

  let offset = PNG_SIGNATURE.length
  let chunkIndex = 0
  let ihdr = null
  let sawIdat = false
  let sawIend = false

  while (offset < file.length) {
    if (file.length - offset < 12) {
      fail(`${expected.path}: truncated chunk at byte ${offset}`)
    }

    const length = file.readUInt32BE(offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4

    if (chunkEnd > file.length) {
      fail(`${expected.path}: chunk at byte ${offset} exceeds file length`)
    }

    const typeBytes = file.subarray(offset + 4, offset + 8)
    const type = typeBytes.toString("ascii")
    if (!/^[A-Za-z]{4}$/.test(type)) {
      fail(`${expected.path}: invalid chunk type at byte ${offset}`)
    }

    const storedCrc = file.readUInt32BE(dataEnd)
    const actualCrc = crc32(file.subarray(offset + 4, dataEnd))
    if (storedCrc !== actualCrc) {
      fail(
        `${expected.path}: ${type} CRC mismatch ` +
          `(stored ${storedCrc.toString(16).padStart(8, "0")}, ` +
          `actual ${actualCrc.toString(16).padStart(8, "0")})`,
      )
    }

    if (chunkIndex === 0 && type !== "IHDR") {
      fail(`${expected.path}: first chunk is ${type}, not IHDR`)
    }

    if (type === "IHDR") {
      if (ihdr !== null || length !== 13) {
        fail(`${expected.path}: invalid IHDR chunk`)
      }
      ihdr = file.subarray(dataStart, dataEnd)
    } else if (type === "IDAT") {
      sawIdat = true
    } else if (type === "IEND") {
      if (length !== 0) fail(`${expected.path}: IEND must be empty`)
      if (chunkEnd !== file.length) {
        fail(`${expected.path}: data found after IEND`)
      }
      sawIend = true
    }

    offset = chunkEnd
    chunkIndex += 1
  }

  if (ihdr === null) fail(`${expected.path}: missing IHDR`)
  if (!sawIdat) fail(`${expected.path}: missing IDAT`)
  if (!sawIend) fail(`${expected.path}: missing IEND`)

  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]

  if (width !== expected.width || height !== expected.height) {
    fail(
      `${expected.path}: expected ${expected.width}x${expected.height}, ` +
        `got ${width}x${height}`,
    )
  }
  if (bitDepth !== 8 || colorType !== 6) {
    fail(
      `${expected.path}: expected RGBA8 (depth 8, type 6), ` +
        `got depth ${bitDepth}, type ${colorType}`,
    )
  }
  if (ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) {
    fail(`${expected.path}: unsupported PNG compression, filter, or interlace`)
  }

  return { path: expected.path, width, height }
}

function publicFileForReference(reference, sourceFile) {
  const withoutSuffix = reference.split(/[?#]/, 1)[0]
  if (!withoutSuffix.startsWith("/") || withoutSuffix.includes("..")) {
    fail(`${sourceFile}: invalid public asset reference ${reference}`)
  }
  return `public${withoutSuffix}`
}

function validateManifestReferences() {
  const sourceFile = "vite.config.ts"
  const source = readFileSync(sourceFile, "utf8")
  const iconsMatch = source.match(/\bicons\s*:\s*\[([\s\S]*?)\]/)
  if (iconsMatch === null) fail(`${sourceFile}: manifest icons array not found`)

  const references = Array.from(
    iconsMatch[1].matchAll(/\bsrc\s*:\s*["']([^"']+)["']/g),
    (match) => match[1],
  )
  if (references.length === 0) fail(`${sourceFile}: manifest has no icons`)

  for (const reference of references) {
    const assetPath = publicFileForReference(reference, sourceFile)
    if (!existsSync(assetPath)) {
      fail(`${sourceFile}: referenced icon does not exist: ${assetPath}`)
    }
  }
}

function validateAppleTouchReference() {
  const sourceFile = "index.html"
  const source = readFileSync(sourceFile, "utf8")
  const linkTags = source.match(/<link\b[^>]*>/gi) ?? []
  const appleTag = linkTags.find((tag) =>
    /\brel\s*=\s*["']apple-touch-icon["']/i.test(tag),
  )
  if (appleTag === undefined) {
    fail(`${sourceFile}: apple-touch-icon link not found`)
  }

  const hrefMatch = appleTag.match(/\bhref\s*=\s*["']([^"']+)["']/i)
  if (hrefMatch === null) fail(`${sourceFile}: apple-touch-icon has no href`)

  const assetPath = publicFileForReference(hrefMatch[1], sourceFile)
  if (!existsSync(assetPath)) {
    fail(`${sourceFile}: referenced apple-touch icon does not exist: ${assetPath}`)
  }
}

function main() {
  const validated = EXPECTED_PNGS.map(validatePng)
  validateManifestReferences()
  validateAppleTouchReference()

  for (const result of validated) {
    console.log(`OK ${result.path} ${result.width}x${result.height}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
