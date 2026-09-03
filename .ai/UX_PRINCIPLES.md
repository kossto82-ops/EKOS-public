# AI Operating System - UX & Visual Design Principles

**Purpose:** This document specifies the visual philosophy, spatial layout standards, typographic hierarchies, and interactive UI rules for the Enterprise Knowledge Platform. It governs CSS and presentation-layer styling.
**Owner:** Staff UX Architect
**Status:** Approved Configuration
**Review Frequency:** Quarterly

---

## 1. Core Visual Principles

Our design system is modeled on leading enterprise products. It rejects unnecessary visual decorations in favor of absolute clarity and high structural legibility.

1. **Whitespace Hierarchy**: Use balanced whitespace to define system layout partitions instead of heavy lines, container borders, or shadows.
2. **Information Density**: Deliver professional-grade density. Allow users to view extensive tabular lists and metadata fields simultaneously without viewport fatigue.
3. **Typography First**: Hierarchy is driven by precise typographic scale, weights, and tracking.
4. **No Dashboard Clutter**: Avoid redundant metrics panels, placeholder pie charts, and unrequested system analytics cards. Focus exclusively on active workspaces.
5. **No Decorative Widgets**: Avoid placing network statuses, system coordinate tables, or mock terminal lines in margins or headers.
6. **No Unnecessary Borders**: Avoid cards-inside-cards layouts. Keep parent containers clean, flat, and borderless.
7. **Professional Enterprise Tone**: Use strict, operational labels. Avoid exclamation points, conversational banter, or promotional language in UI labels and alerts.
8. **Accessibility & Contrast**: Maintain 100% compliance with WCAG 2.1 AA standards for contrast ratios, text scaling, and keyboard focus states.

---

## 2. Layout, Spacing, & Styling Rules

- **The Density Constraint**: At least 35% of the total viewport area on main data views (catalogs, search grids, sync dashboards) must represent functional whitespace. Do not stretch data blocks or compress rows.
- **Rounding Bounds**: Standard components (inputs, buttons, cards, badges) must use a maximum border radius of `6px` (`rounded-md` in Tailwind). Fully rounded pills or spherical shapes are prohibited unless representing individual user avatars.
- **Border Guidelines**: Divider borders must be subtle and thin (`border-[#E2E8F0]`, `border-t`, `border-b`). Do not use dark or heavy outline borders.
- **Grids & Gaps**: Standardize all vertical and horizontal spacing on an 8px grid (`p-2`, `p-4`, `p-8`, `gap-4`, `gap-8`).

---

## 3. Compliance and visual Examples

### Case A: Designing a card component for active document metadata
- *Violation (Consumer Card)*: "Adding a floating card with a heavy drop-shadow (`shadow-xl`), rounded corners (`rounded-2xl`), a colorful gradient border, and an oversized folder icon."
- *Compliance*: "A flat, subtle borderless card on the primary canvas. The header is styled with a semibold small font (`text-slate-900 font-medium`), with metadata aligned in a compact table using monospace numbers for tracking, separated by elegant, low-contrast dividers."

### Case B: Styling the alert toast system
- *Violation (Unstyled/Playful)*: "A large, colorful green box with 'Woohoo! Successfully updated document settings!' and a dancing star icon."
- *Compliance*: "A compact, high-contrast, borderless notification drawer utilizing standard Charcoal backgrounds and clear white text: 'Configuration synchronized successfully.' with a standard, accessible close target."

---

## 4. Future Evolution

With the introduction of multi-theme capabilities in future deployment stages, this system will transition to strict CSS design tokens, ensuring light and dark modes compile cleanly across nested sub-components.

---

## 5. Cross References

- Refer to `docs/DESIGN_SYSTEM.md` for our primary slate palette and typography scale.
- Refer to `.ai/ENGINEERING_STANDARDS.md` for standard component responsibilities.
