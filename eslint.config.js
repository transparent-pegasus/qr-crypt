import js from "@eslint/js"
import prettier from "eslint-config-prettier"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dev-dist",
      "coverage",
      "playwright-report",
      "test-results",
      "node_modules",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      // src/lib/reload.ts is the single owner of full-page reload, because jsdom
      // defines Location.reload non-configurable and tests mock that module
      // instead of the global. A direct call is silently untestable.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.object.name='window'][callee.object.property.name='location'][callee.property.name='reload']",
          message: "Call reloadApplication from @/lib/reload instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='location'][callee.property.name='reload']",
          message: "Call reloadApplication from @/lib/reload instead.",
        },
      ],
    },
  },
  {
    // The single owner itself is the one place the global call belongs.
    files: ["src/lib/reload.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: [
      "scripts/**/*.mjs",
      "vite.config.ts",
      "vitest.config.ts",
      "playwright.config.ts",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Static landing page under public/: plain browser modules, no build step.
    files: ["public/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
)
