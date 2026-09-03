// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

import { LocaleProvider } from '../src/context/LocaleContext';
import { AuthProvider } from '../src/context/AuthContext';
import { BrandProvider } from '../src/context/BrandContext';
import { DepartmentProvider } from '../src/context/DepartmentContext';
import { BreadcrumbProvider } from '../src/context/BreadcrumbContext';
import { ReviewQueueTab } from '../src/components/tabs/review/ReviewQueueTab';
import { setPendingResolveGap, takePendingResolveGap } from '../src/utils/crossTabIntent';

/**
 * The handoff between two top-level tabs.
 *
 * Metrics lives on the Knowledge Base tab and offers "resolve" on a search gap;
 * the sandbox editor that resolves one lives on the Review Queue tab. Only one
 * tab is mounted at a time, so the first implementation — dispatch a window
 * event carrying the gap, then navigate — could never work: the sender fired
 * while the receiver was unmounted, the receiver added its listener on mount,
 * and the payload had already gone nowhere. The action navigated and opened
 * nothing, silently.
 *
 * A slot the sender fills and the receiver drains on mount has no ordering
 * requirement, which is what these tests hold in place. The audit that found the
 * bug asked for a test that actually mounts the receiver and asserts the editor
 * opens, rather than a unit test of either half in isolation.
 */

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

function mockFetch() {
  const jsonResponse = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/db/documents')) {
        return jsonResponse({
          success: true,
          data: { documents: [], totalCount: 0, filteredCount: 0, availableCategories: [] },
        });
      }
      return jsonResponse({ success: true, data: [] });
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  mockFetch();
  // Leave no intent behind from a previous test.
  takePendingResolveGap();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('cross-tab intent slot', () => {
  it('reads once and clears, so a stale intent cannot re-fire on a later visit', () => {
    setPendingResolveGap({ gapId: 'gap-1', queryText: 'refund after the cooling-off period' });
    expect(takePendingResolveGap()).toEqual({
      gapId: 'gap-1',
      queryText: 'refund after the cooling-off period',
    });
    expect(takePendingResolveGap()).toBeNull();
  });

  it('is empty when nobody set anything', () => {
    expect(takePendingResolveGap()).toBeNull();
  });
});

describe('Review Queue — the handoff from Metrics', () => {
  it('opens the sandbox editor for a gap left by the tab that navigated here', async () => {
    // What the KB tab does before dispatching navigation.
    setPendingResolveGap({ gapId: 'gap-1', queryText: 'refund after the cooling-off period' });

    const { findByRole } = renderInApp(<ReviewQueueTab />);

    // The sandbox renders only when activeSandboxGap is set, so its dialog
    // appearing IS the assertion that the intent survived the mount.
    const dialog = await findByRole('dialog', {}, { timeout: 5000 });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('refund after the cooling-off period');
  }, 20000);

  it('opens nothing when arriving without an intent', async () => {
    const { container } = renderInApp(<ReviewQueueTab />);
    // Give the mount effect and the skeleton timer the same room the test above
    // gets, so this is "stayed closed", not "checked too early".
    await waitFor(() => expect(container.querySelector('[role="table"]')).not.toBeNull(), {
      timeout: 5000,
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  }, 20000);
});
