// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import fs from 'node:fs';
import path from 'node:path';

import { LocaleProvider } from '../src/context/LocaleContext';
import { AuthProvider } from '../src/context/AuthContext';
import { BrandProvider } from '../src/context/BrandContext';
import { DepartmentProvider } from '../src/context/DepartmentContext';
import { BreadcrumbProvider } from '../src/context/BreadcrumbContext';
import { GovernancePanelProvider } from '../src/components/tabs/kb/GovernancePanelContext';

import { Header } from '../src/components/layout/Header';
import { Sidebar } from '../src/components/layout/Sidebar';
import { PolicyManager } from '../src/components/tabs/governance/PolicyManager';
import { ReportIssueModal } from '../src/components/tabs/copilot/ReportIssueModal';
import { ShareResourceModal } from '../src/components/tabs/copilot/ShareResourceModal';
import { SourceDetailModal } from '../src/components/tabs/copilot/SourceDetailModal';
import { FullDocumentDrawer } from '../src/components/tabs/copilot/FullDocumentDrawer';
import { IdleLockScreen } from '../src/components/shared/IdleLockScreen';
import { DocumentDetailDrawer } from '../src/components/tabs/kb/DocumentDetailDrawer';
import { DocumentAuditProfileDrawer } from '../src/components/tabs/kb/DocumentAuditProfileDrawer';
import { GovernanceReviewDrawer } from '../src/components/tabs/kb/GovernanceReviewDrawer';
import { GovernanceDispatchModal } from '../src/components/tabs/kb/GovernanceDispatchModal';
import { GovernanceSandboxModal } from '../src/components/tabs/kb/GovernanceSandboxModal';

import type { KBDocument, ReviewTask } from '../src/types';

/**
 * Dialog-level accessibility gate.
 *
 * tests/accessibility.test.tsx scans Modal.tsx as an isolated primitive and
 * tests/fullScreenAccessibility.test.tsx scans six tab screens in their
 * settled default state. Neither ever opens a dialog, so between them they
 * covered every dialog in the app only in the case where it was closed. That
 * is how PolicyManager shipped a hand-rolled <div role="dialog"> with no focus
 * trap, no Escape handling and its own overlay geometry while CI stayed green
 * (fixed in bfb41b4; found by review, not by a test).
 *
 * Two layers here, because the interaction tests alone would not have caught
 * it either — nobody writes an interaction test for a dialog they did not know
 * bypassed the shared shell:
 *
 *   1. A static conformance guard over the source tree. Any component that
 *      declares dialog semantics must delegate focus management to
 *      useFocusTrap. This needs no fixture, no render and no maintenance as
 *      dialogs are added, and it fails on the *next* hand-rolled dialog
 *      whether or not anyone remembers to extend layer 2.
 *
 *   2. axe over each dialog while it is open, plus the focus trap exercised
 *      with real Tab and Shift+Tab keypresses. This catches what the static
 *      rule cannot: a dialog that names the hook and is still inaccessible.
 *
 * What layer 1 does NOT catch, stated because a gate trusted beyond its reach
 * is worse than no gate at all. It is a text search, so it misses a dialog
 * whose role is built dynamically (`role={someVar}`) and never appears as a
 * literal. It sees the hook's name, not its wiring, so on its own it would pass
 * a `useFocusTrap()` whose ref is never attached — the ref-attachment rule
 * below narrows that, and layer 2's Tab assertions close it for the eleven
 * dialogs that exist today. New dialogs get layer 1's coverage automatically
 * and layer 2's only when someone adds them here.
 *
 * On jsdom and focus: `offsetParent` is always null without a layout engine, so
 * useFocusTrap's visibility filter discards every candidate and the hook falls
 * back to focusing the container. Under that fallback a dialog with no trap
 * logic at all is indistinguishable from a working one — asserting "something
 * inside has focus" would pass for both. The shim below restores the code path
 * a browser actually takes, so Tab cycling is observable and the assertions
 * mean what they say.
 */

// ---------------------------------------------------------------------------
// Layer 1 — static conformance guard
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, '../src');

/** Read with fs rather than shelling out to a grep: ripgrep and grep apply
 *  binary-file heuristics and skip silently, and a guard that skips a file
 *  without saying so is the failure mode this whole suite exists to remove. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Declares dialog semantics: the element claims to be a modal dialog, so a
 *  keyboard user must not be able to leave it while it is open. */
