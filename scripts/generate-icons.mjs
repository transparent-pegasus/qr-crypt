import { Buffer } from "node:buffer"
import { mkdirSync, writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const BACKGROUND = [0x0f, 0x17, 0x2a, 0xff]
const FOREGROUND = [0xff, 0xff, 0xff, 0xff]
const MODULE_COUNT = 21
const GLYPH_RATIO = 0.6

const DATA_MODULES = [
  [8, 8],
  [10, 8],
  [12, 8],
  [15, 8],
  [17, 8],
  [18, 8],
  [20, 8],
  [9, 9],
  [11, 9],
  [14, 9],
  [16, 9],
  [19, 9],
  [8, 10],
  [9, 10],
  [11, 10],
  [12, 10],
  [15, 10],
  [16, 10],
  [18, 10],
  [20, 10],
  [10, 11],
  [14, 11],
  [17, 11],
  [19, 11],
  [20, 11],
  [8, 12],
  [10, 12],
  [11, 12],
  [12, 12],
  [15, 12],
  [18, 12],
  [8, 14],
  [9, 14],
  [12, 14],
  [14, 14],
  [16, 14],
  [17, 14],
  [20, 14],
  [10, 15],
  [11, 15],
  [15, 15],
  [18, 15],
  [19, 15],
  [8, 16],
  [12, 16],
  [14, 16],
  [15, 16],
  [17, 16],
  [20, 16],
  [9, 17],
  [10, 17],
  [11, 17],
  [16, 17],
  [18, 17],
  [8, 18],
  [12, 18],
  [14, 18],
  [17, 18],
  [19, 18],
  [20, 18],
  [9, 19],
  [11, 19],
  [15, 19],
  [16, 19],
  [18, 19],
  [8, 20],
  [10, 20],
  [12, 20],
  [14, 20],
  [16, 20],
  [19, 20],
]

const OUTPUTS = [
  { path: "public/icons/icon-192.png", size: 192, solid: false },
  { path: "public/icons/icon-512.png", size: 512, solid: false },
  { path: "public/icons/maskable-512.png", size: 512, solid: true },
  {
    path: "public/icons/apple-touch-icon-180.png",
    size: 180,
    solid: true,
  },
]

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

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii")
  const chunk = Buffer.alloc(12 + data.length)

  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)

  return chunk
}

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowBytes = width * 4
  const scanlines = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1)
    scanlines[scanlineOffset] = 0
    pixels.copy(scanlines, scanlineOffset + 1, y * rowBytes, (y + 1) * rowBytes)
  }

  const compressed = deflateSync(scanlines, { level: 9 })
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ])
}

function buildGlyph() {
  const modules = Array.from({ length: MODULE_COUNT }, () =>
    Array(MODULE_COUNT).fill(false),
  )

  const addFinder = (left, top) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const border = x === 0 || x === 6 || y === 0 || y === 6
        const center = x >= 2 && x <= 4 && y >= 2 && y <= 4
        modules[top + y][left + x] = border || center
      }
    }
  }

  addFinder(0, 0)
  addFinder(14, 0)
  addFinder(0, 14)

  for (const [x, y] of DATA_MODULES) {
    modules[y][x] = true
  }

  return modules
}

function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4
  pixels[offset] = color[0]
  pixels[offset + 1] = color[1]
  pixels[offset + 2] = color[2]
  pixels[offset + 3] = color[3]
}

function isInsideRoundedSquare(x, y, size, radius) {
  const pixelX = x + 0.5
  const pixelY = y + 0.5
  const nearX = pixelX < radius ? radius : size - radius
  const nearY = pixelY < radius ? radius : size - radius

  if (
    (pixelX >= radius && pixelX <= size - radius) ||
    (pixelY >= radius && pixelY <= size - radius)
  ) {
    return true
  }

  const deltaX = pixelX - nearX
  const deltaY = pixelY - nearY
  return deltaX * deltaX + deltaY * deltaY <= radius * radius
}

function renderIcon(size, solidBackground, modules) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = Math.round(size * 0.22)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (solidBackground || isInsideRoundedSquare(x, y, size, radius)) {
        setPixel(pixels, size, x, y, BACKGROUND)
      }
    }
  }

  const glyphSize = Math.round(size * GLYPH_RATIO)
  const glyphStart = Math.floor((size - glyphSize) / 2)

  for (let moduleY = 0; moduleY < MODULE_COUNT; moduleY += 1) {
    for (let moduleX = 0; moduleX < MODULE_COUNT; moduleX += 1) {
      if (!modules[moduleY][moduleX]) continue

      const xStart = glyphStart + Math.floor((moduleX * glyphSize) / MODULE_COUNT)
      const xEnd = glyphStart + Math.floor(((moduleX + 1) * glyphSize) / MODULE_COUNT)
      const yStart = glyphStart + Math.floor((moduleY * glyphSize) / MODULE_COUNT)
      const yEnd = glyphStart + Math.floor(((moduleY + 1) * glyphSize) / MODULE_COUNT)

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          setPixel(pixels, size, x, y, FOREGROUND)
        }
      }
    }
  }

  return pixels
}

function buildFaviconSvg(modules) {
  const glyphRects = []

  for (let y = 0; y < MODULE_COUNT; y += 1) {
    let x = 0
    while (x < MODULE_COUNT) {
      if (!modules[y][x]) {
        x += 1
        continue
      }

      const start = x
      while (x < MODULE_COUNT && modules[y][x]) x += 1
      glyphRects.push(
        `    <rect x="${start}" y="${y}" width="${x - start}" height="1" />`,
      )
    }
  }

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '  <rect width="100" height="100" rx="22" fill="#0F172A" />',
    '  <g fill="#FFFFFF" transform="translate(20 20) scale(2.857142857142857)">',
    ...glyphRects,
    "  </g>",
    "</svg>",
    "",
  ].join("\n")
}

mkdirSync("public/icons", { recursive: true })
const modules = buildGlyph()

for (const output of OUTPUTS) {
  const pixels = renderIcon(output.size, output.solid, modules)
  const png = encodePng(output.size, output.size, pixels)
  writeFileSync(output.path, png)
  console.log(`WROTE ${output.path} ${png.length} bytes`)
}

const favicon = buildFaviconSvg(modules)
writeFileSync("public/favicon.svg", favicon, "utf8")
console.log(`WROTE public/favicon.svg ${Buffer.byteLength(favicon)} bytes`)
