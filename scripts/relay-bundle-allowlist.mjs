import { posix } from "node:path"

// Task 4 replaces this seed inventory with the measured relay build graph.
export const RELAY_ALLOWED_SOURCES = Object.freeze([
  "src/relay/index.html",
  "src/components/online-relay.tsx",
  "src/styles/globals.css",
])

export const RELAY_ALLOWED_PACKAGES = Object.freeze([
  "@radix-ui/react-dialog",
  "react",
  "zxing-wasm",
])

export const RELAY_ALLOWED_VIRTUAL_IDS = Object.freeze([
  "\0rolldown/runtime.js",
  "\0vite/preload-helper.js",
])

export const RELAY_ALLOWED_QUERY_IMPORTS = Object.freeze([
  Object.freeze({ path: "zxing-wasm/reader/zxing_reader.wasm", query: "url" }),
])

export const RELAY_ALLOWED_OUTPUT = Object.freeze([
  "index.html",
  "assets/*.js",
  "assets/*.css",
  "assets/zxing_reader-*.wasm",
])

export const RELAY_ALLOWED_URL_ORIGINS = Object.freeze([])

function packageImportPath(path) {
  const segments = path.split("/")
  const index = segments.lastIndexOf("node_modules")
  return index === -1 ? undefined : segments.slice(index + 1).join("/")
}

export function findRelayBundleViolations(moduleIds, repoRoot) {
  const normalizedRoot = posix.normalize(repoRoot.replaceAll("\\", "/"))
  const root = normalizedRoot.endsWith("/") ? normalizedRoot : normalizedRoot + "/"
  const driveRoot = /^[a-z]:\//i.test(root)
  const rootPrefix = driveRoot ? root.toLowerCase() : root

  return Array.from(moduleIds)
    .filter((id) => {
      const normalizedId = id.replaceAll("\\", "/")
      if (id.startsWith("\0")) return !RELAY_ALLOWED_VIRTUAL_IDS.includes(id)
      if (normalizedId.startsWith("virtual:")) return true

      const queryIndex = normalizedId.indexOf("?")
      const path = queryIndex === -1 ? normalizedId : normalizedId.slice(0, queryIndex)
      const query = queryIndex === -1 ? undefined : normalizedId.slice(queryIndex + 1)
      if (
        query !== undefined &&
        !RELAY_ALLOWED_QUERY_IMPORTS.some((entry) => entry.query === query)
      ) {
        return true
      }

      const filePath = posix.normalize(path)
      if (!/^(?:\/|[a-z]:\/)/i.test(filePath)) return true
      const comparedPath = driveRoot ? filePath.toLowerCase() : filePath
      if (!comparedPath.startsWith(rootPrefix)) return true

      const relativePath = filePath.slice(root.length)
      const importPath = packageImportPath(relativePath)
      if (
        query !== undefined &&
        !RELAY_ALLOWED_QUERY_IMPORTS.some(
          (entry) => entry.path === importPath && entry.query === query,
        )
      ) {
        return true
      }

      if (importPath !== undefined) {
        const segments = importPath.split("/")
        const name = segments[0].startsWith("@")
          ? segments.slice(0, 2).join("/")
          : segments[0]
        return !RELAY_ALLOWED_PACKAGES.includes(name)
      }
      return !RELAY_ALLOWED_SOURCES.includes(relativePath)
    })
    .sort()
}

export function findRelayOutputViolations(files) {
  const violations = new Set()
  for (const { fileName, text } of files) {
    const allowed =
      !fileName.includes("\\") &&
      RELAY_ALLOWED_OUTPUT.some((pattern) => {
        const [prefix, suffix] = pattern.split("*")
        if (suffix === undefined) return fileName === prefix
        return (
          fileName.startsWith(prefix) &&
          fileName.endsWith(suffix) &&
          !fileName.slice(prefix.length, -suffix.length).includes("/")
        )
      })
    if (!allowed) violations.add(fileName)

    for (const match of (text ?? "").matchAll(/https?:\/\/[^\s"'`<>\\]+/gi)) {
      let origin
      try {
        origin = new URL(match[0]).origin
      } catch {
        origin = match[0]
      }
      if (!RELAY_ALLOWED_URL_ORIGINS.some((entry) => entry.origin === origin)) {
        violations.add("url:" + origin + " in " + fileName)
      }
    }
  }
  return Array.from(violations).sort()
}
