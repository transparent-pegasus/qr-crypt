// The landing page keeps its English wording in index.html and every other
// language in messages.js. Nothing checks that the two agree at runtime — a
// missing key silently falls back to English and a stale key is silently
// ignored — so it is checked here instead.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { parseDocument } from "../../scripts/build-about-locales.mjs"

const ABOUT_DIR = new URL("../../public/about/", import.meta.url)

const html = readFileSync(fileURLToPath(new URL("index.html", ABOUT_DIR)), "utf8")
const aboutScript = readFileSync(fileURLToPath(new URL("about.js", ABOUT_DIR)), "utf8")

const messages = (await import(
  /* @vite-ignore */ new URL("messages.js", ABOUT_DIR).href
)) as {
  DEFAULT_LOCALE: { code: string; label: string }
  LOCALES: Record<string, { label: string; strings: Record<string, string> }>
}

function documentKeys(): Set<string> {
  // Keep in sync with ATTRIBUTE_HOOKS in scripts/build-about-locales.mjs: a hook
  // missing here reads every key it carries as stale.
  const pattern = /data-i18n(?:-(?:alt|label|content|href))?="([^"]+)"/g
  return new Set(Array.from(html.matchAll(pattern), (match) => match[1] as string))
}

async function runAbout(
  options: {
    path?: string
    search?: string
    hash?: string
    stored?: string
    languages?: readonly string[]
    language?: string
    storageUnavailable?: boolean
  } = {},
) {
  const doc = await parseDocument(html)
  const address = new URL(
    `${options.path ?? "/about/"}${options.search ?? ""}${options.hash ?? ""}`,
    "https://preview.example",
  )
  const base = doc.createElement("base")
  base.href = address.href
  doc.head.append(base)
  if (options.path === "/about/ja/") doc.documentElement.lang = "ja"
  const storage = new Map<string, string>([["oc-lang", "en"]])
  if (options.stored !== undefined) storage.set("qrc-about-lang", options.stored)
  const redirects: string[] = []
  const location = {
    pathname: address.pathname,
    search: address.search,
    hash: address.hash,
    replace: (href: string) => redirects.push(href),
  }
  runInNewContext(aboutScript, {
    document: doc,
    window: {
      location,
      localStorage: {
        getItem(key: string) {
          if (options.storageUnavailable) throw new Error("storage unavailable")
          return storage.get(key) ?? null
        },
        setItem(key: string, value: string) {
          if (options.storageUnavailable) throw new Error("storage unavailable")
          storage.set(key, value)
        },
      },
    },
    navigator: {
      ...(options.languages === undefined ? {} : { languages: options.languages }),
      language: options.language ?? "en-US",
    },
    URL,
    URLSearchParams,
  })
  return { doc, redirects, storage }
}

describe("about page language navigation", () => {
  it("ignores a query language when the saved choice is English", async () => {
    const result = await runAbout({ search: "?lang=ja", stored: "en", languages: ["ja"] })
    expect(result.redirects).toEqual([])
  })

  it("ignores a query language when the browser fallback is English", async () => {
    const result = await runAbout({ search: "?lang=ja", languages: ["en-US"] })
    expect(result.redirects).toEqual([])
  })

  it("uses the saved locale ahead of query and browser preferences and preserves the hash", async () => {
    const result = await runAbout({
      search: "?lang=en",
      stored: "ja",
      languages: ["en-US"],
      hash: "#security",
    })
    expect(result.redirects).toEqual(["https://preview.example/about/ja/#security"])
  })

  it("falls through an unsupported saved locale to the first supported browser language", async () => {
    const result = await runAbout({
      stored: "unsupported",
      languages: ["fr-FR", "ja-JP", "en-US"],
    })
    expect(result.redirects).toEqual(["https://preview.example/about/ja/"])
  })

  it("uses navigator.language when navigator.languages is absent", async () => {
    const result = await runAbout({ language: "ja-JP" })
    expect(result.redirects).toEqual(["https://preview.example/about/ja/"])
  })

  it("uses the browser language when storage cannot be read", async () => {
    const result = await runAbout({ storageUnavailable: true, languages: ["ja-JP"] })
    expect(result.redirects).toEqual(["https://preview.example/about/ja/"])
  })

  it("keeps the English document when neither saved nor browser preferences are supported", async () => {
    const result = await runAbout({ stored: "unsupported", languages: ["fr-FR"] })
    expect(result.redirects).toEqual([])
  })

  it("keeps an explicit translated path despite English preferences", async () => {
    const result = await runAbout({
      path: "/about/ja/",
      stored: "en",
      languages: ["en-US"],
      search: "?lang=en",
    })
    expect(result.redirects).toEqual([])
  })

  it("remembers a switcher click without changing the app's locale storage", async () => {
    const result = await runAbout()
    const link = result.doc.querySelector<HTMLAnchorElement>('.lang__button[lang="ja"]')
    expect(link).not.toBeNull()
    link?.dispatchEvent(new result.doc.defaultView!.Event("click"))

    expect(Object.fromEntries(result.storage)).toEqual({
      "oc-lang": "en",
      "qrc-about-lang": "ja",
    })
  })
})

