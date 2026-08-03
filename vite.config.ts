import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { buildAboutLocales, renderAboutLocales } from "./scripts/build-about-locales.mjs"
import {
  deploymentPolicyFromHeaders,
  metaCspFromHeaders,
} from "./scripts/csp-from-headers.mjs"

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

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      aboutLocales(),
      metaCsp(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon.svg", "icons/apple-touch-icon-180.png"],
        manifest: {
          name: "QR Crypt",
          short_name: "QR Crypt",
          description:
            "Offline encryption with a dedicated clean-origin OCF2 message-header QR relay.",
          lang: "en",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#0F172A",
          theme_color: "#0F172A",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,wasm,webmanifest}"],
          // The landing page under /about/ is an online-only surface. Keep its
          // bytes out of the offline bundle, and stop the SPA navigation
          // fallback from serving the app shell in its place.
          globIgnores: ["about/**"],
          navigateFallbackDenylist: [/^\/about\//],
          navigateFallback: "/index.html",
          cleanupOutdatedCaches: true,
          // Without this the worker never controls the page that installed it, so the
          // precached reader WASM is unreachable on the first run once the device goes
          // offline. Claiming happens at activation only; waiting-worker semantics and
          // the message-driven SKIP_WAITING path are unchanged.
          clientsClaim: true,
          // The reachability sentinel gating the destructive wipe-on-online path
          // must always bypass the service worker: excluded from precache and
          // served NetworkOnly, so it always fails while offline.
          runtimeCaching: [
            {
              urlPattern: /\/reachability-sentinel\.txt/,
              handler: "NetworkOnly",
            },
          ],
        },
      }),
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
