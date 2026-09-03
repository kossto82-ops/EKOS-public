# EKOS Iconography

## Library

[Lucide React](https://lucide.dev) — used exclusively across the app, at its default 2px stroke weight. An audit during the Phase 6 polish pass confirmed zero components override `strokeWidth`, so this is already fully consistent; keep it that way.

## Why Lucide

Lucide's stroke-only, geometric style matches the brand's "precision over decoration" principle — no filled/duotone icons, no inconsistent corner treatment between icons from different sets. Mixing icon libraries (or mixing filled and outline styles from the same library) is the fastest way to make a product feel unfinished; don't do it.

## Usage rules

- **Stroke weight is always the Lucide default.** Don't pass a custom `strokeWidth` prop — if an icon needs to feel heavier/lighter, that's a signal to reconsider size or color, not stroke weight.
- **Icon color follows the same semantic rules as everything else**: `brand-*` for interactive/primary icons, `success-*`/`warning-*`/`danger-*` for status icons, `slate-*` for neutral/decorative icons. Never a raw hex value.
- **Icon size is tied to text size**, not arbitrary: `h-3 w-3`/`h-3.5 w-3.5` alongside `text-[10px]`/`text-xs` UI, scaling up only for empty-state or hero icon placements.
- **No icon-as-logo substitution.** A Lucide icon (e.g. `Sparkles`, used on the Assistant tab) is never a stand-in for the EKOS symbol — the two are visually distinct namespaces and should stay that way to avoid diluting the mark.

## Illustration style

EKOS currently has **no illustration system** — no spot illustrations, empty-state art, or onboarding graphics exist in the product today. If one is introduced:

- Match the mark's own geometric language: flat fills, no gradients, no soft rounded "friendly" character illustration.
- Prefer abstract geometric compositions (in the spirit of the logo's overlapping-planes idea) over literal/representational drawings of people, devices, or documents.
- Use the semantic/brand palette only — don't introduce illustration-only colors.
- Empty states today use a single muted Lucide icon (e.g. `EmptyState` in `DesignSystem.tsx`) rather than illustration — this is the current standard and a perfectly acceptable permanent choice; illustration should only be added with clear purpose, not as decoration.
