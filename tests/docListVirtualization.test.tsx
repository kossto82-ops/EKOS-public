// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import axe from 'axe-core';
import { DocList } from '../src/components/tabs/kb/DocList';
import { LocaleProvider } from '../src/context/LocaleContext';
import { BrandProvider } from '../src/context/BrandContext';
import { DepartmentProvider } from '../src/context/DepartmentContext';
import type { KBDocument } from '../src/types';

/**
 * Regression coverage for the virtualized (react-window) document list
 * introduced to address docs/KNOWN_LIMITATIONS.md's "Chunk-Based Document
 * Loading" hardening item. Verifies the actual point of virtualizing —
 * DOM node count stays flat regardless of document count — plus that
 * filtering and row interactions still work against the flattened
 * header+doc row model.
 *
 * DocList resolves its labels through useLocale, so every render here is inside
 * a LocaleProvider — the same tree main.tsx builds. The assertions below still
 * match on English text because the provider initialises to the `en` dictionary
 * synchronously; they are asserting the rendered label, not a hardcoded literal.
 */
function makeDocs(count: number): KBDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc_${i}`,
    name: `Document ${String(i).padStart(3, '0')}`,
    type: 'pdf' as const,
    status: 'trained' as const,
    scope: 'global' as const,
    category: `Category ${i % 5}`,
    uploadedAt: new Date(2026, 0, 1 + i).toISOString(),
    uploadedBy: 'system',
    approvalStatus: 'Approved' as const,
  }));
}

function renderDocList(documents: KBDocument[]) {
  return render(
    <LocaleProvider>
      <BrandProvider>
      <DepartmentProvider>
        <DocList
          documents={documents}
          onUpload={() => {}}
          onDelete={() => {}}
          canManage={true}
          brandId="northwind_es"
          brandDisplayName="Secretaría.es"
        />
      </DepartmentProvider>
    </BrandProvider>
    </LocaleProvider>
  );
}

afterEach(cleanup);

describe('DocList virtualization', () => {
  it('renders far fewer DOM rows than total documents for a large list', () => {
    const TOTAL = 500;
    const { container } = renderDocList(makeDocs(TOTAL));
    const renderedRows = container.querySelectorAll('[role="listitem"]');
    // react-window only mounts the visible window (+ overscan), not all 500
    // docs plus their category headers — this is the entire point of this
    // change. A generous upper bound (well under total) proves windowing
    // is actually happening rather than silently rendering everything.
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(TOTAL / 2);
  });

  it('search filtering narrows the rendered set', async () => {
    const docs = makeDocs(50);
    renderDocList(docs);
    const search = screen.getByLabelText(/search documents/i);
    fireEvent.change(search, { target: { value: 'Document 007' } });
    // Filtering is debounced (200ms) — wait for the narrowed result.
    await screen.findByText('Document 007', {}, { timeout: 1000 });
    expect(screen.queryByText('Document 000')).not.toBeInTheDocument();
  });

  it('has no axe violations in its default rendering', async () => {
    const { container } = renderDocList(makeDocs(20));
    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
  });

  it('shows the empty-state message when no documents match', () => {
    renderDocList([]);
    expect(screen.getByText(/no documents match the selected filters/i)).toBeInTheDocument();
  });

  it('opens the delete-confirm affordance for a rendered row', () => {
    const { container } = renderDocList(makeDocs(5));
    // Index 0 is the "Category 0" header row; index 1 is the first doc row.
    const firstDocRow = container.querySelectorAll('[role="listitem"]')[1]!;
    const deleteButton = within(firstDocRow as HTMLElement).getByLabelText(/^Delete /);
    fireEvent.click(deleteButton);
    expect(screen.getByText('Confirm delete')).toBeInTheDocument();
  });

  it('opens document details when the title button is activated', () => {
    let selected: KBDocument | null = null;
    render(
      <LocaleProvider>
      <BrandProvider>
        <DepartmentProvider>
          <DocList
            documents={makeDocs(3)}
            onUpload={() => {}}
            onDelete={() => {}}
            canManage={true}
            brandId="northwind_es"
            brandDisplayName="Secretaría.es"
            onSelectDoc={(doc) => { selected = doc; }}
          />
        </DepartmentProvider>
      </BrandProvider>
    </LocaleProvider>
    );
    fireEvent.click(screen.getByLabelText('Open details for Document 000'));
    expect(selected).not.toBeNull();
    expect((selected as unknown as KBDocument).id).toBe('doc_0');
  });

  it('shows a "Load more" affordance when the server has more pages, and calls onLoadMore', () => {
    const onLoadMore = () => { loadMoreCalled = true; };
    let loadMoreCalled = false;
    render(
      <LocaleProvider>
      <BrandProvider>
        <DepartmentProvider>
          <DocList
            documents={makeDocs(5)}
            onUpload={() => {}}
            onDelete={() => {}}
            canManage={true}
            brandId="northwind_es"
            brandDisplayName="Secretaría.es"
            hasMore={true}
            onLoadMore={onLoadMore}
          />
        </DepartmentProvider>
      </BrandProvider>
    </LocaleProvider>
    );
    fireEvent.click(screen.getByText('Load more documents'));
    expect(loadMoreCalled).toBe(true);
  });

  it('does not show a "Load more" affordance when there is no next page', () => {
    render(
      <LocaleProvider>
      <BrandProvider>
        <DepartmentProvider>
          <DocList
            documents={makeDocs(5)}
            onUpload={() => {}}
            onDelete={() => {}}
            canManage={true}
            brandId="northwind_es"
            brandDisplayName="Secretaría.es"
            hasMore={false}
          />
        </DepartmentProvider>
      </BrandProvider>
    </LocaleProvider>
    );
    expect(screen.queryByText('Load more documents')).not.toBeInTheDocument();
  });
});
