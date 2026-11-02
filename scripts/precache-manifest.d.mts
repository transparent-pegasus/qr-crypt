export interface PrecacheEntry {
  url: string
  revision: string
}

export declare function precacheManifest(outDir: string): PrecacheEntry[]
