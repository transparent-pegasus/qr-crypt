// Builds one landing page per language.
//
// The English wording lives in public/about/index.html and nowhere else, and
// every other language lives in public/about/messages.js. This turns the two
// into a real document per language — /about/ for English, /about/<code>/ for
// the rest — so each address carries its own <html lang>, its own title and
// description, and its own social card, and so the page needs no JavaScript to
// be read in the language its address names.
//
// Runs from the Vite plugin in vite.config.ts, against the copied public/ tree
// in dist, and from tests/unit/about-page-locales.test.ts against public/.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// data-i18n replaces text content; these hooks replace the named attribute.
const ATTRIBUTE_HOOKS = {
  "data-i18n-alt": "alt",
  "data-i18n-label": "aria-label",
  "data-i18n-content": "content",
}

// Open Graph wants a territory, BCP 47 does not. Locales outside this map fall
// back to their bare code, which every consumer treats as a hint rather than a
// promise.
const OG_LOCALES = { en: "en_US", ja: "ja_JP" }

const ogLocale = (code) => OG_LOCALES[code] ?? code

/** The card's own description, so the two can never drift apart. */
function cardAlt(aboutDir, code) {
  const svg = readFileSync(join(aboutDir, `og-${code}.svg`), "utf8")
  const alt = /aria-label="([^"]+)"/.exec(svg)
  if (!alt) throw new Error(`og-${code}.svg has no aria-label to describe it`)
  return alt[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
}

function setMeta(doc, selector, value) {
  const tag = doc.querySelector(selector)
  if (!tag) throw new Error(`the document has no ${selector} to translate`)
  tag.setAttribute(selector.startsWith("link") ? "href" : "content", value)
}

/**
 * Parses a document the same way this build does. Exported so the tests can
 * read the output without reaching for jsdom themselves, which has no types.
 */
export async function parseDocument(html) {
  const { JSDOM } = await import("jsdom")
  return new JSDOM(html).window.document
}

/**
 * @returns the source document rewritten into `code`, as a full HTML string.
 */
export async function renderLocale({ html, code, strings, alt }) {
  const doc = await parseDocument(html)
  const read = (key) => strings[key]

  // The canonical link of the source is the site root this page is served from,
  // so nothing here has to know the deployment's hostname.
  const canonical = doc.querySelector('link[rel="canonical"]')
  if (!canonical) throw new Error("the document has no canonical link to build on")
  const root = new URL("../", canonical.href)
  const here = new URL(`${code}/`, canonical.href).href

  doc.documentElement.lang = code

  for (const element of doc.querySelectorAll("[data-i18n]")) {
    const text = read(element.getAttribute("data-i18n"))
    if (text) element.textContent = text
  }
  for (const [hook, attribute] of Object.entries(ATTRIBUTE_HOOKS)) {
    for (const element of doc.querySelectorAll(`[${hook}]`)) {
      const text = read(element.getAttribute(hook))
      if (text) element.setAttribute(attribute, text)
    }
  }

  // The social tags carry the same wording as the document, but a crawler never
  // runs the switcher, so they are the only place a shared link can say it.
  setMeta(doc, 'meta[property="og:title"]', read("meta.title"))
  setMeta(doc, 'meta[property="og:description"]', read("meta.description"))
  setMeta(doc, 'meta[property="og:url"]', here)
  setMeta(doc, 'link[rel="canonical"]', here)
  setMeta(doc, 'meta[property="og:image"]', new URL(`about/og-${code}.png`, root).href)
  setMeta(doc, 'meta[name="twitter:image"]', new URL(`about/og-${code}.png`, root).href)
  setMeta(doc, 'meta[property="og:image:alt"]', alt)
  setMeta(doc, 'meta[property="og:locale"]', ogLocale(code))
  setMeta(doc, 'meta[property="og:locale:alternate"]', ogLocale("en"))

  // This page sits one directory deeper than the assets it shares.
  for (const element of doc.querySelectorAll("[src^='./'], [href^='./']")) {
    const attribute = element.hasAttribute("src") ? "src" : "href"
    element.setAttribute(attribute, `.${element.getAttribute(attribute)}`)
  }

  for (const link of doc.querySelectorAll(".lang__button[lang]")) {
    if (link.lang === code) link.setAttribute("aria-current", "page")
    else link.removeAttribute("aria-current")
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}\n`
}

/**
 * Renders every non-default language.
 *
 * @param aboutDir directory holding index.html, messages.js and the cards
 * @returns `[{ code, html }]`
 */
export async function renderAboutLocales({ aboutDir }) {
  const html = readFileSync(join(aboutDir, "index.html"), "utf8")
  // Node caches a module URL forever, and the dev server calls this again after
  // every edit, so the modification time is part of the URL.
  const messages = pathToFileURL(join(aboutDir, "messages.js"))
  messages.search = `v=${statSync(messages).mtimeMs}`
  const { LOCALES } = await import(messages.href)

  return Promise.all(
    Object.entries(LOCALES).map(async ([code, locale]) => ({
      code,
      html: await renderLocale({
        html,
        code,
        strings: locale.strings,
        alt: cardAlt(aboutDir, code),
      }),
    })),
  )
}

/**
 * Writes every non-default language beside the English page.
 *
 * @param outDir directory to write `<code>/index.html` into (defaults to aboutDir)
 */
export async function buildAboutLocales({ aboutDir, outDir = aboutDir }) {
  const pages = await renderAboutLocales({ aboutDir })
  return pages.map(({ code, html }) => {
    const file = join(outDir, code, "index.html")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, html)
    return file
  })
}

// `node scripts/build-about-locales.mjs [outDir]` for a look at the output.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const aboutDir = fileURLToPath(new URL("../public/about", import.meta.url))
  const written = await buildAboutLocales({ aboutDir, outDir: process.argv[2] })
  console.log(written.join("\n"))
}
