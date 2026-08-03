import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { deploymentPolicyFromHeaders } from "./scripts/csp-from-headers.mjs"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify("test"),
    __DEPLOYMENT_HEADER_POLICY__: JSON.stringify(
      deploymentPolicyFromHeaders(
        readFileSync(new URL("./public/_headers", import.meta.url), "utf8"),
      ),
    ),
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "tests/unit/**/*.test.ts",
            "tests/integration/**/*.test.ts",
            "tests/pq/**/*.test.ts",
            "tests/pq-vectors/**/*.test.ts",
            "tests/qr-multipart/**/*.test.ts",
          ],
          setupFiles: ["tests/setup/node.ts"],
          benchmark: {
            include: ["tests/bench/**/*.bench.ts"],
          },
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.tsx"],
          setupFiles: ["tests/setup/jsdom.ts"],
        },
      },
    ],
  },
})
