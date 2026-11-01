import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

export function precacheManifest(outDir) {
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(outDir, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .filter(
      (url) =>
        /\.(js|css|html|svg|png|wasm|webmanifest)$/.test(url) &&
        !url.startsWith("about/") &&
        url !== "sw.js" &&
        !url.split("/").some((segment) => segment.startsWith(".")),
    )
    .sort()
    .map((url) => ({
      url,
      revision: createHash("sha256")
        .update(readFileSync(join(outDir, url)))
        .digest("hex"),
    }))
}
