// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { LocaleProvider } from '../src/context/LocaleContext';
import { AuthProvider } from '../src/context/AuthContext';
import { BrandProvider } from '../src/context/BrandContext';
import { DepartmentProvider } from '../src/context/DepartmentContext';
import { BreadcrumbProvider } from '../src/context/BreadcrumbContext';
import { KnowledgeBaseTab } from '../src/components/tabs/kb/KnowledgeBaseTab';
import { AssistantTab } from '../src/components/tabs/copilot/AssistantTab';
import { KnowledgeSourcesView } from '../src/components/sources/KnowledgeSourcesView';
import { SettingsTab } from '../src/components/tabs/settings/SettingsTab';
import { SyncIndexingTab } from '../src/components/tabs/sync/SyncIndexingTab';
import { SystemGovernanceTab } from '../src/components/tabs/governance/SystemGovernanceTab';
import { ReviewQueueTab } from '../src/components/tabs/review/ReviewQueueTab';

/**
 * Extends the "Continuous Accessibility Testing" gate (docs/KNOWN_LIMITATIONS.md;
 * see docs/DECISIONS.md ADR-016) beyond the shared primitives covered by
 * tests/accessibility.test.tsx to the six full tab screens rendered by
 * src/App.tsx. These need the app's whole provider tree (Locale/Auth/Brand/
 * Department/Breadcrumb — see src/main.tsx for the real ordering) to render
 * meaningfully, and most of them fetch data over apiClient (-> global fetch)
 * on mount, so a single fetch mock returning minimal-but-valid envelopes for
 * every endpoint they call stands in for the real Express server.
 */
function mockFetchOnce() {
  const emptyList = { success: true, data: [] };
  const jsonResponse = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/db/governance/ai-config')) {
        return jsonResponse({
          success: true,
          data: { provider: 'gemini', model: 'gemini-2.0-flash', apiKey: '', temperature: 0.5 },
        });
      }
      if (url.includes('/api/db/documents')) {
        return jsonResponse({
          success: true,
          data: { documents: [], totalCount: 0, filteredCount: 0, availableCategories: [] },
        });
      }
      if (url.includes('/api/db/sync/status')) {
        return jsonResponse({
          success: true,
          data: { syncLogs: [], indexIntegrity: 100, totalIndexedKeys: 0 },
        });
      }
      // Covers /api/db/brands, /api/db/sources, /api/db/governance/gaps,
      // /api/db/governance/tasks, and anything else: an empty-array payload
      // is a valid, crash-free response shape for every one of these.
      return jsonResponse(emptyList);
    })
  );
}

function renderFullApp(ui: React.ReactElement) {
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

async function expectNoViolationsAfterSettling(container: Element) {
  // Let mounted-effect fetches resolve and re-render before auditing —
  // otherwise axe would only ever see each screen's initial loading
  // skeleton (spinners use `.animate-spin`, skeleton placeholders use
  // `.animate-pulse`), not the state a user actually reads/interacts with.
  //
  // `:not([data-persistent-motion])` because not every animation means loading.
  // The review queue's Critical priority dot pulses permanently as an urgency
  // signal, so treating any pulse as "still loading" made a queue with one
  // critical task never settle — the wait timed out and the screen was never
  // audited at all. Motion that is part of the design marks itself; everything
  // else is still assumed to be a loading affordance.
  await waitFor(() => {
    expect(container.querySelector('.animate-spin:not([data-persistent-motion])')).toBeNull();
    expect(container.querySelector('.animate-pulse:not([data-persistent-motion])')).toBeNull();
  }, { timeout: 3000 });
  const results = await axe.run(container, {
    rules: {
      // jsdom has no real layout engine, so color-contrast can't be
      // computed meaningfully — see docs/ACCESSIBILITY.md for the manual
      // audit process that covers this instead.
      'color-contrast': { enabled: false },
    },
  });
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}

beforeEach(() => {
  localStorage.clear();
  mockFetchOnce();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Accessibility — full tab screens (EKP-045)', () => {
  // A longer budget than the 5s default, for the same reason as ReviewQueueTab
  // below: this screen mounts the document hook and renders the full library plus
  // the Metrics view (health-score breakdown + retrieval-quality chart), so axe
  // walks a large tree that grew again when the call-forwarding corpus was added.
  // Measured at roughly 7s and rising with the corpus. Raised deliberately rather
  // than trimming what is audited.
  it('KnowledgeBaseTab has no axe violations', async () => {
    const { container } = renderFullApp(<KnowledgeBaseTab />);
    await expectNoViolationsAfterSettling(container);
  }, 20000);

  it('AssistantTab has no axe violations', async () => {
    const { container } = renderFullApp(<AssistantTab />);
    await expectNoViolationsAfterSettling(container);
  });

  it('KnowledgeSourcesView has no axe violations', async () => {
    const { container } = renderFullApp(<KnowledgeSourcesView />);
    await expectNoViolationsAfterSettling(container);
  });

  it('SettingsTab has no axe violations', async () => {
    const { container } = renderFullApp(<SettingsTab />);
    await expectNoViolationsAfterSettling(container);
  });

  it('SyncIndexingTab has no axe violations', async () => {
    const { container } = renderFullApp(<SyncIndexingTab />);
    await expectNoViolationsAfterSettling(container);
  });

  it('SystemGovernanceTab has no axe violations', async () => {
    const { container } = renderFullApp(<SystemGovernanceTab />);
    await expectNoViolationsAfterSettling(container);
  });

  // A longer budget than its six siblings, and it earns it: this screen mounts
  // the document hook and derives the queue from it, so it settles through two
  // dependent renders rather than one, and axe then walks a table wrapper with
  // its own roving-focus wiring. Measured at roughly 8s against vitest's 5s
  // default. Raised deliberately rather than trimming what is audited.
  it('ReviewQueueTab has no axe violations', async () => {
    const { container } = renderFullApp(<ReviewQueueTab />);
    await expectNoViolationsAfterSettling(container);
  }, 20000);
});
