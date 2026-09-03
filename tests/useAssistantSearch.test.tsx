// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const searchMock = vi.fn();
vi.mock('../src/services/searchService', () => ({
  searchService: { search: (...args: any[]) => searchMock(...args) },
}));
// The hook checks whether a provider key is configured on mount; stub it so the
// tests don't depend on the network or on a role's governance access.
vi.mock('../src/services/governanceService', () => ({
  governanceService: { getAiConfig: vi.fn().mockResolvedValue({ apiKey: '' }) },
}));

import { useAssistantSearch } from '../src/hooks/useAssistantSearch';

/**
 * Guards around the Assistant's search state. Each of these protects a defect
 * that actually shipped:
 *  - an empty submit was silently swallowed (no cue at all);
 *  - a slow response could overwrite a newer one already on screen;
 *  - switching brand/department left the previous tenant's answer visible;
 *  - a simulated local-fallback answer was treated as proof of a working key.
 */

function answer(id: string) {
  return {
    id, title: `Answer ${id}`, summary: '', content: '', confidenceScore: 90,
    sources: [], status: 'verified', answerType: 'faq', businessDomain: 'General',
    lastUpdated: '2026-07-01T00:00:00Z', reviewOwner: 'Ops',
  };
}
const ok = (id: string, retrievalSource: 'live_ai' | 'local_fallback' = 'live_ai') =>
  ({ data: { answer: answer(id), retrievalSource }, isLoading: false, error: null, retries: 0 });

const baseArgs = {
  activeBrandId: 'northwind_de',
  activeDepartmentId: 'customer_service',
  showToast: vi.fn(),
  t: (k: string) => k,
  locale: 'en',
};

function setup(args: Partial<typeof baseArgs> = {}) {
  return renderHook(
    (props: typeof baseArgs) => useAssistantSearch(props),
    { initialProps: { ...baseArgs, ...args } }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  searchMock.mockResolvedValue(ok('default'));
});

describe('useAssistantSearch — empty submit', () => {
  it('raises a visible cue and does not call the service', async () => {
    const { result } = setup();

    await act(async () => { await result.current.performSearch('   '); });

    expect(result.current.emptyQueryHint).toBe(true);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('clears the cue once a real query runs', async () => {
    const { result } = setup();
    await act(async () => { await result.current.performSearch(''); });
    expect(result.current.emptyQueryHint).toBe(true);

    await act(async () => { await result.current.performSearch('call forwarding'); });

    expect(result.current.emptyQueryHint).toBe(false);
    expect(searchMock).toHaveBeenCalledWith('call forwarding', 'northwind_de', 'customer_service', 'en');
  });
});

describe('useAssistantSearch — trust follows provenance', () => {
  it('a live_ai answer proves the key works', async () => {
    searchMock.mockResolvedValue(ok('a1', 'live_ai'));
    const { result } = setup();

    await act(async () => { await result.current.performSearch('q'); });

    expect(result.current.retrievalSource).toBe('live_ai');
    expect(result.current.isApiKeyConfigured).toBe(true);
  });

  it('a local_fallback answer does NOT claim the key works', async () => {
    searchMock.mockResolvedValue(ok('a2', 'local_fallback'));
    const { result } = setup();

    await act(async () => { await result.current.performSearch('q'); });

    expect(result.current.searchResult?.id).toBe('a2');
    expect(result.current.retrievalSource).toBe('local_fallback');
    // Must not be flipped to true by a simulated answer.
    expect(result.current.isApiKeyConfigured).not.toBe(true);
  });
});

describe('useAssistantSearch — a stale response never wins', () => {
  it('a slow first search cannot overwrite the newer result already on screen', async () => {
    // First call hangs; second resolves immediately.
    let releaseFirst: (v: any) => void = () => {};
    searchMock
      .mockImplementationOnce(() => new Promise((res) => { releaseFirst = res; }))
      .mockImplementationOnce(() => Promise.resolve(ok('second')));

    const { result } = setup();

    // Fire the slow one, then the fast one, without awaiting the first.
    let firstDone: Promise<void>;
    await act(async () => {
      firstDone = result.current.performSearch('slow query');
      await result.current.performSearch('fast query');
    });
    expect(result.current.searchResult?.id).toBe('second');

    // The stale response lands last — it must be discarded.
    await act(async () => { releaseFirst(ok('first')); await firstDone; });

    expect(result.current.searchResult?.id).toBe('second');
  });
});

describe('useAssistantSearch — tenant isolation on context switch', () => {
  it("clears the previous brand's answer when the active brand changes", async () => {
    const { result, rerender } = setup();
    await act(async () => { await result.current.performSearch('pricing'); });
    expect(result.current.searchResult).not.toBeNull();

    await act(async () => { rerender({ ...baseArgs, activeBrandId: 'northwind_es' }); });

    await waitFor(() => {
      expect(result.current.searchResult).toBeNull();
      expect(result.current.retrievalSource).toBeNull();
    });
  });

  it('clears the answer when the active department changes', async () => {
    const { result, rerender } = setup();
    await act(async () => { await result.current.performSearch('escalation'); });
    expect(result.current.searchResult).not.toBeNull();

    await act(async () => { rerender({ ...baseArgs, activeDepartmentId: 'it' }); });

    await waitFor(() => expect(result.current.searchResult).toBeNull());
  });

  it('keeps the answer when neither brand nor department actually changed', async () => {
    const { result, rerender } = setup();
    await act(async () => { await result.current.performSearch('holiday policy'); });
    const before = result.current.searchResult?.id;

    await act(async () => { rerender({ ...baseArgs, locale: 'es' }); });

    expect(result.current.searchResult?.id).toBe(before);
  });
});
