// Types for the CSP derivation, which is plain ESM so that both vite.config.ts
// and the Playwright suite can import it without a build step.

export declare function parseHeadersFile(
  text: string,
): Array<{ pattern: string; headers: Record<string, string> }>

export declare function cspForRootPattern(text: string): string

export declare const META_UNSUPPORTED_DIRECTIVES: readonly string[]

export declare function metaCspFromHeaders(text: string): string
