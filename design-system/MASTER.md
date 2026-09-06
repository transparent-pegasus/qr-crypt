# QR Crypt — Design System MASTER

> **Archive — not current implementation specifications.** Do not use the retired RSA, OCM1, or EC-level selector controls described here as active implementation requirements.
> See [README](README.md) for provenance and the scope of preservation. For the current implementation, see [Source](../src/) and [Tests](../tests/); for its contracts, see the [QR protocol specification](../docs/spec/qr-protocol-v2.md) and [Boot and reset specification](../docs/spec/boot-and-reset-v2.md).

This design record preserves the ui-ux-pro-max-skill output (`design-system/offline-cipher/MASTER.md`, using the 3 search queries from spec §5), adapted to the app's constraints (no external fonts, offline operation, Japanese UI, and mobile-first design), together with subsequent revisions.
At the time, page-specific documents took precedence, and no custom color or spacing tokens were to be added. That precedence and the rules below are historical records and do not govern the current implementation.

## 0. Intentional changes from the generated output

| Generated output | Choice adopted at the time | Reason |
|---|---|---|
| JetBrains Mono (Google Fonts) | System font stack | spec §17/§18 prohibits external fonts and CDNs. Support for Japanese glyphs |
| Monospace throughout | Sans-serif UI body text; monospace technical data | Readability of Japanese body text. Retain the terminal/precision feel in data displays |
| Dark-only palette | Tokens supporting both light and dark | spec §6 dark mode support + WCAG AA |
| Marketing page structure (Hero/Proof/CTA) | Single-column tool layout | This app is a utility PWA. Convey trustworthiness through clear warnings and status displays |

## 1. Style direction

**Exaggerated Minimalism (restrained)**: high contrast, generous whitespace, no decoration, bold headings, minimal elements.
Express the "precision" of a security tool through monospace data displays, orderly grids, and consistent status displays.
Prohibited: playful decoration, purple/pink AI gradients, status conveyed only by color, and emoji icons (use only lucide-react icons).

## 2. Color tokens (mapped to shadcn CSS variables)

The QR code display surface is the sole exception: **always a white background `#FFFFFF` and black cells `#000000`** (fixed even in dark mode; tokens do not apply).

### Light

| Token | Value | Use |
|---|---|---|
| `--background` | `#FFFFFF` | Page background |
| `--foreground` | `#0F172A` | Body text |
| `--card` | `#F8FAFC` | Card surface |
| `--card-foreground` | `#0F172A` | |
| `--popover` / `--popover-foreground` | `#FFFFFF` / `#0F172A` | |
| `--primary` | `#1E3A5F` | Primary buttons, links, and selected states (navy = shield) |
| `--primary-foreground` | `#FFFFFF` | |
| `--secondary` / `--secondary-foreground` | `#E2E8F0` / `#1E293B` | Secondary buttons |
| `--muted` / `--muted-foreground` | `#F1F5F9` / `#475569` | Supporting surfaces and text |
| `--accent` / `--accent-foreground` | `#DCFCE7` / `#14532D` | Hover and emphasis surfaces (green) |
| `--success` / `--success-foreground` | `#15803D` / `#FFFFFF` | Success and online status (AA compliant) |
| `--warning` / `--warning-foreground` | `#B45309` / `#FFFFFF` | Sensitive-content warnings |
| `--destructive` / `--destructive-foreground` | `#DC2626` / `#FFFFFF` | Destructive actions and highly sensitive content |
| `--border` / `--input` | `#E2E8F0` / `#CBD5E1` | |
| `--ring` | `#1E3A5F` | Focus ring |

### Dark

| Token | Value |
|---|---|
| `--background` | `#0F172A` |
| `--foreground` | `#F8FAFC` |
| `--card` / `--card-foreground` | `#131D33` / `#F8FAFC` |
| `--popover` / `--popover-foreground` | `#131D33` / `#F8FAFC` |
| `--primary` / `--primary-foreground` | `#8AB0DE` / `#0B1220` |
| `--secondary` / `--secondary-foreground` | `#1E293B` / `#E2E8F0` |
| `--muted` / `--muted-foreground` | `#1B2540` / `#94A3B8` |
| `--accent` / `--accent-foreground` | `#173420` / `#86EFAC` |
| `--success` / `--success-foreground` | `#22C55E` / `#052E16` |
| `--warning` / `--warning-foreground` | `#F59E0B` / `#451A03` |
| `--destructive` / `--destructive-foreground` | `#DC2626` / `#FFFFFF` |
| `--border` / `--input` | `rgba(255,255,255,0.10)` / `rgba(255,255,255,0.16)` |
| `--ring` | `#8AB0DE` |

