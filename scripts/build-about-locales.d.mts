// Types for the landing page's per-language build, which is plain ESM so that
// `node scripts/build-about-locales.mjs` stays runnable on its own.

export declare function parseDocument(html: string): Promise<Document>

export declare function renderLocale(options: {
  html: string
  code: string
  strings: Record<string, string>
  alt: string
}): Promise<string>

export declare function renderAboutLocales(options: {
  aboutDir: string
}): Promise<{ code: string; html: string }[]>

export declare function buildAboutLocales(options: {
  aboutDir: string
  outDir?: string
}): Promise<string[]>
