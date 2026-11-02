import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { build, defineConfig, type Plugin } from "vite"
import { buildAboutLocales, renderAboutLocales } from "./scripts/build-about-locales.mjs"
import {
  deploymentPolicyFromHeaders,
  metaCspFromHeaders,
} from "./scripts/csp-from-headers.mjs"
import { precacheManifest } from "./scripts/precache-manifest.mjs"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

const ABOUT_DIR = fileURLToPath(new URL("./public/about", import.meta.url))

/**
 * The landing page is one document per language: /about/ is English and every
 * other language is /about/<code>/, written from index.html and messages.js.
 * Serving each language from its own address is what lets a shared link carry
 * that language's card, which a crawler could never get from a switcher.
 */
function aboutLocales(): Plugin {
  let outDir = "dist"
  return {
    name: "about-locales",
    configResolved(config) {
      outDir = config.build.outDir
    },
    // After writeBundle, so the copied public/ tree is already in place.
    async closeBundle() {
      await buildAboutLocales({ aboutDir: ABOUT_DIR, outDir: join(outDir, "about") })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? ""
        const match = /^\/about\/([a-z-]+)\/(?:index\.html)?$/.exec(path)
        if (!match) return next()
        // Rendered per request rather than cached: an edit to messages.js or to
        // index.html should show up on reload like every other source file.
        renderAboutLocales({ aboutDir: ABOUT_DIR })
          .then((pages) => {
            const page = pages.find(({ code }) => code === match[1])
            if (!page) return next()
            res.setHeader("Content-Type", "text/html; charset=utf-8")
            res.end(page.html)
          })
          .catch(next)
      })
    },
  }
}

/**
 * The deployed CSP lives in public/_headers, which only Cloudflare Pages reads.
 * A production build therefore also carries the same policy as a meta tag, so a
 * self-hosted copy of the release ZIP is not silently left with no CSP at all.
 * Build only: the dev server needs the inline scripts React Refresh injects.
 */
function metaCsp(): Plugin {
  return {
    name: "meta-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const headers = readFileSync(
          fileURLToPath(new URL("./public/_headers", import.meta.url)),
          "utf8",
        )
        // Throws when _headers declares no CSP for /*, failing the build rather
        // than shipping a page with no fallback policy.
        const content = metaCspFromHeaders(headers)
        return {
          html,
          tags: [
            {
              tag: "meta",
              attrs: { "http-equiv": "Content-Security-Policy", content },
              injectTo: "head-prepend",
            },
          ],
        }
      },
    },
  }
}

function serviceWorker(): Plugin {
  let outDir = "dist"
  return {
    name: "service-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        const manifest = precacheManifest(outDir)
        await build({
          configFile: false,
          publicDir: false,
          logLevel: "warn",
          define: {
            "process.env.NODE_ENV": JSON.stringify("production"),
            __PRECACHE_MANIFEST__: JSON.stringify(manifest),
          },
          build: {
            outDir,
            emptyOutDir: false,
            copyPublicDir: false,
            minify: false,
            sourcemap: false,
            write: true,
            rolldownOptions: {
              input: fileURLToPath(
                new URL("./src/sw/service-worker.ts", import.meta.url),
              ),
              output: {
                format: "iife",
                entryFileNames: "sw.js",
                codeSplitting: false,
              },
            },
          },
        })
      },
    },
  }
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      aboutLocales(),
      metaCsp(),
      serviceWorker(),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEPLOYMENT_HEADER_POLICY__: JSON.stringify(
        deploymentPolicyFromHeaders(
          readFileSync(new URL("./public/_headers", import.meta.url), "utf8"),
        ),
      ),
    },
  }
})
