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
    },
  },
  {
    // src/lib/reload.ts is the single owner of full-page reload, because jsdom
    // defines Location.reload non-configurable and tests mock that module
    // instead of the global. A direct call is silently untestable.
    //
    // Matching on the receiver would mean enumerating spellings — window,
    // globalThis, self, document, and their computed forms all reach the same
    // Location — so this matches the `reload` property itself and scopes the
    // ban to application code, where nothing else legitimately owns one.
    // Matching the access rather than the call also covers the indirections a
    // call-only selector misses: rebinding, `.call`, `Reflect.apply`, and
    // comma-operator escapes all have to read the property first.
    // Playwright's page.reload lives in tests/ and is deliberately out of scope,
    // as is public/, whose plain browser modules cannot import the owner.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/reload.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='reload']",
          message: "Call reloadApplication from @/lib/reload instead.",
        },
        {
          selector: "MemberExpression[property.value='reload']",
          message: "Call reloadApplication from @/lib/reload instead.",
        },
      ],
    },
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
