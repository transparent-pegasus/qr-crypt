// Every language of the landing page is its own document, written at build
// time. A crawler never runs the switcher, so whatever these documents say in
// their head is the only thing a shared link can carry — which makes the head
// worth checking as carefully as the body.
import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { parseDocument, renderAboutLocales } from "../../scripts/build-about-locales.mjs"

const ABOUT_DIR = new URL("../../public/about/", import.meta.url)
const aboutDir = fileURLToPath(ABOUT_DIR)

const source = readFileSync(fileURLToPath(new URL("index.html", ABOUT_DIR)), "utf8")

const messages = (await import(
  /* @vite-ignore */ new URL("messages.js", ABOUT_DIR).href
)) as { LOCALES: Record<string, { label: string; strings: Record<string, string> }> }

let pages: { code: string; html: string }[]

beforeAll(async () => {
  pages = await renderAboutLocales({ aboutDir })
})

describe("about page locales", () => {
  it("writes one document per translated language", () => {
    expect(pages.map(({ code }) => code).sort()).toEqual(
      Object.keys(messages.LOCALES).sort(),
    )
  })

  it.each(Object.keys(messages.LOCALES))("translates %s end to end", async (code) => {
    const html = pages.find((page) => page.code === code)?.html ?? ""
    const doc = await parseDocument(html)
    const strings = messages.LOCALES[code]?.strings ?? {}

    expect(doc.documentElement.lang).toBe(code)
    expect(doc.title.trim()).toBe(strings["meta.title"])

    // Nothing marked translatable may still be showing the English source.
    for (const element of doc.querySelectorAll("[data-i18n]")) {
      const key = element.getAttribute("data-i18n") ?? ""
      expect(element.textContent?.trim()).toBe(strings[key])
    }
    for (const [hook, attribute] of Object.entries({
      "data-i18n-alt": "alt",
      "data-i18n-label": "aria-label",
      "data-i18n-content": "content",
    })) {
      for (const element of doc.querySelectorAll(`[${hook}]`)) {
        expect(element.getAttribute(attribute)).toBe(
          strings[element.getAttribute(hook) ?? ""],
        )
      }
    }
  })

  it.each(Object.keys(messages.LOCALES))(
    "gives %s its own address, card and social wording",
    async (code) => {
      const html = pages.find((page) => page.code === code)?.html ?? ""
      const doc = await parseDocument(html)
      const strings = messages.LOCALES[code]?.strings ?? {}
      const meta = (selector: string) =>
        doc.querySelector(selector)?.getAttribute("content")
      const here = `https://qr-crypt.pages.dev/about/${code}/`
      const card = `https://qr-crypt.pages.dev/about/og-${code}.png`

      expect(meta('meta[property="og:url"]')).toBe(here)
      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(here)
      expect(meta('meta[property="og:title"]')).toBe(strings["meta.title"])
      expect(meta('meta[property="og:description"]')).toBe(strings["meta.description"])
      expect(meta('meta[property="og:image"]')).toBe(card)
      expect(meta('meta[name="twitter:image"]')).toBe(card)
      expect(meta('meta[property="og:locale"]')).not.toBe(
        source.match(/property="og:locale" content="([^"]+)"/)?.[1],
      )

      // The card describes itself; the page repeats that description.
      const svg = readFileSync(
        fileURLToPath(new URL(`og-${code}.svg`, ABOUT_DIR)),
        "utf8",
      )
      expect(meta('meta[property="og:image:alt"]')).toBe(
        svg.match(/aria-label="([^"]+)"/)?.[1],
      )
    },
  )

  it.each(Object.keys(messages.LOCALES))(
    "reaches the shared assets from one directory deeper in %s",
    async (code) => {
      const html = pages.find((page) => page.code === code)?.html ?? ""
      const doc = await parseDocument(html)

      const relative = [...doc.querySelectorAll("[src^='.'], [href^='.']")].map(
        (element) => element.getAttribute("src") ?? element.getAttribute("href"),
      )

      expect(relative.length).toBeGreaterThan(0)
      for (const reference of relative) {
        expect(reference).toMatch(/^\.\.\//)
      }
    },
  )

  it.each(Object.keys(messages.LOCALES))("marks %s as the current page", async (code) => {
    const html = pages.find((page) => page.code === code)?.html ?? ""
    const doc = await parseDocument(html)

    const current = [...doc.querySelectorAll('.lang__button[aria-current="page"]')]
    expect(current.map((link) => link.getAttribute("lang"))).toEqual([code])
  })
})
