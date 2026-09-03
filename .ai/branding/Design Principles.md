# EKOS Design Principles

## Brand mission

EKOS (Enterprise Knowledge Operating System) is the operating system enterprises trust to turn scattered knowledge into governed, actionable intelligence. It behaves like infrastructure, not a demo: quietly reliable, precise, and built to still look correct in ten years.

## Brand personality

Precise, composed, institutional-modern. Closer to a terminal or a Bloomberg workstation than a consumer AI product — confident without needing decoration.

## Brand attributes → what they mean in the product

| Attribute | Design consequence |
|---|---|
| Trust | Fixed, deliberate palette. No gradients used as decoration. Consistent icon weight everywhere. |
| Intelligence | Typographic precision — monospace for data/IDs/labels, tabular numerals where digits line up. |
| Enterprise | Neutral, restrained base; the accent color is a signal, not a background. |
| Simplicity | One accent color doctrine. Geometry over ornament in the mark. |
| Knowledge | The mark references structure and layering, not a brain or a chat bubble. |
| Precision | Sharp, consistent corner radius; 1px hairline borders; nothing "soft" by default. |
| Longevity | Flat, well-proportioned geometry. No trend-driven gradients or glassmorphism. |

## What EKOS explicitly avoids

- Brain / neuron / circuit-board imagery for anything "AI"
- Chat-bubble-as-logo
- Rainbow / multi-stop AI gradients
- Generic startup clichés: bouncy corners, playful mascots, oversized emoji as UI
- Decoration that doesn't encode information (numbered steps where there's no real sequence, icons that don't map to a concrete meaning)

## Visual principles

1. **One accent, used with restraint.** The brand indigo is reserved for primary actions and active/selected states — never for large background fills or decoration.
2. **Neutrals do the heavy lifting.** The slate scale carries almost all of the UI; color is reserved for meaning.
3. **Sharp geometry.** Tight radii (2–4px), no "friendly" pill-shaped default buttons.
4. **Typography-led hierarchy.** Weight and size differences over icon decoration when establishing hierarchy.
5. **Symbols must survive miniaturization.** Any mark must remain legible and unambiguous at 16px before it ships.
6. **Semantic color is not the accent.** Success/warning/danger colors carry meaning and must never be reused for decoration or vice versa.
7. **Business/tenant data keeps its own palette.** In a multi-tenant product, tenant- or category-driven colors (e.g. per-brand or per-department color coding) are data, not brand identity — they must never be aliased to the semantic or accent tokens, and the reverse is also true.

## How this was applied in EKOS

- The symbol ("Layered Planes") is two overlapping rounded squares — an abstract reference to structured, layered knowledge, not a literal letterform or a brain/circuit cliché.
- Border radius across the app was already sharp (2–4px) before the rebrand; this was formalized as canon rather than replaced, because it already matched the "precision over friendliness" principle.
- Elevation (shadows) uses a cool, low-opacity neutral tint (slate-900 base) instead of pure black, which reads calmer and more "engineered."
