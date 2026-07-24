import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon.svg", "icons/apple-touch-icon-180.png"],
        manifest: {
          name: "Qrypt",
          short_name: "Qrypt",
          description: "Offline-only encrypted QR code tool for on-device use.",
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
          globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
          navigateFallback: "/index.html",
          cleanupOutdatedCaches: true,
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
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  }
})
