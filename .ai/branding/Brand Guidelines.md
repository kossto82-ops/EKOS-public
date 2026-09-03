# EKOS Brand Guidelines

**EKOS — Enterprise Knowledge Operating System.** This is the top-level entry point for the brand system; the other files in this folder go deep on one topic each.

## In one paragraph

EKOS is the operating system enterprises trust to turn scattered knowledge into governed, actionable intelligence. The identity communicates trust, intelligence, enterprise-readiness, simplicity, knowledge, precision, and longevity — deliberately avoiding both startup clichés (playful mascots, bouncy corners) and AI clichés (brains, circuits, chat-bubble logos, rainbow gradients). It should still look correct in ten years.

## The system at a glance

| Element | Summary | Full doc |
|---|---|---|
| Symbol | Two overlapping rounded squares ("foundation" + "active" plane), abstract reference to layered/structured knowledge | [Logo Usage.md](./Logo%20Usage.md) |
| Accent color | `brand-600` `#4F46E5` — one accent, used with restraint | [Color Palette.md](./Color%20Palette.md) |
| Typefaces | Inter (UI/content) + JetBrains Mono (data/labels) | [Typography.md](./Typography.md) |
| Icons | Lucide React, stroke-only, default weight | [Iconography.md](./Iconography.md) |
| Radius | Sharp — 2–4px across the whole scale | [Design Principles.md](./Design%20Principles.md) |
| Elevation | Cool-neutral, low-opacity shadows (slate-900 tint) | [Color Palette.md](./Color%20Palette.md) |

## The one rule that matters most

**This is a multi-tenant product.** EKOS's own brand identity (the symbol, `brand-*`/`success-*`/`warning-*`/`danger-*` tokens, Inter/JetBrains Mono) governs the *platform chrome* — navigation, buttons, system status, the loading screen. It must never be confused with, or overridden by, the *tenant* identities the platform hosts (14 brands like northwind_de, Northwind Bureau, Secretaría.es) or the *category* color-coding used for departments. Those are business data with their own palettes (see Color Palette.md's "What is explicitly NOT part of this palette" section) — changing them is a product/data decision, not a branding one, and vice versa: never migrate tenant/category colors into the brand token system just because they happen to reuse a hue.

## Where things live

```
src/assets/brand/        vector source files (SVG)
public/                  generated favicons, manifest, OG image
src/index.css            design tokens (@theme block)
src/components/shared/DesignSystem.tsx   shared Button/Input/Select/Card/EmptyState
.ai/branding/            this documentation set
```

## Read next

- Rolling out the identity in a new part of the product? Start with [Design Principles.md](./Design%20Principles.md).
- Placing the logo somewhere new? Read [Logo Usage.md](./Logo%20Usage.md) first — there are hard rules about minimum size and clear space.
- Adding a new UI state or component? Check [Color Palette.md](./Color%20Palette.md) for the right semantic token before reaching for a raw Tailwind color.
- Wondering what's deliberately unfinished? See [Future Branding Roadmap.md](./Future%20Branding%20Roadmap.md).
- Need the full list of what's shipped and where? See [Brand Assets Inventory.md](./Brand%20Assets%20Inventory.md).