Theme switching: `dark` on `documentElement.class`. Default: `system` (follows prefers-color-scheme). Stored only in `localStorage['oc-theme']`.

## 3. Typography

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

| Use | Style |
|---|---|
| Page title (h1) | 1.375rem / 700 / tracking-tight |
| Section heading (h2) | 1.125rem / 600 |
| Body text | 0.9375rem / 400 / leading-relaxed |
| Supporting text and captions | 0.8125rem / `--muted-foreground` |
| Technical data (fingerprints, key IDs, byte counts, payloads) | `--font-mono` / tabular-nums / 0.8125–0.875rem |

Key fingerprints use the format `7392 1840 5521 9074` (4 groups × 4 digits, separated by ASCII spaces, mono, copyable).

## 4. Spacing / shape / elevation / z-index

- Spacing: 4/8/16/24/32/48/64px (`--space-xs..3xl`). Horizontal page padding: 16px. Between sections: 24px.
- Corner radius: cards and dialogs 12px, buttons and inputs 8px, badges 9999px.
- Shadows: sm `0 1px 2px rgba(0,0,0,.05)` / md `0 4px 6px rgba(0,0,0,.1)` / lg `0 10px 15px rgba(0,0,0,.1)` (in dark mode, separate elements with borders rather than relying on shadows).
- z-index scale (no arbitrary values): header `z-20` / bottom navigation `z-30` / dialogs `z-50` / toasts `z-[60]`.

## 5. Layout / navigation

- Single column, `max-width: 28rem`, centered.
- Header: sticky top, app name (left) + network status badge (right). `padding-top: env(safe-area-inset-top)`.
- Bottom content padding: `calc(64px + env(safe-area-inset-bottom) + 16px)` (must not overlap fixed navigation).
- Shared bottom navigation shell: `position: fixed; left:0; right:0; bottom:0; padding-bottom: env(safe-area-inset-bottom);`, height 64px, equal-width items regardless of the number of children. Offline icon navigation has 4 items (Encrypt = `LockKeyhole` `/encrypt`, Decrypt = `LockKeyholeOpen` `/decrypt`, Keys = `KeyRound` `/keys`, Settings = `Settings` `/settings`); the online screen, when eligible, has 2 items (Top = Home, Relay = MessageSquareText). Current item: `aria-current="page"` + `--primary` color + a 2px top indicator. Each item's tap target is ≥44×44px.
- No horizontal scrolling. Long payload strings use `break-all` + `max-h` + a scrollable area.

## 6. Component conventions (based on shadcn/ui)

