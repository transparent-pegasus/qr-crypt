// The landing page keeps its English wording in index.html and every other
// language in messages.js. Nothing checks that the two agree at runtime — a
// missing key silently falls back to English and a stale key is silently
// ignored — so it is checked here instead.
import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import { describe, expect, it } from "vitest"
import { parseDocument } from "../../scripts/build-about-locales.mjs"

const ABOUT_DIR = new URL("../../public/about/", import.meta.url)

const html = readFileSync(fileURLToPath(new URL("index.html", ABOUT_DIR)), "utf8")

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

  it("pins the approved locks.pq name and body in English and Japanese", async () => {
    // Key parity alone cannot catch stale wording; pin the approved design §4
    // strings so a quantum-era framing rewrite fails until both locales match.
    const doc = await parseDocument(html)
    const english = (key: string) =>
      doc.querySelector(`[data-i18n="${key}"]`)?.textContent?.replace(/\s+/g, " ").trim()

    expect(english("locks.pq.name")).toBe("ML-KEM-1024 + ML-DSA-87")
    expect(english("locks.pq.body")).toBe(
      "With ML-KEM-1024, the sender establishes a per-message shared secret using only the recipient's public key — unlike a shared symmetric key, the secret that can decrypt messages never has to be handed to the sender. On top of that, every message carries an ML-DSA-87 signature, so the recipient can verify who sent it. The trade-off is greater processing and data overhead, so each message is split across multiple QR codes.",
    )

    const ja = messages.LOCALES.ja?.strings ?? {}
    expect(ja["locks.pq.name"]).toBe("ML-KEM-1024 + ML-DSA-87")
    expect(ja["locks.pq.body"]).toBe(
      "ML-KEM-1024では、受信者の公開鍵だけを使ってメッセージごとの共有秘密を確立できるため、共通鍵方式と違い、復号に使える秘密を送信者に渡す必要がありません。さらに各メッセージにはML-DSA-87署名が付き、受信者は送信者を検証できます。その代わり処理量とデータ量が増えるため、メッセージは複数のQRコードに分割されます。",
    )
  })
})
