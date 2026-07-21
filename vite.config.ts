import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const appName = env.VITE_APP_NAME ?? "Offline Cipher"
  const shortName = env.VITE_APP_SHORT_NAME ?? "Cipher"
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon.svg", "icons/apple-touch-icon-180.png"],
        manifest: {
          name: appName,
          short_name: shortName,
          description: "オフラインで完結する暗号化QRツール",
          lang: "ja",
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
        },
      }),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  }
})
