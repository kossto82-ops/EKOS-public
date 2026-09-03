# EKOS Brand Assets Inventory

Snapshot as of the Phase 1–6 rebrand (see Future Branding Roadmap.md for what's intentionally deferred). Update this file whenever a branding touchpoint is added, moved, or regenerated.

## Vector sources — `src/assets/brand/`

| File | Purpose |
|---|---|
| `ekos-symbol.svg` | Master symbol, 40×40 viewBox |
| `ekos-symbol-small.svg` | Symbol tuned for <32px use (tighter radius) |
| `ekos-symbol-mono.svg` | Symbol, `currentColor` fill |
| `ekos-symbol-small-mono.svg` | Symbol tuned for <32px use, `currentColor` fill — added 2026-07-06 for the header product mark (see Header touchpoint below) |
| `ekos-logo-primary.svg` | Horizontal lockup, light background |
| `ekos-logo-secondary.svg` | Stacked lockup |
| `ekos-logo-light.svg` | Lockup, light background (same as primary) |
| `ekos-logo-dark.svg` | Lockup, dark background |
| `ekos-logo-mono.svg` | Lockup, `currentColor` fill |

## Generated raster assets — `public/`

All generated from the vector sources by a one-off Node script (no external image tooling was available in this environment — no sharp/ImageMagick/canvas — so a small dependency-free PNG/ICO encoder was hand-written using only Node's built-in `zlib`). If sharp or ImageMagick become available, these can be regenerated more conventionally; the visual output should not change.

| File | Size(s) | Source of truth |
|---|---|---|
| `favicon.svg` | vector | `ekos-symbol.svg` |
| `favicon.ico` | 16, 32, 48px (PNG-in-ICO) | rasterized from symbol geometry |
| `apple-touch-icon.png` | 180×180 | rasterized from symbol geometry |
| `icon-192.png` / `icon-512.png` | 192×192 / 512×512 | rasterized from symbol geometry, referenced by `site.webmanifest` |
| `mask-icon.svg` | vector | `ekos-symbol-mono.svg` (Safari pinned-tab icon) |
| `og-image.png` | 1200×630 | symbol + programmatically-drawn monospace caption (see Logo Usage.md for why it isn't a large wordmark) |
| `site.webmanifest` | — | PWA manifest, name/short_name/icons/theme_color |

## Wired touchpoints

| Touchpoint | Location | Status |
|---|---|---|
| Browser tab title | `index.html` `<title>` | ✅ "EKOS — Enterprise Knowledge Operating System" |
| Favicon | `index.html` `<link rel="icon">` (SVG + ICO fallback) | ✅ |
| Apple touch icon | `index.html` `<link rel="apple-touch-icon">` | ✅ |
| Safari pinned tab | `index.html` `<link rel="mask-icon">` | ✅ |
| PWA manifest | `index.html` `<link rel="manifest">` + `public/site.webmanifest` | ✅ |
| Theme color (mobile chrome) | `index.html` `<meta name="theme-color">` | ✅ `#0B0B1A` |
| OpenGraph / social preview | `index.html` `og:*` + `twitter:*` meta | ✅ (image path is root-relative — see Roadmap) |
| Meta description | `index.html` | ✅ |
| Loading screen | `src/App.tsx` (unauthenticated state) | ✅ symbol + "EKOS" |
| Header product mark | `src/components/layout/Header.tsx` via `src/components/shared/EkosMark.tsx` | ✅ Added 2026-07-06 — inlined `currentColor` mark, far left, before the tenant `BrandBadge` (see Roadmap §1) |
| Sidebar top slot | `src/components/layout/Sidebar.tsx` | Intentionally left as tenant-brand switcher only — no product mark, to avoid duplicating identity already resolved in the header (see Roadmap §1) |
| `package.json` name/description | `package.json` | ✅ `"ekos"` |
| README title | `README.md` | ✅ |
| Design tokens | `src/index.css` `@theme` | ✅ brand/success/warning/danger scales, elevation |

## Known non-branding leftovers (checked, deliberately not touched)

- `metadata.json` (repo root) — updated 2026-07-06 to the EKOS name/description after confirming no code, build, or CI step in this repo reads the file (see Roadmap §4).
- `src/constants/kb.ts` — contains the old product name inside *simulated document content* (seed data for the knowledge base demo), not UI chrome. Leave as-is; it's fixture data, not branding.
- Git history — commit messages and the prior `docs/CHANGELOG.md` (since consolidated into `docs/DECISIONS.md`) reference the old name. History is a record of the past and should not be rewritten.
