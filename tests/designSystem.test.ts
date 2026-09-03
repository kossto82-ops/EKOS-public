/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Drift guards for the design-system consolidation cycle.
 *
 * The AI Review Board scored Design Quality 60/100 for one reason: the shared
 * primitives in src/components/shared/DesignSystem.tsx had almost no adoption in
 * the tab layer, so the same UI concept had been rebuilt several ways. It called
 * that compounding debt. Consolidating once does not fix compounding — the next
 * feature rebuilds the same thing again unless something fails when it does.
 * That is what this file is for.
 *
 * Two kinds of assertion here, and the difference matters:
 *
 *   - **Closed**: a convention that now has exactly one implementation. The guard
 *     fails if a second one appears anywhere.
 *   - **Ratcheted**: a convention still fragmented, where the guard pins the
 *     current count so the debt cannot grow while it waits its turn. Lowering
 *     the number is a deliberate act with a commit behind it; raising it fails.
 *
 * A ratchet is an admission, not a pass. Each one names what is still owed.
 */

const SRC = path.resolve(__dirname, '../src');
const DESIGN_SYSTEM = 'components/shared/DesignSystem.tsx';

/** Read with fs rather than shelling out to grep: grep and ripgrep apply
 *  binary-file heuristics and skip files silently, which would turn a guard into
 *  a no-op over exactly the file it should have caught. */
function sources(): { file: string; text: string }[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });
  return walk(SRC).map((f) => ({
    file: path.relative(SRC, f).replace(/\\/g, '/'),
    text: fs.readFileSync(f, 'utf8'),
  }));
}

const all = sources();
const outsideDesignSystem = all.filter((s) => s.file !== DESIGN_SYSTEM);

describe('design system — the scan itself', () => {
  it('reads a plausible number of component files', () => {
    // Without this, a broken walk empties every set below and all of it passes
    // by vacuum while claiming the debt is gone.
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((s) => s.file === DESIGN_SYSTEM)).toBe(true);
  });
});

