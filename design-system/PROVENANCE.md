> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../src/) and [Tests](../tests/); for its contracts, see the [QR protocol specification](../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../docs/spec/boot-and-reset-v2.md).

# design-system generation provenance (ui-ux-pro-max-skill)

Record of carrying out spec §5, "Use of ui-ux-pro-max-skill."

## 1. Skill discovery (in the candidate order from spec §5)

| Candidate | Result |
|---|---|
| `.claude/skills/ui-ux-pro-max/` (repo) | Not found |
| `.cursor/skills/ui-ux-pro-max/` (repo) | Not found |
| `.agents/skills/ui-ux-pro-max/` (repo) | Not found |
| `.windsurf/skills/ui-ux-pro-max/` (repo) | Not found |
| `~/.claude/skills/ui-ux-pro-max/` and other locations directly under home | Not found |
| **Local plugin cache** | **Found and used**: local plugin cache (ui-ux-pro-max 2.11.0) |

- Version used: **2.11.0** (already downloaded locally; not reinstalled from the network)
- SKILL.md read in full: `<plugin>/.claude/skills/ui-ux-pro-max/SKILL.md` (Workflow: Step1 requirements analysis → Step2 `--design-system` → Step3 `--domain` supplements → Step4 `--stack` guidelines)
- Script executed: `<plugin>/src/ui-ux-pro-max/scripts/search.py` (the same implementation as scripts/search.py referenced by SKILL.md; executed using its full path)

## 2. Commands and results (the 3 searches specified in spec §5)

1. `search.py "offline encryption privacy security mobile pwa" --design-system --persist -p "Offline Cipher"`
   → Pattern: Trust & Authority / Style: **Exaggerated Minimalism** (Light/Dark Full support, WCAG AA) / Palette: navy `#1E3A5F` + green `#22C55E` + dark background `#0F172A` ("Shield dark + connected green") / Typography: JetBrains Mono (Google Fonts) / Avoid: Playful, Poor security UX, AI purple-pink gradients.
   **Generated artifact (original)**: `design-system/offline-cipher/MASTER.md` (the skill's persist output saved unchanged)
2. `search.py "mobile bottom navigation qr code form accessibility" --stack react`
   → Semantic HTML (button/nav), mandatory label `htmlFor` (do not use a placeholder as a label), destructured props.
3. `search.py "security key management warning destructive action" --domain ux`
   → Destructive actions require a confirmation dialog (no direct deletion); use a z-index scale (z-10/20/30/50, no arbitrary values).

The full output of search 1 is in the original artifact above; all results from searches 2/3 were incorporated into the finalized version.

## 3. Adoption decisions for the finalized version

The finalized `design-system/MASTER.md` adapted the original as follows (the reasons are also recorded in the table in MASTER.md §0):

- **Adopted**: the palette (navy/green/dark); the high contrast, whitespace, and lack of decoration of Exaggerated Minimalism; the Avoid list; the Pre-Delivery Checklist; mandatory confirmation dialogs; the z-index scale; semantic HTML/`htmlFor`.
- **Changed**: JetBrains Mono (Google Fonts) → **system font stack** (because spec §17/18 prohibits external fonts and CDNs, and to support Japanese glyphs; the terminal/precision feel is retained through monospace data displays). Dark-only → light/dark tokens (spec §6). Marketing page structure → a single-column tool layout (this app is a utility PWA).
- **Added**: an always-white QR surface (spec §6), 3 sensitivity badge levels, 3 confirmation strength levels, and safe-area, 44px touch-target, and reduced-motion rules (spec §6).

Page-specific rules are in `design-system/pages/{encrypt,keys,saved-qr,settings}.md` (the 5-file structure specified by spec §5).

The product was later renamed to Qrypt (2026-07-21), then to QR Crypt (2026-07-25).

## 4. License

The generator plugin, ui-ux-pro-max v2.11.0, is MIT-licensed (Copyright (c) 2024 Next Level Builder). Its persisted output stored in this directory is redistributed under that license.

## 5. Removed archival artifacts (2026-07-25)

For publication, `design-system/offline-cipher/` (the raw persisted generator
output duplicated by the adapted `MASTER.md`) and
`design-system/pages/saved-qr.md` (the spec of the since-removed saved-QR
page) were deleted from the tree. They remain available in git history.
References to those paths in the translated sections above are historical.
