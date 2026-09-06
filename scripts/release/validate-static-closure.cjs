const fs = require("node:fs");
const path = require("node:path");

const fail = (message) => {
  throw new Error(`static closure validation failed: ${message}`);
};
const requireFile = (url) => {
  const clean = url.split(/[?#]/, 1)[0];
  if (!clean.startsWith("/") || clean === "/") return;
  const relative = clean.slice(1);
  if (
    relative.includes("\\") ||
    relative.split("/").includes("..") ||
    !fs.statSync(path.join("dist", relative), {
      throwIfNoEntry: false,
    })?.isFile()
  ) {
    fail(`missing or unsafe root-relative asset ${url}`);
  }
};

const index = fs.readFileSync("dist/index.html", "utf8");
for (const match of index.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  requireFile(match[1]);
}

const manifest = JSON.parse(
  fs.readFileSync("dist/manifest.webmanifest", "utf8"),
);
if (
  manifest.start_url !== "/" ||
  manifest.scope !== "/" ||
  manifest.display !== "standalone"
) {
  fail("manifest must be a standalone PWA deployed at an origin root");
}
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  fail("manifest has no icons");
}
for (const icon of manifest.icons) requireFile(String(icon.src));

const serviceWorker = fs.readFileSync("dist/sw.js", "utf8");
if (
  /(?:\burl|["']url["'])\s*:\s*["']\/?reachability-sentinel\.txt["']/.test(
    serviceWorker,
  )
) {
  fail("reachability sentinel is present in the precache manifest");
}
