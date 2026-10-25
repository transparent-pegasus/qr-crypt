import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import {
  deploymentPolicyFromHeaders,
  metaCspFromHeaders,
} from "../../../scripts/csp-from-headers.mjs"

const repo = new URL("../../../", import.meta.url)
const headers = readFileSync(new URL("public/_headers", repo), "utf8")
const pkg = JSON.parse(readFileSync(new URL("package.json", repo), "utf8"))

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: fileURLToPath(repo),
  publicDir: false,
  resolve: { alias: { "@": fileURLToPath(new URL("src", repo)) } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEPLOYMENT_HEADER_POLICY__: JSON.stringify(deploymentPolicyFromHeaders(headers)),
  },
  plugins: [
    {
      name: "production-meta-csp",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => ({
          html,
          tags: [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: metaCspFromHeaders(headers),
              },
              injectTo: "head-prepend",
            },
          ],
        }),
      },
    },
  ],
  build: { outDir: "../dist", emptyOutDir: true, assetsInlineLimit: 0, target: "es2022" },
})
