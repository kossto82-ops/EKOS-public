# EKOS Color Palette

All tokens are defined in [`src/index.css`](../../src/index.css) under `@theme` (Tailwind v4 CSS-first config). Adding a color here automatically generates the matching `bg-*`/`text-*`/`border-*`/`ring-*` utilities — there is no separate `tailwind.config.js`.

## Brand accent — `brand-*`

The single accent color, reserved for primary actions and active/selected state. Full 50–950 ramp defined; in practice `400`–`700` cover almost all usage.

| Token | Hex | Typical use |
|---|---|---|
| `brand-50` / `100` | `#eef2ff` / `#e0e7ff` | Tinted backgrounds behind accent content |
| `brand-400` | `#818cf8` | Accent on dark surfaces |
| `brand-500` | `#6366f1` | Focus rings |
| `brand-600` | `#4f46e5` | Primary buttons, active nav state, primary text links |
| `brand-700` | `#4338ca` | Hover state for `600` |
| `brand-900` | `#312e81` | The logo's "foundation" plane |

## Semantic colors

Carry meaning. Never repurpose these as decoration, and never use the brand accent to signal success/warning/danger.

| Role | Token family | Core shade | Hex |
|---|---|---|---|
| Success | `success-*` | `success-600` | `#059669` |
| Warning | `warning-*` | `warning-600` | `#d97706` |
| Danger / destructive | `danger-*` | `danger-600` | `#e11d48` |
| Informational | `info-*` (500/600 only) | `info-600` | `#2563eb` |

## Neutrals

The app uses Tailwind's stock `slate` scale directly (not re-tokenized) as the neutral backbone — `slate-50`/`slate-900`/`slate-950` for light/dark surfaces, `slate-200`/`slate-800` for hairline borders. This was already consistent pre-rebrand and didn't need a formal token layer.

## What is explicitly NOT part of this palette

This is a multi-tenant product. Two categories of color in the codebase are **business data, not brand tokens**, and must never be aliased into `brand-*`/`success-*`/`warning-*`/`danger-*`:

1. **Tenant identity colors** — `src/utils/brandUtils.ts` and the shortcode-based mapping in `src/components/shared/BrandBadge.tsx` (e.g. violet for `ES`, blue for `FR`, emerald for `DE`). These distinguish one tenant brand from another and have nothing to do with EKOS's own visual identity.
2. **Category/department colors** — `src/constants/departments.ts` and `src/utils/assistantQuickActions.ts` (e.g. orange for Sales, violet for Legal). These are a fixed color-per-category coding scheme, not semantic state.

If a future contributor sees `emerald-500` used somewhere in the app, check whether it's inside one of these two files before assuming it should be renamed to `success-500` — it may be deliberately excluded.

## Elevation (shadows)

Tailwind's `--shadow-xs` through `--shadow-2xl` are overridden with a cool, low-opacity neutral tint (`rgba(15, 23, 42, …)`, i.e. `slate-900`) instead of the framework default near-black. This was chosen because a pure-black shadow reads heavier/more "consumer app"; the slate tint reads calmer and more engineered, consistent with the rest of the palette.

Elevation is used with intent, already consistent app-wide pre-rebrand:

- `shadow-xs` — resting state for buttons, small cards
- `shadow-md` / `lg` — dropdowns, popovers, sticky bars
- `shadow-xl` / `2xl` — modals, drawers, dialogs
