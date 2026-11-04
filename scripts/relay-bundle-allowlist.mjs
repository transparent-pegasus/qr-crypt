import { posix } from "node:path"

// Measured with the standalone relay build; dependency changes require review.
export const RELAY_ALLOWED_SOURCES = Object.freeze([
  "src/app/feature-support.tsx",
  "src/components/animated-qr-frames.tsx",
  "src/components/online-relay.tsx",
  "src/components/qr-display.tsx",
  "src/components/ui/alert.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/card.tsx",
  "src/components/ui/dialog.tsx",
  "src/components/ui/label.tsx",
  "src/components/ui/select.tsx",
  "src/components/ui/switch.tsx",
  "src/components/ui/textarea.tsx",
  "src/crypto/errors.ts",
  "src/crypto/pq/canonical-cbor.ts",
  "src/crypto/pq/profiles.ts",
  "src/crypto/pq/suites.ts",
  "src/crypto/pq/validation.ts",
  "src/crypto/random.ts",
  "src/features/presentation.ts",
  "src/hooks/use-qr-reader-readiness.ts",
  "src/i18n/catalog-en.ts",
  "src/i18n/catalog-ja.ts",
  "src/i18n/index.tsx",
  "src/i18n/interpolate.ts",
  "src/i18n/messages.ts",
  "src/lib/base64url.ts",
  "src/lib/best-effort-zip.ts",
  "src/lib/bytes.ts",
  "src/lib/clipboard.ts",
  "src/lib/feature-detect.ts",
  "src/lib/frame-bytes.ts",
  "src/lib/frame-interval.ts",
  "src/lib/limits.ts",
  "src/lib/local-storage-events.ts",
  "src/lib/reload.ts",
  "src/lib/utils.ts",
  "src/qr/camera-scan.ts",
  "src/qr/camera/acquire.ts",
  "src/qr/camera/attempt-registry.ts",
  "src/qr/camera/diagnostics.ts",
  "src/qr/camera/frame-pump.ts",
  "src/qr/camera/reader-module.ts",
  "src/qr/camera/types.ts",
  "src/qr/encode.ts",
  "src/qr/export-frames.ts",
  "src/qr/export-image.ts",
  "src/qr/multipart/transfer-state.ts",
  "src/qr/relay-frames.ts",
  "src/qr/relay-playback.ts",
  "src/qr/wire-codec.ts",
  "src/relay/index.html",
  "src/relay/local-session.ts",
  "src/relay/main.tsx",
  "src/relay/relay-app.tsx",
  "src/relay/system-theme.ts",
  "src/schemas/domain.ts",
  "src/schemas/env-schema.ts",
  "src/styles/globals.css",
])

export const RELAY_ALLOWED_PACKAGES = Object.freeze([
  "@floating-ui/core",
  "@floating-ui/dom",
  "@floating-ui/react-dom",
  "@floating-ui/utils",
  "@radix-ui/number",
  "@radix-ui/primitive",
  "@radix-ui/react-arrow",
  "@radix-ui/react-collection",
  "@radix-ui/react-compose-refs",
  "@radix-ui/react-context",
  "@radix-ui/react-dialog",
  "@radix-ui/react-direction",
  "@radix-ui/react-dismissable-layer",
  "@radix-ui/react-focus-guards",
  "@radix-ui/react-focus-scope",
  "@radix-ui/react-id",
  "@radix-ui/react-label",
  "@radix-ui/react-popper",
  "@radix-ui/react-portal",
  "@radix-ui/react-presence",
  "@radix-ui/react-primitive",
  "@radix-ui/react-select",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-use-callback-ref",
  "@radix-ui/react-use-controllable-state",
  "@radix-ui/react-use-effect-event",
  "@radix-ui/react-use-layout-effect",
  "@radix-ui/react-use-previous",
  "@radix-ui/react-use-size",
  "@radix-ui/react-visually-hidden",
  "aria-hidden",
  "class-variance-authority",
  "clsx",
  "detect-node-es",
  "dijkstrajs",
  "get-nonce",
  "lucide-react",
  "qrcode",
  "react",
  "react-dom",
  "react-remove-scroll",
  "react-remove-scroll-bar",
  "react-style-singleton",
  "scheduler",
  "tailwind-merge",
  "tslib",
  "use-callback-ref",
  "use-sidecar",
  "zod",
  "zxing-wasm",
])

export const RELAY_ALLOWED_VIRTUAL_IDS = Object.freeze([
  "\0rolldown/runtime.js",
  "\0vite/modulepreload-polyfill.js",
  "\0vite/preload-helper.js",
])

export const RELAY_ALLOWED_QUERY_IMPORTS = Object.freeze([
  Object.freeze({ path: "zxing-wasm/dist/reader/zxing_reader.wasm", query: "url" }),
])

export const RELAY_ALLOWED_OUTPUT = Object.freeze([
  "index.html",
  "assets/*.js",
  "assets/*.css",
  "assets/zxing_reader-*.wasm",
])

export const RELAY_ALLOWED_URL_ORIGINS = Object.freeze([
  Object.freeze({
    origin: "http://json-schema.org",
    reason: "Zod's JSON Schema draft identifiers are metadata strings, never fetched.",
  }),
  Object.freeze({
    origin: "http://www.w3.org",
    reason:
      "React and icons use XML, SVG and MathML namespace identifiers, which do not load resources.",
  }),
  Object.freeze({
    origin: "https://json-schema.org",
    reason: "Zod's JSON Schema draft identifier is metadata, never fetched.",
  }),
  Object.freeze({
    origin: "https://react.dev",
    reason:
      "React's production error formatter puts documentation links in error messages, never a resource loader.",
  }),
  Object.freeze({
    origin: "https://tailwindcss.com",
    reason: "Tailwind's license comment contains this URL as inert CSS comment text.",
  }),
])

export const RELAY_ALLOWED_URL_TEMPLATES = Object.freeze([
  Object.freeze({
    template: "http://[${}]",
    reason:
      "zod's IPv6 validation builds this string to test a host; it is never fetched, and the CSP blocks any external connection",
  }),
  Object.freeze({
    template: "https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/${}/${}",
    reason:
      "ZXing's default WASM locator is replaced by reader-module.ts with the bundled same-origin asset before preparation or decoding; the ready gate prevents use after failure, and the CSP's connect-src 'self' blocks external connections.",
  }),
])

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

    // Only contiguous http(s):// literals: no concatenation, escaped slashes,
    // protocol-relative URLs or ws(s):. The module allowlist and CSP are primary gates.
    for (const match of (text ?? "").matchAll(
      /https?:\/\/(?:\$\{[^}]*\}|[^\s"'`()<>\\])+/gi,
    )) {
      if (match[0].includes("${")) {
        const template = match[0].replace(/\$\{[^}]*\}/g, "${}")
        if (!RELAY_ALLOWED_URL_TEMPLATES.some((entry) => entry.template === template)) {
          violations.add("url:" + template + " in " + fileName)
        }
        continue
      }
      try {
        const { hostname, origin } = new URL(match[0])
        if (
          !hostname ||
          !RELAY_ALLOWED_URL_ORIGINS.some((entry) => entry.origin === origin)
        ) {
          violations.add("url:" + origin + " in " + fileName)
        }
      } catch {
        violations.add("url:" + match[0] + " in " + fileName)
      }
    }
  }
  return Array.from(violations).sort()
}
