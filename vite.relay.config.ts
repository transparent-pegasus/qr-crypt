import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { Plugin, UserConfig } from "vite"
import { metaCspFromHeaders } from "./scripts/csp-from-headers.mjs"
import {
  findRelayBundleViolations,
  findRelayOutputViolations,
} from "./scripts/relay-bundle-allowlist.mjs"

const repoRoot = fileURLToPath(new URL(".", import.meta.url))
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

function metaCsp(): Plugin {
  return {
    name: "meta-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: metaCspFromHeaders(
                readFileSync(new URL("./public/_headers", import.meta.url), "utf8"),
              ),
            },
            injectTo: "head-prepend",
          },
        ]
      },
    },
  }
}

export function relayAllowlistPlugin(): Plugin {
  return {
    name: "relay-allowlist",
    enforce: "post",
    generateBundle(_, bundle) {
      const files = Object.values(bundle).map((entry) => ({
        fileName: entry.fileName,
        text:
          entry.type === "chunk"
            ? entry.code
            : typeof entry.source === "string"
              ? entry.source
              : "",
      }))
      const violations = [
        ...findRelayBundleViolations([...this.getModuleIds()], repoRoot),
        ...findRelayOutputViolations(files),
      ]
      if (violations.length > 0) {
        this.error("relay bundle allowlist violations:\n" + violations.join("\n"))
      }
    },
  }
}

export function relayWorkerBan(): Plugin {
  return {
    name: "relay-worker-ban",
    buildStart() {
      this.error("relay bundle must not build workers")
    },
  }
}

export function relayViteConfig(
  options: { root?: string; outDir?: string } = {},
): UserConfig {
  return {
    root: options.root ?? fileURLToPath(new URL("./src/relay", import.meta.url)),
    envDir: repoRoot,
    publicDir: false,
    plugins: [react(), tailwindcss(), metaCsp(), relayAllowlistPlugin()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      outDir: options.outDir ?? fileURLToPath(new URL("./dist-relay", import.meta.url)),
      emptyOutDir: true,
    },
    worker: { plugins: () => [relayWorkerBan()] },
  }
}

export default relayViteConfig()
