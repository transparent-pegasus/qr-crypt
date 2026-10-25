import { describe, expect, expectTypeOf, it } from "vitest"
import {
  findRelayBundleViolations,
  findRelayOutputViolations,
  RELAY_ALLOWED_OUTPUT,
  RELAY_ALLOWED_PACKAGES,
  RELAY_ALLOWED_QUERY_IMPORTS,
  RELAY_ALLOWED_SOURCES,
  RELAY_ALLOWED_URL_ORIGINS,
  RELAY_ALLOWED_VIRTUAL_IDS,
} from "../../scripts/relay-bundle-allowlist.mjs"

const ROOT = "/work/qr"
const WINDOWS_ROOT = String.raw`C:\work\qr`
const BANNED_SOURCE_FILES = [
  "src/app/providers.tsx",
  "src/app/display-gate.tsx",
  "src/components/pwa-offline-ready.tsx",
  "src/hooks/use-register-sw.ts",
  "src/lib/reachability.ts",
]

describe("relay allowlist exports", () => {
  it("exposes readonly arrays and the specified function signatures", () => {
    expectTypeOf(RELAY_ALLOWED_SOURCES).toEqualTypeOf<
      Readonly<typeof RELAY_ALLOWED_SOURCES>
    >()
    expectTypeOf(RELAY_ALLOWED_PACKAGES).toEqualTypeOf<
      Readonly<typeof RELAY_ALLOWED_PACKAGES>
    >()
    expectTypeOf(RELAY_ALLOWED_VIRTUAL_IDS).toEqualTypeOf<
      Readonly<typeof RELAY_ALLOWED_VIRTUAL_IDS>
    >()
    expectTypeOf(RELAY_ALLOWED_QUERY_IMPORTS).toEqualTypeOf<
      Readonly<typeof RELAY_ALLOWED_QUERY_IMPORTS>
    >()
    expectTypeOf(RELAY_ALLOWED_OUTPUT).toEqualTypeOf<
      Readonly<typeof RELAY_ALLOWED_OUTPUT>
    >()
    expectTypeOf(RELAY_ALLOWED_URL_ORIGINS).toEqualTypeOf<
      Readonly<typeof RELAY_ALLOWED_URL_ORIGINS>
    >()
    expectTypeOf(findRelayBundleViolations).toEqualTypeOf<
      (moduleIds: Iterable<string>, repoRoot: string) => string[]
    >()
    expectTypeOf(findRelayOutputViolations).toEqualTypeOf<
      (files: Iterable<{ fileName: string; text?: string }>) => string[]
    >()

    for (const list of [
      RELAY_ALLOWED_SOURCES,
      RELAY_ALLOWED_PACKAGES,
      RELAY_ALLOWED_VIRTUAL_IDS,
      RELAY_ALLOWED_QUERY_IMPORTS,
      RELAY_ALLOWED_OUTPUT,
      RELAY_ALLOWED_URL_ORIGINS,
    ]) {
      expect(Array.isArray(list)).toBe(true)
    }
  })

  it("includes an HTML entry and the global stylesheet as exact POSIX source paths", () => {
    expect(RELAY_ALLOWED_SOURCES.some((source) => source.endsWith(".html"))).toBe(true)
    expect(RELAY_ALLOWED_SOURCES).toContain("src/styles/globals.css")
    for (const source of RELAY_ALLOWED_SOURCES) {
      expect(source).not.toMatch(/^(?:\/|[a-z]:)/i)
      expect(source).not.toMatch(/[\\*?]/)
      expect(source.split("/")).not.toContain("..")
    }
  })

  it("allows only the specified wasm query pair", () => {
    expect(RELAY_ALLOWED_QUERY_IMPORTS).toEqual([
      { path: "zxing-wasm/reader/zxing_reader.wasm", query: "url" },
    ])
  })

  it("does not treat aube storage encodings as package names", () => {
    for (const name of [".aube", "react@19.2.8", "@radix-ui+react-dialog@x"]) {
      expect(RELAY_ALLOWED_PACKAGES).not.toContain(name)
    }
  })

  it("exposes exactly the four output patterns", () => {
    expect([...RELAY_ALLOWED_OUTPUT].sort()).toEqual([
      "assets/*.css",
      "assets/*.js",
      "assets/zxing_reader-*.wasm",
      "index.html",
    ])
  })

  it("excludes storage, boot, and worker source prefixes", () => {
    expect(
      RELAY_ALLOWED_SOURCES.filter((source) =>
        /^src\/(?:storage|app\/boot|workers)\//.test(source),
      ),
    ).toEqual([])
  })

  it("excludes feature sources other than presentation.ts", () => {
    expect(
      RELAY_ALLOWED_SOURCES.filter(
        (source) =>
          source.startsWith("src/features/") && source !== "src/features/presentation.ts",
      ),
    ).toEqual([])
  })

  it("excludes crypto sources other than the six stated exceptions", () => {
    const exceptions = [
      "src/crypto/errors.ts",
      "src/crypto/random.ts",
      "src/crypto/pq/canonical-cbor.ts",
      "src/crypto/pq/validation.ts",
      "src/crypto/pq/profiles.ts",
      "src/crypto/pq/suites.ts",
    ]
    expect(
      RELAY_ALLOWED_SOURCES.filter(
        (source) => source.startsWith("src/crypto/") && !exceptions.includes(source),
      ),
    ).toEqual([])
  })

  it.each(BANNED_SOURCE_FILES)("excludes the banned source %s", (source) => {
    expect(RELAY_ALLOWED_SOURCES).not.toContain(source)
  })

  it.each(["idb", "@noble/post-quantum", "vite-plugin-pwa"])(
    "excludes the banned package %s",
    (name) => {
      expect(RELAY_ALLOWED_PACKAGES).not.toContain(name)
    },
  )

  it("excludes all workbox packages and pwa-register virtual ids", () => {
    expect(RELAY_ALLOWED_PACKAGES.filter((name) => name.startsWith("workbox-"))).toEqual(
      [],
    )
    expect(RELAY_ALLOWED_VIRTUAL_IDS.filter((id) => id.includes("pwa-register"))).toEqual(
      [],
    )
  })

  it("gives every URL origin an explanation", () => {
    for (const { origin, reason } of RELAY_ALLOWED_URL_ORIGINS) {
      expect(origin).toBe(new URL(origin).origin)
      expect(reason.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("findRelayBundleViolations", () => {
  it.each([
    `${ROOT}/src/components/online-relay.tsx`,
    `${ROOT}/src/styles/globals.css`,
    `${ROOT}/node_modules/.aube/react@19.2.8/node_modules/react/index.js`,
    `${ROOT}/node_modules/.aube/@radix-ui+react-dialog@x/node_modules/@radix-ui/react-dialog/dist/index.mjs`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?url`,
    `${ROOT}/node_modules/.aube/zxing-wasm@x/node_modules/zxing-wasm/reader/zxing_reader.wasm?url`,
    "\0rolldown/runtime.js",
    "\0vite/preload-helper.js",
  ])("accepts %s", (id) => {
    expect(findRelayBundleViolations([id], ROOT)).toEqual([])
  })

  it.each([
    "src/storage/keys.ts",
    "src/app/boot/boot-contract.ts",
    "src/workers/pq-crypto.worker.ts",
    "src/features/encrypt.ts",
    "src/crypto/encrypt.ts",
    "src/crypto/pq/provider-noble.ts",
    ...BANNED_SOURCE_FILES,
  ])("rejects the banned source %s by its original id", (source) => {
    const id = `${ROOT}/${source}`
    expect(findRelayBundleViolations([id], ROOT)).toEqual([id])
  })

  it.each([
    `${ROOT}/node_modules/idb/build/index.js`,
    `${ROOT}/node_modules/.aube/@noble+post-quantum@0.7.1/node_modules/@noble/post-quantum/ml-kem.js`,
    `${ROOT}/node_modules/vite-plugin-pwa/dist/index.js`,
    `${ROOT}/node_modules/workbox-window/build/workbox-window.prod.es5.mjs`,
    `${ROOT}/node_modules/react/node_modules/idb/build/index.js`,
    `${ROOT}/node_modules/@radix-ui/not-allowed/index.js`,
  ])("rejects an unlisted package at the last node_modules segment: %s", (id) => {
    expect(findRelayBundleViolations([id], ROOT)).toEqual([id])
  })

  it.each([
    "\0virtual:pwa-register/react",
    "virtual:pwa-register",
    "virtual:other",
    "\0vite/something.js",
    "\0rolldown/runtime.js.extra",
    "\0vite/preload-helper.js?url",
  ])("rejects a virtual id that is not an exact allowed id: %s", (id) => {
    expect(findRelayBundleViolations([id], ROOT)).toEqual([id])
  })

  it.each(["worker", "sharedworker", "raw", "inline", "worker&url", "url"])(
    "rejects ?%s on an allowed source",
    (query) => {
      const id = `${ROOT}/src/components/online-relay.tsx?${query}`
      expect(findRelayBundleViolations([id], ROOT)).toEqual([id])
    },
  )

  it.each([
    `${ROOT}/src/workers/pq-crypto.worker.ts?worker`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?worker`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?sharedworker`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?raw`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?inline`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?worker&url`,
    `${ROOT}/node_modules/zxing-wasm/reader/zxing_reader.wasm?url&worker`,
    `${ROOT}/node_modules/zxing-wasm/reader/other.wasm?url`,
    `${ROOT}/node_modules/react/zxing_reader.wasm?url`,
    `${ROOT}/zxing-wasm/reader/zxing_reader.wasm?url`,
  ])("rejects a query outside the exact package-relative pair: %s", (id) => {
    expect(findRelayBundleViolations([id], ROOT)).toEqual([id])
  })

  it.each([
    `${ROOT}/src/unknown.ts`,
    `${ROOT}/src/components/online-relay.tsx.extra`,
    "/elsewhere/x.ts",
    "/elsewhere/node_modules/react/index.js",
    `${ROOT}-other/src/components/online-relay.tsx`,
    "src/components/online-relay.tsx",
    "react",
    "zxing-wasm/reader/zxing_reader.wasm?url",
  ])("rejects an unknown source or an id outside the repo: %s", (id) => {
    expect(findRelayBundleViolations([id], ROOT)).toEqual([id])
  })

  it("accepts an iterable and returns only offending ids sorted verbatim", () => {
    const ids = new Set([
      "react",
      `${ROOT}/src/z-unknown.ts`,
      String.raw`\work\qr\src\storage\keys.ts`,
      "\0vite/something.js",
      `${ROOT}/src/a-unknown.ts`,
      `${ROOT}/src/components/online-relay.tsx`,
    ])
    expect(findRelayBundleViolations(ids, ROOT)).toEqual([
      "\0vite/something.js",
      `${ROOT}/src/a-unknown.ts`,
      `${ROOT}/src/z-unknown.ts`,
      String.raw`\work\qr\src\storage\keys.ts`,
      "react",
    ])
  })

  it.each([
    String.raw`C:\work\qr\src\components\online-relay.tsx`,
    String.raw`C:\work\qr\node_modules\.aube\react@19.2.8\node_modules\react\index.js`,
    String.raw`C:\work\qr\node_modules\.aube\@radix-ui+react-dialog@x\node_modules\@radix-ui\react-dialog\dist\index.mjs`,
    String.raw`C:\work\qr\node_modules\zxing-wasm\reader\zxing_reader.wasm?url`,
    String.raw`c:\WORK\QR\src\components\online-relay.tsx`,
    "C:/work/qr/src/components/online-relay.tsx",
  ])("accepts normalized Windows paths within the case-insensitive root: %s", (id) => {
    expect(findRelayBundleViolations([id], WINDOWS_ROOT)).toEqual([])
  })

  it.each([
    String.raw`C:\work\qr\node_modules\idb\build\index.js`,
    String.raw`D:\other\x.ts`,
    String.raw`C:\elsewhere\node_modules\react\index.js`,
    String.raw`C:\work\qr-other\src\components\online-relay.tsx`,
  ])("rejects Windows ids without changing their spelling: %s", (id) => {
    expect(findRelayBundleViolations([id], WINDOWS_ROOT)).toEqual([id])
  })
})

describe("findRelayOutputViolations", () => {
  it.each([
    "index.html",
    "assets/relay-abc.js",
    "assets/relay-abc.css",
    "assets/zxing_reader-abc.wasm",
  ])("accepts the allowed output shape %s without requiring text", (fileName) => {
    expect(findRelayOutputViolations([{ fileName }])).toEqual([])
  })

  it.each([
    "sw.js",
    "registerSW.js",
    "workbox-abc.js",
    "manifest.webmanifest",
    "_headers",
    "assets/other.wasm",
    "unexpected.txt",
    "relay.js",
    "styles.css",
    "nested/index.html",
    "assets/zxing_reader-abc.wasm.extra",
  ])("reports the forbidden output filename %s", (fileName) => {
    expect(findRelayOutputViolations([{ fileName }])).toEqual([fileName])
  })

  it("reports the origin and filename for a URL in an otherwise allowed JS file", () => {
    expect(
      findRelayOutputViolations([
        { fileName: "assets/relay.js", text: 'fetch("https://evil.example/x")' },
      ]),
    ).toEqual(["url:https://evil.example in assets/relay.js"])
  })

  it("accepts text containing only listed origins", () => {
    const text = RELAY_ALLOWED_URL_ORIGINS.map(
      ({ origin }) => `"${origin}/inert-metadata"`,
    ).join("\n")
    expect(findRelayOutputViolations([{ fileName: "assets/relay.js", text }])).toEqual([])
  })

  it("reports both violations when a forbidden filename also contains a URL", () => {
    expect(
      findRelayOutputViolations([
        { fileName: "sw.js", text: 'fetch("https://evil.example/x")' },
      ]).sort(),
    ).toEqual(["sw.js", "url:https://evil.example in sw.js"])
  })

  it("accepts an iterable and reports filename and URL violations together", () => {
    const files = new Set([
      { fileName: "index.html" },
      { fileName: "sw.js" },
      { fileName: "assets/relay.js", text: 'fetch("https://evil.example/x")' },
    ])
    expect(findRelayOutputViolations(files).sort()).toEqual([
      "sw.js",
      "url:https://evil.example in assets/relay.js",
    ])
  })
})
