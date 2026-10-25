import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"

export default defineConfig({
  testDir: ".",
  testMatch: "probe.spec.ts",
  timeout: 120000,
  workers: 1,
  retries: 0,
  outputDir: "../out/browser-traces",
  reporter: "list",
  use: { baseURL: "http://localhost:4179", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "aube exec vite preview --config spike/native/probe/vite.config.mjs --mode prod --host localhost --port 4179 --strictPort",
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    url: "http://localhost:4179",
    reuseExistingServer: false,
  },
})
