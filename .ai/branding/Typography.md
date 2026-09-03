# EKOS Typography

## Typefaces

| Role | Typeface | Loaded via |
|---|---|---|
| UI / body / headings | **Inter** (400, 500, 600, 700) | Google Fonts, preconnected + `media="print" onload` swap in `index.html` |
| Data, code, labels, captions | **JetBrains Mono** (400, 500, 700) | Same Google Fonts block |

Both are declared as Tailwind theme fonts in `src/index.css`:

```css
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
```

Fallback stacks are real fallbacks (`ui-sans-serif`/`ui-monospace`/`system-ui`), not just `sans-serif` — if the Google Fonts request fails, the app still renders with a reasonable system font rather than the browser default serif.

## Why this pairing

Inter is neutral and highly legible at UI sizes without personality that competes with content — appropriate for an enterprise tool where the knowledge content is the star, not the chrome. JetBrains Mono is used deliberately (not just for actual code) as a signal: uppercase mono labels ("QUICK ACTIONS", "BRAND: SECRETARÍA.ES") read as system-level metadata, distinct from primary content set in Inter. This distinction — mono for data/system labels, Inter for content and actions — is a real information-hierarchy tool, not decoration.

## Usage rules

- **Never use JetBrains Mono for primary reading content** (document bodies, answers, descriptions). It's for labels, IDs, timestamps, status tags, and code-like values only.
- **Uppercase + mono + wide tracking** is the established pattern for section eyebrows and table headers (see `TableHeaderCell` in `DesignSystem.tsx`). Don't introduce a second eyebrow style.
- **Weight carries hierarchy before size does.** The app's type scale is compressed (most UI text is `text-xs`/`text-[10px]`/`text-[11px]`) — hierarchy comes from `font-bold`/`font-semibold` vs `font-medium`, not from large size jumps. This is intentional density suited to an information-dense enterprise tool; don't introduce large display sizes into the working UI (they belong on marketing/landing surfaces only, if EKOS ever has one).
- **Logo wordmark is Inter Bold**, letter-spacing `-0.3`, matching the app's own font stack exactly — there is no separate display/logotype face. This keeps the logo visually continuous with in-product headings rather than looking like a pasted-on sticker.

## What to avoid

- Introducing a third typeface for any reason (marketing decks, presentations, etc. should still use Inter + JetBrains Mono).
- Using letter-spacing tricks or all-caps on body-length text — reserved for short labels only.
- Variable font-weight animation or "typewriter" effects — inconsistent with the "precise, composed" personality.
