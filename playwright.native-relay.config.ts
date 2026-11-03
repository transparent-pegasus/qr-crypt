import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e-native-relay",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/native-relay",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/native-relay", open: "never" }],
  ],
  projects: [{ name: "windows-webview2" }],
})
