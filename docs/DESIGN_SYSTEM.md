# Enterprise Design System & Styling Guide

**Purpose:** This document establishes the design language, styling tokens, typography pairings, color systems, and interactive UI specifications for the Enterprise Knowledge Platform. It maintains alignment with React and Tailwind styles.
**Owner:** Staff UX Architect / Lead Front-End Engineer
**Last Updated:** 2026-06-26
**Status:** Approved Template

---

## 1. Color System (Enterprise Slate Palette)

Colors are chosen strictly for data readability, accessibility, and professional appearance.

| Color Token | Usage / Semantic Role | CSS / Tailwind Class Example | Contrast Ratio |
| :--- | :--- | :--- | :--- |
| **Canvas Background** | Primary workspace canvas | `bg-[#FAF9F6]` | 12:1 against charcoal text |
| **Primary Text** | Standard headings, body copy | `text-[#1E293B]` | 10:1 against canvas |
| **Secondary Text** | Secondary meta labels, descriptors | `text-[#64748B]` | 5.5:1 against canvas |
| **Border Slate** | Grid lines, system partitions | `border-[#E2E8F0]` | N/A |
| **Brand Accent** | Focal visual elements, primary status | `bg-[#0F172A]` | 8.5:1 against white |
| **Success Emerald** | Verified status, safe metrics | `text-[#15803D]` | 4.8:1 against light green |
| **Error Crimson** | Blocked status, system error states | `text-[#B91C1C]` | 5.2:1 against light red |

---

## 2. Typography Scale and Pairings

Our typography strategy enforces clean readability across structured lists and technical tables.

- **Primary Font**: **Inter** (sans-serif) - Standard interface font for standard buttons, inputs, form labels, and body paragraphs.
- **Technical/Data Font**: **JetBrains Mono** or **SFMono** - Standard font for technical metadata, document version markers, IDs, chunk offsets, and database performance SLAs.
- **Display Headings**: **Inter** or **Space Grotesk** - Reserved for top-level headers and section dividers (using slight letter-spacing reductions).

| Token Name | Element Tag | Font Family | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Display Header** | `h1` | Sans | 24px | 600 (Semibold) | 32px | -0.02em |
| **Section Title**| `h2` | Sans | 18px | 500 (Medium) | 24px | -0.01em |
| **Standard Body**| `p`, `span` | Sans | 14px | 400 (Regular) | 20px | 0 |
| **Meta Label** | `span`, `code`| Mono | 12px | 500 (Medium) | 16px | +0.01em |

### 2.1 The micro scale, below `text-xs`

Dense enterprise surfaces need type smaller than Tailwind's 12px floor. That need
was met for a long time with arbitrary values, and 245 of them accumulated across
five sizes — so the same label role rendered at 9px on one screen and 10px on
another with nothing recording which was intended. They are now four named steps
in `src/index.css`:

| Step | Size | Used for |
| :--- | :--- | :--- |
| `text-2xs` | 11px | Secondary body text in dense panels |
| `text-3xs` | 10px | Eyebrow labels, metadata rows — the workhorse |
| `text-4xs` | 9px | Outline badges, table meta |
| `text-5xs` | 8px | Solid status badges |

Four rather than the two or three a design review asked for, and the reason is
load-bearing: `5xs` and `4xs` are `Badge`'s solid and outline weights, a
distinction made deliberately when that component was consolidated. Collapsing
them would undo it.

No paired line-height on any step, on purpose. The app inherits a unitless 1.5
ratio, so line-height already scales with font size — an 8px label computes 12px
on its own. Pinning a length would freeze it.

`tests/designSystem.test.ts` fails if an arbitrary `text-[Npx]` reappears
anywhere, and if the two badge weights ever land on the same step.

---

## 3. Interactive UI Components

1. **Standard Buttons**: Max 4px rounding (`rounded-md`). Minimum tap size of 40px in height. Background transitions on hover should be subtle (e.g. `duration-150`).
2. **Metadata Badges**: Rendered with solid backgrounds, light neutral shades, and high-contrast text tags.
3. **Tables**: Zero cell borders inside standard lists; separate rows using subtle horizontal dividers (`border-b border-slate-100`). Header rows must use bold text and contrast coloring against cell contents.

### 3.1 Use the primitives — this is enforced, not advised

`src/components/shared/DesignSystem.tsx` is the single implementation of each of
these. A design review scored this area 60/100 because the primitives existed and
almost nothing in the tab layer imported them, so the same concept had been
rebuilt several ways: four badge treatments, four empty states, five hand-rolled
tables, six dialog backdrops, and the arbitrary type sizes above. A consolidation
cycle closed each one, and `tests/designSystem.test.ts` guards them so the next
feature cannot quietly rebuild one.

| Concept | Primitive | What the guard fails on |
| :--- | :--- | :--- |
| Status chip | `Badge` (`solid` \| `outline`, plus `size="lg"`) | A second hand-rolled badge anywhere |
| "Nothing here" | `EmptyState` | A dashed-border centred column outside the primitive |
| Data table | `TableContainer` + `TableHead`/`Body`/`Row`/`Cell` | A new hand-rolled `<table>` in `tabs/` |
| Blocking surface | `OVERLAY_SCRIM`, `OVERLAY_Z`, `LOCKSCREEN_Z` | A hand-rolled backdrop, or an arbitrary z-index |

Three things about `Badge` that are easy to get wrong:

- `variant="inherit"` supplies **no colour at all**, border included. It exists for
  chips coloured at runtime — the header's brand chip takes its colour from the
  active brand via inline styles, which no fixed palette can express. The outline
  appearance deliberately withholds `border-current` under `inherit`, because
  adding it put the primitive in a same-specificity fight with the caller's own
  `border-*` class, and Tailwind resolves that by stylesheet emission order rather
  than by the order written in JSX — the rendered border colour was undefined.
- Size composes; it does not override. An earlier `size="lg"` used `!important` to
  beat the base classes and the guard now fails if that returns. `!important` in a
  shared primitive makes every future caller override unpredictable.
- `TableContainer` claims `role="region"` **only** when given an accessible name,
  because an unnamed region is itself an axe violation.

Two documented exceptions, both deliberate rather than forgotten:
`GovernanceQueueTable` keeps its hand-rolled table because it is a bespoke grid
with roving focus inside a parent scroll region that already owns the tab stop,
and migrating it would nest a second focusable region inside the first.
`BrandBadge` is a named component that now composes `Badge` rather than
duplicating it.