describe("about page i18n", () => {
  const keys = documentKeys()

  it("marks up every translatable string in the document", () => {
    // Guards against a rewrite that drops the attributes altogether.
    expect(keys.size).toBeGreaterThan(50)
    expect(keys.has("meta.title")).toBe(true)
    expect(keys.has("hero.line1")).toBe(true)
  })

  it("keeps English out of messages.js so it exists in exactly one place", () => {
    expect(messages.DEFAULT_LOCALE.code).toBe("en")
    expect(messages.DEFAULT_LOCALE.code in messages.LOCALES).toBe(false)
    expect(html).toContain('<html lang="en">')
  })

  it.each(Object.keys(messages.LOCALES))(
    "translates exactly the document's keys in %s",
    (code) => {
      const strings = messages.LOCALES[code]?.strings ?? {}
      const translated = new Set(Object.keys(strings))

      const missing = [...keys].filter((key) => !translated.has(key)).sort()
      const stale = [...translated].filter((key) => !keys.has(key)).sort()

      expect({ missing, stale }).toEqual({ missing: [], stale: [] })
      expect(Object.values(strings).filter((value) => value.trim() === "")).toEqual([])
    },
  )

  it("links every locale from the switcher, under the name messages.js gives it", async () => {
    // The switcher is static markup so it works without JavaScript, which puts
    // the locale names in two places. This is what keeps the two in step.
    const doc = await parseDocument(html)
    const links = [...doc.querySelectorAll(".lang__button[lang]")]
    const linked = Object.fromEntries(
      links.map((link) => [
        link.getAttribute("lang"),
        { label: link.textContent?.trim(), href: link.getAttribute("href") },
      ]),
    )

    expect(linked[messages.DEFAULT_LOCALE.code]).toEqual({
      label: messages.DEFAULT_LOCALE.label,
      href: "/about/",
    })
    for (const [code, locale] of Object.entries(messages.LOCALES)) {
      expect(linked[code]).toEqual({ label: locale.label, href: `/about/${code}/` })
    }
    expect(links).toHaveLength(Object.keys(messages.LOCALES).length + 1)
  })

  it("pins the approved mode names and bodies in English and Japanese", async () => {
    // Key parity alone cannot catch stale wording; pin the approved strings so a
    // rewrite that reintroduces algorithm names or a duration framing fails until
    // both locales are updated together.
    const doc = await parseDocument(html)
    const english = (key: string) =>
      doc.querySelector(`[data-i18n="${key}"]`)?.textContent?.replace(/\s+/g, " ").trim()

    expect(english("locks.aes.name")).toBe("Shared-key mode")
    expect(english("locks.aes.body")).toBe(
      "Encrypts a message with a secret the two of you shared in person. The data stays small, so a message travels in few QR codes. Each encryption derives a different AES-256-GCM key with HKDF.",
    )
    expect(english("locks.pq.name")).toBe("Public-key mode")
    expect(english("locks.pq.body")).toBe(
      "Establishes the message secret from the recipient's public key and verifies the sender's signature, so no sender has to hold a secret that can decrypt. It uses ML-KEM for the key establishment and ML-DSA to confirm the sender. The body itself is encrypted with AES-256-GCM, the same as shared-key mode; the signature and public-key data make the message larger.",
    )

    const ja = messages.LOCALES.ja?.strings ?? {}
    expect(ja["locks.aes.name"]).toBe("共有鍵モード")
    expect(ja["locks.aes.body"]).toBe(
      "対面で共有した秘密を使用してメッセージを暗号化します。データ量が小さく、少ないQRコードで送受信できます。暗号化ごとにHKDFで異なるAES-256-GCM鍵を導出します。",
    )
    expect(ja["locks.pq.name"]).toBe("公開鍵モード")
    expect(ja["locks.pq.body"]).toBe(
      "受信者の公開鍵を使用してメッセージ用の秘密を確立し、送信者の署名を検証します。送信者に復号用の共有秘密を持たせずに済みます。ML-KEMによる鍵確立とML-DSAによる送信者確認を使用します。本文の暗号化には、共有鍵モードと同じくAES-256-GCMを使用します。署名と公開鍵データのため、メッセージは大きくなります。",
    )
  })
})

describe("about page repository links", () => {
  // A locale that names a repository path must name one that exists: the page
  // swaps the English href for the translated one, so a stale path is a 404 no
  // English reader ever sees.
  const REPOSITORY_ROOT = fileURLToPath(new URL("../../", ABOUT_DIR))
  const GITHUB_BLOB = "https://github.com/transparent-pegasus/qr-crypt/blob/main/"

  function repositoryPath(value: string): string | null {
    if (value.startsWith(GITHUB_BLOB)) return value.slice(GITHUB_BLOB.length)
    return value.startsWith("docs/") ? value : null
  }

  it("resolves every repository path the locale catalogs carry", () => {
    const carried = Object.entries(messages.LOCALES).flatMap(([code, locale]) =>
      Object.entries(locale.strings).flatMap(([key, value]) => {
        const path = repositoryPath(value)
        return path === null ? [] : [{ source: `${code}:${key}`, path }]
      }),
    )

    expect(carried.length).toBeGreaterThan(0)
    expect(
      carried.filter(({ path }) => !existsSync(join(REPOSITORY_ROOT, path))),
    ).toEqual([])
  })

  it.each(Object.keys(messages.LOCALES))(
    "points the %s install link at the path it displays",
    (code) => {
      // repositoryPath() cannot tell a malformed blob URL from an ordinary
      // external one, so a typo in the prefix would be skipped rather than
      // caught. Tying the href to the visible path leaves nothing to skip.
      const strings = messages.LOCALES[code]?.strings ?? {}
      expect(strings["install.a.docHref"]).toBe(
        `${GITHUB_BLOB}${strings["install.a.docUrl"]}`,
      )
    },
  )

  it("resolves every repository path the English document carries", () => {
    const carried = Array.from(html.matchAll(/href="([^"]+)"/g), (match) =>
      repositoryPath(match[1] as string),
    ).filter((path): path is string => path !== null)

    expect(carried.length).toBeGreaterThan(0)
    expect(carried.filter((path) => !existsSync(join(REPOSITORY_ROOT, path)))).toEqual([])
  })
})