const DECLARES_DIALOG = /aria-modal|role=["'{]?\s*["']?dialog/;

describe('Dialog conformance — static guard over src/', () => {
  const sources = walk(SRC).map((file) => ({
    file: path.relative(SRC, file).replace(/\\/g, '/'),
    text: fs.readFileSync(file, 'utf8'),
  }));

  const dialogFiles = sources.filter((s) => DECLARES_DIALOG.test(s.text));

  it('finds the dialog surfaces at all', () => {
    // Without this, a broken walk or a changed attribute style would empty the
    // set and every assertion below would pass by vacuum.
    expect(sources.length).toBeGreaterThan(50);
    expect(dialogFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('every component declaring dialog semantics traps focus', () => {
    const offenders = dialogFiles
      .filter((s) => !s.text.includes('useFocusTrap'))
      .map((s) => s.file);

    expect(
      offenders,
      `These files declare role="dialog"/aria-modal but never call useFocusTrap, so a ` +
        `keyboard or screen-reader user can tab out of them into the page behind:\n` +
        offenders.map((f) => `  - src/${f}`).join('\n') +
        `\n\nUse the shared <Modal> (src/components/shared/Modal.tsx) instead of ` +
        `hand-rolling the shell, or call useFocusTrap directly if the surface is a ` +
        `slide-over panel rather than a centered dialog.`
    ).toEqual([]);
  });

  it('every dialog attaches the focus trap it asked for', () => {
    // Naming the hook is not using it. useFocusTrap returns a ref and does
    // nothing at all until that ref reaches an element, so a call whose return
    // value is never attached passes the rule above while leaving the dialog
    // exactly as trapped as it was before — which is to say not at all.
    const offenders = dialogFiles
      .filter((s) => s.text.includes('useFocusTrap'))
      .filter((s) => {
        const assigned = s.text.match(/(?:const|let)\s+(\w+)\s*=\s*useFocusTrap/);
        if (!assigned) return true; // called but the ref was discarded outright
        return !new RegExp(`ref=\\{\\s*${assigned[1]}\\b`).test(s.text);
      })
      .map((s) => s.file);

    expect(
      offenders,
      `These files call useFocusTrap but never attach the ref it returns, so the ` +
        `hook's effect finds no container and silently does nothing:\n` +
        offenders.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });

  it('reports what it cannot see', () => {
    // A dialog whose role is computed rather than written is invisible to a text
    // search. If one ever appears, this is the assertion that should have caught
    // it — so it fails loudly here instead of being a comment nobody reads.
    const dynamicRole = sources
      .filter((s) => /role=\{(?!['"]?\s*(?:dialog|button|region|none|presentation|alert))/.test(s.text))
      .filter((s) => /aria-modal|Modal|Drawer|Dialog/.test(s.file) || /aria-modal/.test(s.text))
      .map((s) => s.file);

    expect(
      dynamicRole,
      `These dialog-ish files set role from an expression, so the static guard ` +
        `cannot classify them and they must be covered by an interaction test in ` +
        `this file instead:\n` + dynamicRole.map((f) => `  - src/${f}`).join('\n')
    ).toEqual([]);
  });


  it('every dialog that traps focus also labels itself', () => {
    // A trapped dialog a screen reader cannot name is still a dead end.
    const offenders = dialogFiles
      .filter((s) => !/aria-labelledby|aria-label/.test(s.text))
      .map((s) => s.file);
    expect(offenders, `Dialog surfaces with no accessible name: ${offenders.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — axe and focus containment over each dialog while open
// ---------------------------------------------------------------------------

function mockFetch() {
  const jsonResponse = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => jsonResponse({ success: true, data: [] }))
  );
}

function renderInApp(ui: React.ReactElement) {
  return render(
    <LocaleProvider>
      <AuthProvider>
        <BrandProvider>
          <DepartmentProvider>
            <BreadcrumbProvider>{ui}</BreadcrumbProvider>
          </DepartmentProvider>
        </BrandProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}

/** Mirrors useFocusTrap's own selector so the test agrees with the hook about
 *  what counts as focusable. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function expectFocusTrapped(dialog: HTMLElement) {
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  expect(focusables.length, 'the dialog rendered no focusable control at all').toBeGreaterThan(0);

  if (focusables.length === 1) {
    // With a single control, "wrapping" lands back on the same element whether
    // or not a handler ran, so cycling proves nothing. What still separates a
    // real trap from an unguarded dialog is that the hook calls preventDefault
    // on Tab: fireEvent returns false when the default was prevented, and an
    // unguarded dialog would let the browser move focus onward.
    const only = focusables[0];
    only.focus();
    const notPrevented = fireEvent.keyDown(only, { key: 'Tab' });
    expect(
      notPrevented,
      'Tab was not intercepted in a single-control dialog, so focus would leave it'
    ).toBe(false);
    expect(document.activeElement).toBe(only);
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  // Forward off the last control must wrap to the first, not leave the dialog.
  // With no keydown handler attached, focus simply stays on `last` and this
  // fails — which is what distinguishes a real trap from a one-off .focus().
  last.focus();
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(
    document.activeElement,
    'Tab off the last control did not wrap to the first — focus is not trapped'
  ).toBe(first);

  // And backwards off the first must wrap to the last.
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(
    document.activeElement,
    'Shift+Tab off the first control did not wrap to the last — focus is not trapped'
  ).toBe(last);
}

async function expectAccessibleDialog(container: Element) {
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog, 'no element with role="dialog" rendered — the dialog never opened').not.toBeNull();

  // Where focus landed on open, then whether it can be driven out with Tab.
  const active = document.activeElement;
  expect(
    dialog === active || dialog!.contains(active),
    'focus is outside the open dialog on open, so a keyboard user starts outside it'
  ).toBe(true);
  expectFocusTrapped(dialog!);

  const results = await axe.run(container, {
    // jsdom has no layout engine, so contrast cannot be computed here — see
    // docs/ACCESSIBILITY.md for the manual process that covers it.
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}

const doc: KBDocument = {
  id: 'doc-1',
  name: 'Refund Policy.pdf',
  type: 'pdf',
  status: 'trained',
  scope: 'global',
  departmentScope: 'global',
  category: 'Compliance',
  content: 'Refunds are available within 14 days of purchase.',
  uploadedAt: '2026-01-15T09:00:00.000Z',
  uploadedBy: 'admin',
  approvalStatus: 'Approved',
  version: '1.0',
};

const task: ReviewTask = {
  id: 'task-1',
  documentName: 'Refund Policy.pdf',
  feedbackType: 'Outdated',
  agentQuery: 'refund after the cooling-off period',
  messageContent: 'The stated window no longer matches the current terms.',
  status: 'Pending Review',
  createdAt: '2026-02-01T09:00:00.000Z',
  owner: 'Operations Manager',
  department: 'customer_service',
  priority: 'High',
  aiConfidence: 0.82,
};

const noop = () => {};
const asyncNoop = async () => true;

/** Every member of GovernancePanelContextValue, so the dispatch and sandbox
 *  modals render against the real context rather than a partial cast. */
const governanceCtx = {
  reviewTasks: [task],
  saveReviewTasks: noop,
  updateDocumentApproval: noop,
  selectedTaskIds: [],
  setSelectedTaskIds: noop,
  highlightedIndex: 0,
  setHighlightedIndex: noop,
  activeReviewTask: null,
  setActiveReviewTask: noop,
  handleTransitionTask: noop,
  handleReviewActionExecuted: noop,

  activeSandboxGap: { id: 'gap-1', query: 'refund after the cooling-off period' },
  setActiveSandboxGap: noop,
  sandboxFilename: 'addendum.md',
  setSandboxFilename: noop,
  sandboxContent: 'Draft addendum content.',
  setSandboxContent: noop,
  sandboxOwner: 'Operations Manager',
  setSandboxOwner: noop,
  sandboxScope: 'global' as const,
  setSandboxScope: noop,
  handleSaveSandboxAddendum: noop,

  activeDispatchTask: task,
  setActiveDispatchTask: noop,
  dispatchOwnerName: 'Operations Manager',
  setDispatchOwnerName: noop,
  dispatchDepartment: 'customer_service',
  setDispatchDepartment: noop,
  dispatchPriority: 'High' as const,
  setDispatchPriority: noop,
  dispatchNotes: '',
  setDispatchNotes: noop,
  handleOpenDispatchPortal: noop,
  handleSaveDispatchAction: noop,
};

beforeAll(() => {
  // jsdom implements no layout, so offsetParent is null for every element and
  // useFocusTrap's visibility filter discards all candidates — the hook then
  // falls back to focusing its container and its Tab handler short-circuits on
  // an empty list. Under that fallback a dialog with no trap logic whatsoever
  // is indistinguishable from a working one. Reporting the parent element
  // restores the branch a browser actually takes, which is the only way the
  // cycling assertions above test anything.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

beforeEach(() => {
  localStorage.clear();
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Dialog accessibility — opened, not merely mounted', () => {
  it('PolicyManager: the New Policy dialog, opened the way a user opens it', async () => {
    // The one dialog driven through its real trigger rather than rendered
    // open: this is the defect that reached CI green, so the test reproduces
    // the actual path to it.
    const { container, findByRole } = renderInApp(<PolicyManager />);
    const trigger = await findByRole('button', { name: /new policy/i });
    fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    await expectAccessibleDialog(container);
  });

  it('PolicyManager: Escape closes the New Policy dialog', async () => {
    const { container, findByRole } = renderInApp(<PolicyManager />);
    fireEvent.click(await findByRole('button', { name: /new policy/i }));
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });

  it('ReportIssueModal', async () => {
    const { container } = renderInApp(
      <ReportIssueModal
        reportCategory="Outdated"
        setReportCategory={noop}
        reportDetails="The refund window is wrong."
        setReportDetails={noop}
        onSubmit={noop}
        onClose={noop}
      />
    );
    await expectAccessibleDialog(container);
  });

  it('ShareResourceModal', async () => {
    const { container } = renderInApp(
      <ShareResourceModal
        shareUrl="https://ekos.internal/doc/doc-1"
        copiedLink={false}
        onCopyLink={noop}
        onClose={noop}
      />
    );
    await expectAccessibleDialog(container);
  });

  it('SourceDetailModal', async () => {
    const { container } = renderInApp(
      <SourceDetailModal
        source={{ name: 'Refund Policy.pdf', fileExt: 'pdf' }}
        document={doc}
        onClose={noop}
        onDownload={noop}
      />
    );
    await expectAccessibleDialog(container);
  });

  it('FullDocumentDrawer', async () => {
    const { container } = renderInApp(
      <FullDocumentDrawer
        searchResult={null}
        sourceDocument={doc}
        onClose={noop}
        onCopyFullText={noop}
      />
    );
    await expectAccessibleDialog(container);
  });

  it('IdleLockScreen', async () => {
    const { container } = renderInApp(<IdleLockScreen onUnlock={noop} />);
    await expectAccessibleDialog(container);
  });

  it('DocumentDetailDrawer', async () => {
    const { container } = renderInApp(
      <DocumentDetailDrawer doc={doc} onClose={noop} canEdit canManage onSave={asyncNoop} />
    );
    await expectAccessibleDialog(container);
  });

  it('DocumentAuditProfileDrawer', async () => {
    const { container } = renderInApp(
      <DocumentAuditProfileDrawer selectedDoc={doc} setSelectedDoc={noop} documents={[doc]} />
    );
    await expectAccessibleDialog(container);
  });

  it('GovernanceReviewDrawer', async () => {
    const { container } = renderInApp(
      <GovernanceReviewDrawer
        task={task}
        tasksList={[task]}
        onClose={noop}
        onActionExecuted={noop}
        onNavigate={noop}
        currentIndex={0}
        totalTasks={1}
      />
    );
    await expectAccessibleDialog(container);
  });

  it('GovernanceDispatchModal', async () => {
    const { container } = renderInApp(
      <GovernancePanelProvider value={governanceCtx}>
        <GovernanceDispatchModal />
      </GovernancePanelProvider>
    );
    await expectAccessibleDialog(container);
  });

  it('GovernanceSandboxModal', async () => {
    const { container } = renderInApp(
      <GovernancePanelProvider value={governanceCtx}>
        <GovernanceSandboxModal />
      </GovernancePanelProvider>
    );
    await expectAccessibleDialog(container);
  });

  // Header's profile switcher and Sidebar's brand/department selectors: all
  // three declare role="dialog" and hard-trap focus via useFocusTrap, which
  // passes layer 1's static guard, but none was ever driven open here — the
  // exact shape of gap layer 2 exists to close.
  it('Header: profile switcher dialog', async () => {
    const { container, findByRole } = renderInApp(<Header title="Assistant" />);
    const trigger = await findByRole('button', { name: /switch simulated user or role/i });
    fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    await expectAccessibleDialog(container);
  });

  it('Sidebar: brand selector dialog', async () => {
    const { container, findByRole } = renderInApp(
      <Sidebar activeTab="copilot" onTabChange={noop} />
    );
    const trigger = await findByRole('button', { name: /switch active brand/i });
    fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    await expectAccessibleDialog(container);
  });

  it('Sidebar: department selector dialog', async () => {
    const { container, findByTitle } = renderInApp(
      <Sidebar activeTab="copilot" onTabChange={noop} />
    );
    const trigger = await findByTitle(/switch active department/i);
    fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    await expectAccessibleDialog(container);
  });
});

/**
 * Escape was the other half of the PolicyManager defect, and covering it only
 * there would leave the six drawers and hand-rolled modals that own their own
 * keydown effect — rather than inheriting Modal's — free to lose it silently.
 */
describe('Dialog dismissal — Escape closes what should close', () => {
  const escape = () => fireEvent.keyDown(document, { key: 'Escape' });

  it('ReportIssueModal', () => {
    const onClose = vi.fn();
    renderInApp(
      <ReportIssueModal
        reportCategory="Outdated"
        setReportCategory={noop}
        reportDetails=""
        setReportDetails={noop}
        onSubmit={noop}
        onClose={onClose}
      />
    );
    escape();
    expect(onClose).toHaveBeenCalled();
  });

  it('ShareResourceModal', () => {
    const onClose = vi.fn();
    renderInApp(
      <ShareResourceModal shareUrl="https://x" copiedLink={false} onCopyLink={noop} onClose={onClose} />
    );
    escape();
    expect(onClose).toHaveBeenCalled();
  });

  it('SourceDetailModal', () => {
    const onClose = vi.fn();
    renderInApp(
      <SourceDetailModal
        source={{ name: 'Refund Policy.pdf', fileExt: 'pdf' }}
        document={doc}
        onClose={onClose}
        onDownload={noop}
      />
    );
    escape();
    expect(onClose).toHaveBeenCalled();
  });

  it('FullDocumentDrawer', () => {
    const onClose = vi.fn();
    renderInApp(
      <FullDocumentDrawer searchResult={null} sourceDocument={doc} onClose={onClose} onCopyFullText={noop} />
    );
    escape();
    expect(onClose).toHaveBeenCalled();
  });

  it('DocumentDetailDrawer', () => {
    const onClose = vi.fn();
    renderInApp(<DocumentDetailDrawer doc={doc} onClose={onClose} canEdit canManage onSave={asyncNoop} />);
    escape();
    expect(onClose).toHaveBeenCalled();
  });

  it('DocumentAuditProfileDrawer', () => {
    const setSelectedDoc = vi.fn();
    renderInApp(
      <DocumentAuditProfileDrawer selectedDoc={doc} setSelectedDoc={setSelectedDoc} documents={[doc]} />
    );
    escape();
    expect(setSelectedDoc).toHaveBeenCalledWith(null);
  });

  it('GovernanceReviewDrawer', () => {
    const onClose = vi.fn();
    renderInApp(
      <GovernanceReviewDrawer
        task={task}
        tasksList={[task]}
        onClose={onClose}
        onActionExecuted={noop}
        onNavigate={noop}
        currentIndex={0}
        totalTasks={1}
      />
    );
    escape();
    expect(onClose).toHaveBeenCalled();
  });

  it('GovernanceDispatchModal', () => {
    const setActiveDispatchTask = vi.fn();
    renderInApp(
      <GovernancePanelProvider value={{ ...governanceCtx, setActiveDispatchTask }}>
        <GovernanceDispatchModal />
      </GovernancePanelProvider>
    );
    escape();
    expect(setActiveDispatchTask).toHaveBeenCalledWith(null);
  });

  it('GovernanceSandboxModal closes on Escape when the draft is empty', () => {
    const setActiveSandboxGap = vi.fn();
    renderInApp(
      <GovernancePanelProvider
        value={{ ...governanceCtx, sandboxContent: '   ', setActiveSandboxGap }}
      >
        <GovernanceSandboxModal />
      </GovernancePanelProvider>
    );
    escape();
    expect(setActiveSandboxGap).toHaveBeenCalledWith(null);
  });

  it('GovernanceSandboxModal does NOT discard an unsaved draft on Escape', () => {
    // Escape is a dismissal, not a discard. With typed content the modal must
    // route through its unsaved-changes confirmation instead of throwing the
    // addendum away, and a blanket "Escape closes dialogs" refactor is exactly
    // how that protection would be lost.
    const setActiveSandboxGap = vi.fn();
    renderInApp(
      <GovernancePanelProvider
        value={{ ...governanceCtx, sandboxContent: 'Draft addendum content.', setActiveSandboxGap }}
      >
        <GovernanceSandboxModal />
      </GovernancePanelProvider>
    );
    escape();
    expect(setActiveSandboxGap).not.toHaveBeenCalled();
  });

  it('IdleLockScreen does NOT unlock on Escape', () => {
    // The one dialog where dismissal must not be possible. A lock screen that
    // Escape clears is not a lock screen, and the generic "Escape closes
    // dialogs" pattern is exactly how that regression would arrive.
    const onUnlock = vi.fn();
    renderInApp(<IdleLockScreen onUnlock={onUnlock} />);
    escape();
    expect(onUnlock).not.toHaveBeenCalled();
  });
});