- **Tap targets**: always pair `select-none touch-manipulation` on Button, TabsTrigger, SelectTrigger, Label, the raw `<label>` for offline acknowledgement, the raw key-row `<button>` in the key list, and the `<summary>` for the density restart warning, to prevent long-press text selection and the double-tap zoom delay. Key rows are primary tap targets, so long-press selection of key names is deliberately disabled; names can be viewed and copied in the detail dialog. Restore `select-text touch-auto` on noninteractive `role="note"` elements styled with `buttonVariants`.
- **Button**: height 44px (default equivalent to `size="lg"`). primary = main actions (encrypt, generate), secondary = supporting actions, destructive = deletion, ghost = inline actions. Icon-only buttons require 44×44 and an `aria-label`. `cursor-pointer`, 150–200ms transitions, `hover:opacity-90`. No transform hover effects that move the layout.
- **Card**: surface = `--card`; prefer borders for separation. Do not lift cards on hover (tool UI; only list rows use `hover:bg-accent`).
- **Input/Textarea**: height 44px (Textarea min-h 120px), font size 16px (prevents iOS zoom), `focus-visible:ring-2 ring-[--ring] ring-offset-2`. Always associate labels with `htmlFor` (do not substitute placeholders for labels).
- **Dialog / AlertDialog**: always confirm destructive or irreversible actions with AlertDialog (no direct execution). Three confirmation strengths: (1) normal = confirmation button; (2) strong = a checkbox labelled with the historical Japanese phrase meaning "I understand the risks" enables the confirmation button; (3) strongest = exact-match entry of the historical Japanese phrase meaning "delete all" enables it. Both phrases here are English translations of historical Japanese UI text; the latter was not a literal English input token. Place the destructive button on the right. Esc/overlay dismissal takes the safe path.
- **Badge (sensitivity)**: Public = `secondary` + Globe / Sensitive = `--warning` surface + ShieldAlert / Highly sensitive = `--destructive` surface + TriangleAlert. **Always include both icon and text** (never color alone). Always show the highly sensitive badge in lists and details.
- **Network status badge**: online = `--success` dot + "Online" / offline = `--muted-foreground` dot + "Offline." **Make no safety claim** (wording such as "Safe because offline" is prohibited, spec §2).
- **Toasts (sonner)**: do not show success toasts for implicit settings autosave; the new value shown by the control is the feedback. Prefer inline `role="alert"` errors (icon + text). While the fullscreen QR dialog covers inline alerts, an error toast may supplement them only for a failure to save the compatibility-mode settings pair. This asymmetry is intentional.
- **QR display**: white panel (padding 16px, fixed white `#FFFFFF`, border `#E2E8F0`, rounded 12px). Default size 512px, `max-width:100%`. Fullscreen uses an entirely white surface, safe-area support on all four sides, and `h-dvh overflow-hidden`; within the remaining space, the QR uses `max-height:100%; width:auto; object-fit:contain`. Fullscreen `Button` elements use `border-slate-300` and are at least 44×44px.
  - For a single-image QR, omit the action row and counter; place a left-aligned, icon-only fullscreen button below the QR. The fullscreen surface shows only the QR and a right-aligned, icon-only close button.
  - For multiple QRs outside fullscreen, use this order: **QR → counter → one action row (previous / pause-play / next / labelled compatibility mode / fullscreen) → one download button**. Previous, pause/play, next, and fullscreen are 44×44px icon-only buttons; retain navigation/playback button names with `sr-only`. Fullscreen also uses QR → counter → the same single row, replacing only the final button with close.
  - Compatibility mode is one switch between the fixed pairs `1000 B / 200 ms` and `100 B / 2000 ms`; density and speed cannot be adjusted separately. Do not add adjustment UI to `/settings` either. Do not show the data-size/EC-level row or a brightness hint.

## 7. Accessibility / motion

- Semantic HTML (`button`/`nav`/`main`/`h1..`). No div+onClick.
- Visible focus is mandatory: `focus-visible:ring-2`. Tab order = visual order.
- Status displays use icon + text (+ a status region with `aria-live="polite"`). Errors use `role="alert"`.
- Dialogs trap focus and initially focus the safe button (radix default).
- Effectively disable transitions/animations under `prefers-reduced-motion: reduce` (global CSS).
- Contrast: at least 4.5:1 for body text (the tokens above meet this).

## 8. Wording and tone

- Polite, definite, short sentences: "You can…" and "Please…"
- Warnings state concrete consequences ("If photographed, screen-shared, or synced to the cloud, it may allow ciphertext to be decrypted").
- Errors give possible causes + the next action. Do not expose internal details or stacks.
- Wording must preserve the premise that an offline indicator reports status and does not guarantee safety.

## 9. Checklist used at the time (historical reference)

- [ ] No emoji icons (lucide only) / [ ] cursor-pointer on clickable elements / [ ] 150–300ms hover effects and transitions
- [ ] AA contrast in both light and dark / [ ] Always-white QR background / [ ] Visible focus / [ ] reduced-motion support
- [ ] No horizontal scrolling at 375px / [ ] Fixed navigation does not hide content / [ ] 44px touch targets / [ ] No status conveyed only by color
- [ ] Confirmation for destructive actions / [ ] Persistent warning for highly sensitive content / [ ] `aria-current`, `htmlFor`, and `role="alert"` applied
