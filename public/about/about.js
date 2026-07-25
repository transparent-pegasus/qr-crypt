// Landing-page language handling.
//
// Every language is its own document, generated at build time from index.html
// and messages.js, so the switcher is a pair of ordinary links and the page
// reads completely without JavaScript. This file only decides where a visitor
// who has not asked for a language should land, and remembers the one they
// pick. An address that names a language is a choice: on a translated page
// nothing below the switcher's click handler runs.
//
// Deliberately does NOT share the app's "oc-lang" localStorage key: this page is
// same-origin with the app, and the app's boot and wipe paths own that key.

const STORAGE_KEY = "qrc-about-lang"

const links = [...document.querySelectorAll(".lang__button[lang]")]
const hrefFor = (code) => links.find((link) => link.lang === code)?.href

for (const link of links) {
  link.addEventListener("click", () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, link.lang)
    } catch {
      // Private mode. The link still works; only the memory of it is lost.
    }
  })
}

// The default document is the one the x-default alternate points at. Comparing
// paths rather than whole URLs keeps that true on a preview host as well.
const fallback = document.querySelector('link[rel="alternate"][hreflang="x-default"]')
const isDefaultDocument =
  fallback && new URL(fallback.href).pathname === window.location.pathname

function preferredLocale() {
  // Links to ?lang=xx were handed out before each language had its own path.
  const requested = new URLSearchParams(window.location.search).get("lang")
  if (requested && hrefFor(requested)) return requested

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && hrefFor(stored)) return stored
  } catch {
    // Private mode or file:// — fall through to the browser's own preference.
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).split("-")[0]
    if (hrefFor(base)) return base
  }
  return document.documentElement.lang
}

if (isDefaultDocument) {
  const wanted = preferredLocale()
  if (wanted !== document.documentElement.lang) {
    // replace, not assign: a page nobody asked for should not sit in history.
    window.location.replace(hrefFor(wanted) + window.location.hash)
  }
}
