import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

export function precacheManifest(outDir) {
  const urls = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile()) urls.push(relative(outDir, file).split(sep).join("/"))
    }
  }
  walk(outDir)

  return urls
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
