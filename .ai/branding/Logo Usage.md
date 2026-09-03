# EKOS Logo Usage

## The system

All source files live in [`src/assets/brand/`](../../src/assets/brand/) as SVG (no raster masters — raster assets in `public/` are generated from these, see Brand Assets Inventory.md).

| File | Use |
|---|---|
| `ekos-logo-primary.svg` | Horizontal lockup (symbol + wordmark). Default choice for headers, docs, decks. |
| `ekos-logo-secondary.svg` | Stacked lockup. Use in square or near-square placements. |
| `ekos-symbol.svg` | Symbol alone. Use for favicons, app icons, avatars, anywhere the wordmark would be illegible. |
| `ekos-symbol-small.svg` | Symbol with tightened corner radius (rx 2 instead of 4). Use below ~32px — the standard symbol's radius reads as mushy at small sizes. |
| `ekos-logo-light.svg` | Default lockup for light backgrounds. |
| `ekos-logo-dark.svg` | Lockup for dark backgrounds — swaps the foundation/active plane to lighter tints (`#818CF8` / `#A5B4FC`) and the wordmark to `#F8FAFC`. |
| `ekos-logo-mono.svg` / `ekos-symbol-mono.svg` | Single-ink versions using `currentColor`. Use for print, watermarks, or anywhere a single flat color is required. |

## Construction

The symbol is two rounded squares (20×20, `rx=4`, 8-unit diagonal offset) in a 40×40 viewBox — a "foundation" plane (`#312E81`) under an "active" plane (`#4F46E5`). The union of the two forms a stepped silhouette that stays legible with no internal detail loss, because it's built from two flat rectangles rather than fine linework.

## Clear space & minimum size

- Keep clear space around the mark equal to at least the width of the foundation plane's offset (8 viewBox units, i.e. ~20% of the symbol's width) on all sides.
- Do not use the symbol below 16px. Below 32px, always use `ekos-symbol-small.svg`, not `ekos-symbol.svg`.
- Do not scale the wordmark lockups below a cap-height of ~11px — the "EKOS" text stops being legible before the symbol does.

## Do

- Use the mono version on busy photographic or textured backgrounds.
- Use the dark version on any surface darker than `slate-800`.
- Preserve the exact 2-plane color relationship (foundation always sits under/behind active) — it's the whole visual idea.

## Don't

- Don't recolor the two planes to anything outside the approved light/dark/mono variants.
- Don't add a drop shadow, glow, gradient fill, or bevel to the mark.
- Don't rotate, skew, or invert the plane offset direction.
- Don't place the wordmark lockup on a background that doesn't meet WCAG AA contrast against the wordmark ink color.
- Don't recreate the wordmark in a different typeface — it's Inter Bold, matching the app's own type stack, not a custom display face.

## Social / OG image

`public/og-image.png` (1200×630) treats the symbol as the hero and renders "EKOS" as a small monospace caption rather than a large logotype. This is deliberate: without a font-rendering pipeline available at generation time, a large hand-rasterized wordmark read as retro/8-bit and broke consistency with the real Inter wordmark used everywhere else. If this asset is regenerated with real typography (e.g. via a headless-browser render pipeline), the large-wordmark layout can be revisited — see Future Branding Roadmap.md.
