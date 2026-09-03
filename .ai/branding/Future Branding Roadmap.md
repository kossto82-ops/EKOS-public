# EKOS Future Branding Roadmap

Things intentionally deferred during the initial rebrand, with the reasoning so a future contributor doesn't have to rediscover it.

## 1. Product mark in the sidebar/header — Resolved 2026-07-06

The EKOS symbol now appears in `Header.tsx`, at the far left, before the tenant `BrandBadge`: **product mark → divider → tenant badge → breadcrumb**. This makes product identity the outermost, constant element of the chrome, with the active tenant/brand shown as the "current scope" inside it — the same pattern as a workspace switcher sitting beside a constant product logo. The sidebar's top slot was deliberately left untouched: it's already the tenant-brand switcher, and duplicating the product mark there would just repeat the same identity twice for no benefit.

Implementation note: the mark is inlined as a component (`src/components/shared/EkosMark.tsx`), not loaded via `<img src>`, because `currentColor` (the mono variant) only resolves against surrounding text color when the SVG is inlined in the DOM. It mirrors a new source file, `src/assets/brand/ekos-symbol-small-mono.svg` (rx=2, sub-32px sizing per Logo Usage.md, `currentColor` fill) — this combination (small + mono) didn't exist yet in the asset set and has been added alongside the existing `ekos-symbol-small.svg` (color) and `ekos-symbol-mono.svg` (default radius).

## 2. OG image typography

`public/og-image.png` was generated with a hand-written, dependency-free rasterizer (no sharp/ImageMagick/headless-browser available in the build environment). The large-scale pixel-font wordmark looked retro/8-bit, so the layout was changed to make the symbol the hero with "EKOS" as a small monospace caption instead — a deliberate, shipped decision, not a placeholder. If a proper rendering pipeline becomes available (e.g. a headless-browser screenshot step, or `sharp`/`resvg` as a build dependency), revisit whether a large, properly-typeset Inter wordmark should replace the current caption-led layout.

*Reconfirmed 2026-07-06: `sharp` and `puppeteer` are still absent from the environment (`node -e "require.resolve(...)"` fails for both). Still genuinely blocked, not re-deferred by choice — adding either as a new build dependency just to regenerate one image is a call for whoever owns the build/deploy pipeline, not a UI branding fix.*

## 3. Absolute OG image URL

`og:image`/`twitter:image` are currently root-relative (`/og-image.png`). The OpenGraph spec technically wants an absolute URL, and most crawlers are lenient about resolving relative paths against the page URL, but this should be hardened to an absolute URL once the deployment domain is known (this is a single-tenant-of-infrastructure app without a fixed public domain today).

*Reconfirmed 2026-07-06: no domain is configured anywhere in the repo (`package.json`, env files, code) to promote this to an absolute URL — still genuinely blocked on information only whoever owns the deployment has, not something to guess at.*

## 4. `metadata.json` — Resolved 2026-07-06

Root-level `metadata.json`'s `name`/`description` now match the EKOS branding (previously `"Customer Service Operations"`, a pre-rebrand leftover). Before changing it, confirmed no code, build script, or CI step in this repo reads the file (`grep -rn "metadata.json"` only turns up mentions in these branding docs) — it's platform metadata read externally (e.g. by AI Studio's own tooling), not something the app's build depends on. Since the two fields are plain descriptive text with no schema other systems parse structurally, updating them to stay consistent with the rest of the branding (README, `package.json`, `index.html`) carried no discovered risk. If a deployment pipeline is later found to key off the exact previous string, that's a sign this file has a second owner outside this repo — flag it then.

## 5. Mechanical color-token migration, remaining scope

Phase 6 renamed `indigo-*`/`rose-*`/`emerald-*`/`amber-*` to `brand-*`/`danger-*`/`success-*`/`warning-*` across all genuine UI-chrome usage. Two files were deliberately excluded because their colors are business/tenant data, not brand tokens (`BrandBadge.tsx`, `assistantQuickActions.ts`), along with `brandUtils.ts`, `departments.ts`, and `kb.ts`. If new UI chrome is added, use the semantic tokens from day one — don't reach for raw `indigo-600` again.

## 6. Illustration system

No illustration system exists (see Iconography.md). If empty states, onboarding, or marketing surfaces later need illustration, define the style then, rather than pre-building a system with no real usage to validate it against.

## 7. Reusability of this documentation set

This `.ai/branding/` folder was written to be a template for future projects, not just an EKOS record. When starting a new project's brand system, copy the *structure* (Design Principles → Logo Usage → Color Palette → Typography → Iconography → Assets Inventory → Roadmap) and the *process* (audit existing touchpoints first, define strategy, design the mark, wire browser branding, formalize tokens, sweep the whole app, document last) — but treat every actual value (hex codes, typeface choices, file paths) as project-specific, not something to carry over.
