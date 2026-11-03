export declare const RELAY_ALLOWED_SOURCES: readonly string[]
export declare const RELAY_ALLOWED_PACKAGES: readonly string[]
export declare const RELAY_ALLOWED_VIRTUAL_IDS: readonly string[]
export declare const RELAY_ALLOWED_QUERY_IMPORTS: readonly {
  readonly path: string
  readonly query: string
}[]
export declare const RELAY_ALLOWED_OUTPUT: readonly string[]
export declare const RELAY_ALLOWED_URL_ORIGINS: readonly {
  readonly origin: string
  readonly reason: string
}[]
export declare const RELAY_ALLOWED_URL_TEMPLATES: readonly {
  readonly template: string
  readonly reason: string
}[]

export declare function findRelayBundleViolations(
  moduleIds: Iterable<string>,
  repoRoot: string,
): string[]

export declare function findRelayOutputViolations(
  files: Iterable<{ fileName: string; text?: string }>,
): string[]
