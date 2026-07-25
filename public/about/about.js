// Landing-page translation swap.
//
// English is whatever index.html already says, captured here on load, so the
// English wording exists in exactly one place. Other languages come from
// messages.js. Without JavaScript the page still reads completely — in English.
//
// Deliberately does NOT share the app's "oc-lang" localStorage key: this page is
// same-origin with the app, and the app's boot and wipe paths own that key.

import { DEFAULT_LOCALE, LOCALES } from "./messages.js"

const STORAGE_KEY = "qrc-about-lang"

// data-i18n replaces text content; these hooks replace the named attribute.
const ATTRIBUTE_HOOKS = {
  "data-i18n-alt": "alt",
  "data-i18n-label": "aria-label",
  "data-i18n-content": "content",
}

function textNodes() {
  return document.querySelectorAll("[data-i18n]")
}

/** English baseline, read straight out of the served document. */
function collectEnglish() {
  const english = new Map()
  for (const el of textNodes()) {
    english.set(el.getAttribute("data-i18n"), el.textContent.replace(/\s+/g, " ").trim())
  }
  for (const [hook, attribute] of Object.entries(ATTRIBUTE_HOOKS)) {
    for (const el of document.querySelectorAll(`[${hook}]`)) {
      english.set(el.getAttribute(hook), el.getAttribute(attribute) ?? "")
    }
  }
  return english
}

function apply(code, english) {
  const strings = LOCALES[code]?.strings
  // Fall back to English for anything a translation has not covered yet.
  const read = (key) => strings?.[key] ?? english.get(key) ?? ""

  for (const el of textNodes()) {
    el.textContent = read(el.getAttribute("data-i18n"))
  }
  for (const [hook, attribute] of Object.entries(ATTRIBUTE_HOOKS)) {
    for (const el of document.querySelectorAll(`[${hook}]`)) {
      el.setAttribute(attribute, read(el.getAttribute(hook)))
    }
  }
  document.documentElement.lang = code
}

function known(code) {
  return code === DEFAULT_LOCALE.code || code in LOCALES
}

function preferredLocale() {
  const requested = new URLSearchParams(window.location.search).get("lang")
  if (requested && known(requested)) return requested

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && known(stored)) return stored
  } catch {
    // Private mode or file:// — fall through to the browser's own preference.
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).split("-")[0]
    if (known(base)) return base
  }
  return DEFAULT_LOCALE.code
}

function remember(code) {
  try {
    window.localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Persistence is best effort; the page in front of you still switched.
  }
  const url = new URL(window.location.href)
  if (code === DEFAULT_LOCALE.code) url.searchParams.delete("lang")
  else url.searchParams.set("lang", code)
  window.history.replaceState(null, "", url)
}

function renderSwitcher(container, active) {
  const entries = [
    [DEFAULT_LOCALE.code, DEFAULT_LOCALE.label],
    ...Object.entries(LOCALES).map(([code, locale]) => [code, locale.label]),
  ]
  container.replaceChildren(
    ...entries.map(([code, label]) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "lang__button"
      button.lang = code
      button.textContent = label
      button.setAttribute("aria-pressed", String(code === active))
      button.addEventListener("click", () => select(code))
      return button
    }),
  )
}

const english = collectEnglish()
const container = document.getElementById("lang")

function select(code) {
  apply(code, english)
  remember(code)
  renderSwitcher(container, code)
}

select(preferredLocale())