describe('design system — Badge (closed)', () => {
  /** The solid badge: the convention Badge was derived from, which was already
   *  used byte-identically in five places before it existed. */
  const SOLID_BADGE = (text: string) =>
    /className=[^>]*text-5xs[^>]*rounded-sm|className=[^>]*rounded-sm[^>]*text-5xs/.test(text);

  it('has exactly one implementation of the solid badge', () => {
    const offenders = outsideDesignSystem.filter((s) => SOLID_BADGE(s.text)).map((s) => s.file);
    expect(
      offenders,
      `These files hand-roll the solid badge (text-5xs + rounded-sm) instead of ` +
        `importing Badge from shared/DesignSystem:\n` +
        offenders.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });

  /**
   * className expressions, with template interpolation flattened.
   *
   * The first version of this guard matched the outline size and `rounded-sm` only
   * when they sat next to each other inside one quoted run, and excluded
   * backticks. That missed every badge whose size is chosen by a ternary — which
   * is most non-trivial ones — so it reported zero offenders while
   * BrandBadge.tsx sat there splitting exactly those tokens across a `${...}`.
   * Removing the interpolation punctuation makes the whole expression one
   * searchable blob and closes that blind spot.
   */
  function classNameExpressions(text: string): string[] {
    return (text.match(/className=(?:\{`[\s\S]*?`\}|"[^"]*"|\{[^}]*\})/g) ?? []).map((m) =>
      m.replace(/\$\{|\}/g, ' ')
    );
  }

  // BrandBadge used to be listed here as a KNOWN_SIBLING_SURFACES exception:
  // a named, reusable component with its own brand-colour logic, granted a
  // pass because it looked like a deliberate sibling rather than a copy of
  // the status badge. It composes Badge (appearance="outline" + variant=
  // "inherit", the same pattern the header's runtime-coloured chip already
  // used) now, so the exception is gone rather than re-justified.

  it('has exactly one implementation of the bordered outline badge', () => {
    // The second family, closed in the same cycle: 9px, font-mono, bordered.
    // It was a deliberate second weight rather than a fifth variation, so Badge
    // grew an `appearance="outline"` instead of the four sites being flattened
    // onto the solid one.
    const offenders = outsideDesignSystem
      .filter((s) =>
        classNameExpressions(s.text).some(
          (expr) =>
            /\brounded-(?:sm|xs|md)\b/.test(expr) &&
            /\bborder\b/.test(expr) &&
            /\btext-(?:4xs|3xs)\b/.test(expr) &&
            /\buppercase\b/.test(expr)
        )
      )
      .map((s) => s.file);
    expect(
      offenders,
      `These files hand-roll the outline badge instead of ` +
        `<Badge appearance="outline">:\n` +
        offenders.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });

  it('offers an uncoloured variant, so runtime-coloured chips need no hand-rolling', () => {
    // The header's chip takes its colour from the active brand at runtime. Without
    // variant="inherit" that call site cannot use the primitive without shipping
    // palette classes an inline style immediately overrides — which is how a
    // "just this one place" copy of the treatment gets born.
    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    expect(ds).toMatch(/inherit:\s*["'`]["'`]/);
    expect(ds).toMatch(/appearance\?:\s*'solid'\s*\|\s*'outline'/);
  });

  it('exports Badge with the variants its call sites rely on', () => {
    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    expect(ds).toMatch(/export const Badge/);
    for (const variant of ['success', 'warning', 'danger', 'brand', 'neutral']) {
      expect(ds, `Badge is missing the '${variant}' variant`).toMatch(
        new RegExp(`${variant}:\\s*["'\`]`)
      );
    }
  });
});

describe('design system — EmptyState (closed)', () => {
  it('has exactly one implementation of the empty state', () => {
    // A dashed border around a centred column was the tell in all four
    // hand-rolled versions. Only the primitive draws one now.
    const offenders = outsideDesignSystem
      .filter((s) => s.text.includes('border-dashed'))
      .map((s) => s.file);
    expect(
      offenders,
      `These files draw their own empty state instead of importing EmptyState ` +
        `from shared/DesignSystem:\n` + offenders.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });

  it('is actually adopted, which was the Board\'s complaint', () => {
    // The audit's finding was not that the primitive was wrong, it was that it
    // had zero consumers. An assertion that it exists would have passed the whole
    // time it went unused.
    const consumers = outsideDesignSystem.filter((s) => /\bEmptyState\b/.test(s.text)).map((s) => s.file);
    expect(consumers.length, 'EmptyState has no consumers again').toBeGreaterThanOrEqual(4);
  });

  it('does not hardcode a heading level for its title', () => {
    // It used to render <h4>, and the first screen migrated onto it failed axe's
    // heading-order rule: a shared primitive cannot know how deep it will be
    // mounted. The title element is a prop defaulting to a non-heading, so the
    // default can never break the document outline.
    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    expect(ds).toMatch(/titleAs\?:\s*'h2'\s*\|\s*'h3'\s*\|\s*'h4'\s*\|\s*'p'/);
    expect(ds).toMatch(/titleAs:\s*TitleTag = 'p'/);
    expect(ds, 'EmptyState renders a fixed <h4> again').not.toMatch(/<h4 className="text-xs font-bold text-slate-800/);
  });

  it('does not pulse its icon', () => {
    // A pulsing icon reads as loading, and an empty state is the settled answer
    // that there is nothing to load. It also made the settle condition in
    // tests/fullScreenAccessibility.test.tsx unsatisfiable, since that waits for
    // .animate-pulse to clear before auditing.
    // Match the icon element itself rather than the surrounding text — the
    // comment explaining this decision names the class, and a naive search over
    // the region would trip on the explanation instead of the code.
    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    const iconRender = ds.match(/\{Icon && <Icon className="[^"]*"/);
    expect(iconRender, 'EmptyState no longer renders its icon the expected way').not.toBeNull();
    expect(iconRender![0]).not.toMatch(/animate-pulse/);
  });
});

describe('design system — outstanding debt (ratcheted)', () => {
  it('does not grow the count of hand-rolled tables in the tab layer', () => {
    // Stage 3 migrated three of the four known sites (DocumentMetricsView,
    // SettingsTab, SyncIndexingTab) onto TableContainer/TableHead/TableBody,
    // which already handle the role="region" accessible-name nuance correctly.
    // GovernanceQueueTable.tsx is the deliberate holdout: it implements a
    // bespoke composite-grid pattern (role="table"/"row"/"columnheader"/"cell",
    // aria-rowcount, a sticky thead, colgroup-driven fixed column widths, and
    // roving-focus keyboard navigation via aria-activedescendant on an ancestor
    // scroll container it does not own). TableContainer would nest a second
    // focusable, ARIA-labelled scroll region inside that ancestor's — doubling
    // the tab stop and the axe "region" landmark — and its default thead/tr/td
    // styling would collide with the sticky positioning and the highlight/
    // selection background classes computed per row. Ratchet lowered to 1.
    const sites = outsideDesignSystem
      .filter((s) => s.file.startsWith('components/tabs/') && s.text.includes('<table'))
      .map((s) => s.file);
    expect(
      sites,
      `Hand-rolled <table> markup in the tab layer. Expected only GovernanceQueueTable.tsx ` +
        `after stage 3; a new one means a fresh, unmigrated table convention:\n` +
        sites.map((f) => `  - src/${f}`).join('\n')
    ).toHaveLength(1);
  });


});

describe('design system — micro type scale (closed)', () => {
  it('has no arbitrary pixel font sizes left', () => {
    // 245 of them across five sizes, so the same label role was 9px on one screen
    // and 10px on another with nothing recording which was meant.
    const offenders = all
      .filter((s) => /text-\[\d+px\]/.test(s.text))
      .map((s) => s.file);
    expect(
      offenders,
      `Arbitrary font sizes are back. Use a named step from the micro scale in ` +
        `src/index.css (text-2xs / 3xs / 4xs / 5xs):\n` +
        offenders.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });

  it('defines exactly the four steps that are in use', () => {
    // Four rather than the two or three the design review asked for, and the
    // reason is load-bearing: 5xs and 4xs are Badge's solid and outline weights,
    // a distinction made deliberately when that component was consolidated.
    // Collapsing them would undo it. A fifth step means a size was invented.
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    const steps = (css.match(/--text-\dxs:\s*\d+px;/g) ?? []).sort();
    expect(steps, 'the micro scale changed shape').toEqual([
      '--text-2xs: 11px;',
      '--text-3xs: 10px;',
      '--text-4xs: 9px;',
      '--text-5xs: 8px;',
    ]);
  });

  it('keeps the two badge weights on different steps', () => {
    // The specific thing the four-step floor exists to protect.
    //
    // Matched against the geometry expression rather than a whole base-class
    // string. The earlier version pinned the exact literal, which is how a `lg`
    // size first arrived as `!text-xs !px-2.5` — !important in a shared primitive
    // purely so this regex would not have to change. A guard that dictates the
    // shape of the code it watches has stopped being a guard.
    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    const geometry = ds.match(/const geometry =[\s\S]*?;/)?.[0] ?? '';
    expect(geometry, 'Badge no longer composes its geometry in one place').not.toBe('');
    expect(geometry, 'the outline badge should sit on text-4xs').toMatch(
      /appearance === 'outline'[\s\S]*?text-4xs/
    );
    expect(geometry, 'the solid badge should sit on text-5xs').toMatch(/text-5xs/);
  });

  it('sizes by composition, not by out-specifying itself', () => {
    // !important on a shared primitive makes every future caller override
    // unpredictable, which is the same failure the outline border colour already
    // had. Badge picks one set of geometry classes per size instead.
    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    const code = ds.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    expect(code, 'Badge is using !important to beat its own base classes').not.toMatch(/!(?:text|px|py|gap)-/);
  });
});

describe('design system — overlays and stacking order (closed)', () => {
  it('draws one scrim, from one place', () => {
    // Six had grown for one concept: slate-950 at 45/65, 40/60, 30/60, 30/40, a
    // 40 with no dark pair and no blur, and one on slate-900/20 entirely. Which
    // one you got depended on which surface opened.
    const offenders = outsideDesignSystem
      .filter((s) => /inset-0[^"'`]*bg-slate-9\d{2}\/\d+|bg-slate-9\d{2}\/\d+[^"'`]*inset-0/.test(s.text))
      .filter((s) => s.file !== 'components/shared/IdleLockScreen.tsx')
      .map((s) => s.file);
    expect(
      offenders,
      `These files hand-roll a backdrop instead of composing OVERLAY_SCRIM from ` +
        `shared/DesignSystem:\n` + offenders.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });

  it('keeps the lock screen heavier than the dialog scrim, on purpose', () => {
    // The one intentional exception, asserted rather than merely commented: a
    // lock screen has to obscure rather than dim, and has to outrank dialogs.
    // Match the root element's className, not the file: the comment explaining
    // why this surface opts out names OVERLAY_SCRIM, and a file-wide search trips
    // on the explanation rather than the code. Third time that has bitten a guard
    // in this file — assert on the expression, never the prose around it.
    const lock = all.find((s) => s.file === 'components/shared/IdleLockScreen.tsx')!.text;
    const root = lock.match(/className=\{`fixed inset-0[^`]*`\}/)?.[0] ?? '';
    expect(root, 'could not find the lock screen root className').not.toBe('');
    expect(root).toMatch(/bg-slate-950\/90/);
    expect(root).toMatch(/\$\{LOCKSCREEN_Z\}/);
    expect(root, 'the lock screen should not use the ordinary dialog scrim').not.toMatch(/OVERLAY_SCRIM/);
  });

  it('has two stacking layers, both named, and no arbitrary z outside the primitive', () => {
    const stray = outsideDesignSystem
      .filter((s) => /z-\[\d+\]/.test(s.text))
      .map((s) => s.file);
    expect(
      stray,
      `Arbitrary z-index values outside DesignSystem. Blocking surfaces use ` +
        `OVERLAY_Z, and only the lock screen uses LOCKSCREEN_Z:\n` +
        stray.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);

    // Scoped deliberately, after a re-audit pointed out that the assertion above
    // only ever policed bracket syntax. Popovers, dropdowns and the toast layer
    // hand-type `z-50` and are NOT covered by it — they sit at the same level as
    // dialogs by coincidence rather than by sharing the token, and if OVERLAY_Z
    // ever changes they will not follow. That is a real gap, and naming it here is
    // the honest half of the fix; the other half is the assertion below, which
    // holds the surfaces that genuinely block the page to the shared token.
    const blockingWithLiteralZ = outsideDesignSystem
      .filter((s) => /aria-modal/.test(s.text))
      .filter((s) => /className=[^>]*\bz-50\b/.test(s.text))
      .map((s) => s.file);
    expect(
      blockingWithLiteralZ,
      `These files declare a modal surface but hardcode z-50 instead of ` +
        `composing OVERLAY_Z, so they will not follow if the dialog layer moves:\n` +
        blockingWithLiteralZ.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);

    const ds = all.find((s) => s.file === DESIGN_SYSTEM)!.text;
    expect(ds).toMatch(/export const OVERLAY_SCRIM = /);
    expect(ds).toMatch(/export const OVERLAY_Z = /);
    expect(ds).toMatch(/export const LOCKSCREEN_Z = /);
  });
});
