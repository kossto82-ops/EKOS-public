// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The hook loads search gaps from the server on mount; stub that so these tests
// exercise the review queue only and never touch the network.
vi.mock('../src/services/governanceService', () => ({
  governanceService: {
    getSearchGaps: vi.fn().mockResolvedValue([]),
    saveSearchGaps: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useKbGovernanceData } from '../src/hooks/useKbGovernanceData';
import type { KBDocument } from '../src/types';

/**
 * The governance review queue is DERIVED from the real Under-Review documents
 * (it used to render a separate hand-seeded task list that had drifted from the
 * corpus: 4 demo tasks while 114 documents were actually awaiting review, so a
 * department-scoped user saw an empty queue). These tests lock in the derivation,
 * the scoping, and that a decision is written to the document rather than to a
 * parallel task store.
 */

function doc(id: string, over: Partial<KBDocument> = {}): KBDocument {
  return {
    id,
    name: `${id}.md`,
    type: 'md',
    status: 'trained',
    scope: 'global',
    approvalStatus: 'Under Review',
    departmentScope: 'global',
    departmentIds: [],
    uploadedAt: '2026-07-01T00:00:00Z',
    uploadedBy: 'tester',
    owner: 'Ops',
    department: 'Operations',
    ...over,
  } as KBDocument;
}

const toast = { success: vi.fn(), error: vi.fn() };

function setup(documents: KBDocument[], opts: { departmentId?: string; canSeeAllDepartments?: boolean } = {}) {
  const updateDocumentApproval = vi.fn();
  const view = renderHook(({ docs }: { docs: KBDocument[] }) =>
    useKbGovernanceData({
      departmentId: opts.departmentId ?? 'customer_service',
      canSeeAllDepartments: opts.canSeeAllDepartments ?? true,
      documents: docs,
      updateDocumentApproval,
      toast,
    }),
    { initialProps: { docs: documents } }
  );
  return { ...view, updateDocumentApproval };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('useKbGovernanceData — the queue is derived from real documents', () => {
  it('includes only documents awaiting review', () => {
    const { result } = setup([
      doc('pending_one'),
      doc('pending_two'),
      doc('already_approved', { approvalStatus: 'Approved' }),
      doc('banned', { approvalStatus: 'Banned' }),
      doc('draft', { approvalStatus: 'Draft' }),
    ]);

    expect(result.current.reviewTasks.map((t) => t.documentName).sort())
      .toEqual(['pending_one.md', 'pending_two.md']);
  });

  it('excludes a soft-deleted document even while it is Under Review', () => {
    const { result } = setup([
      doc('live_one'),
      doc('deleted_one', { deletedAt: '2026-07-20T00:00:00Z' } as any),
    ]);
    expect(result.current.reviewTasks.map((t) => t.documentName)).toEqual(['live_one.md']);
  });

  it('pendingCount reflects the number of documents awaiting review', () => {
    const { result } = setup([doc('a'), doc('b'), doc('c', { approvalStatus: 'Approved' })]);
    expect(result.current.pendingCount).toBe(2);
  });

  it('carries the document owner and departments onto the task, and fabricates no analytics', () => {
    const { result } = setup([doc('scoped', {
      owner: 'Telephony Operations',
      departmentScope: 'specific',
      departmentIds: ['it'],
    })]);
    const task = result.current.reviewTasks[0];
    expect(task.owner).toBe('Telephony Operations');
    expect(task.departmentIds).toEqual(['it']);
    // Neutral signal: no invented confidence or risk flags (the old seeded queue
    // showed a fabricated 95% aiConfidence on tasks that had no data).
    expect(task.aiConfidence).toBeUndefined();
    expect(task.flags).toEqual([]);
    expect(task.similarIncidents).toBe(0);
  });
});

describe('useKbGovernanceData — scoping', () => {
  const docs = [
    doc('global_doc'),                                                              // no departmentIds
    doc('cs_doc', { departmentScope: 'specific', departmentIds: ['customer_service'] }),
    doc('it_doc', { departmentScope: 'specific', departmentIds: ['it'] }),
  ];

  it('an administrator sees the entire queue regardless of the active department', () => {
    const { result } = setup(docs, { departmentId: 'customer_service', canSeeAllDepartments: true });
    expect(result.current.filteredReviewTasks).toHaveLength(3);
  });

  it('a department-scoped reviewer sees their own department plus global documents', () => {
    const { result } = setup(docs, { departmentId: 'customer_service', canSeeAllDepartments: false });
    expect(result.current.filteredReviewTasks.map((t) => t.documentName).sort())
      .toEqual(['cs_doc.md', 'global_doc.md']);
  });

  it("a department-scoped reviewer does not see another department's document", () => {
    const { result } = setup(docs, { departmentId: 'it', canSeeAllDepartments: false });
    const names = result.current.filteredReviewTasks.map((t) => t.documentName);
    expect(names).toContain('it_doc.md');
    expect(names).not.toContain('cs_doc.md');
  });
});

describe('useKbGovernanceData — a decision is written to the document', () => {
  it('approving transitions the source document, not a separate task store', () => {
    const { result, updateDocumentApproval } = setup([doc('to_approve')]);
    const taskId = result.current.reviewTasks[0].id;

    act(() => { result.current.handleTransitionTask(taskId, 'Grounded & Updated'); });

    expect(updateDocumentApproval).toHaveBeenCalledWith(new Set(['to_approve.md']), 'approved');
  });

  it('maps reject and ban onto the document decision', () => {
    const { result, updateDocumentApproval } = setup([doc('d1'), doc('d2')]);
    const [t1, t2] = result.current.reviewTasks;

    act(() => { result.current.handleReviewActionExecuted(t1.id, 'Rejected'); });
    act(() => { result.current.handleReviewActionExecuted(t2.id, 'Banned'); });

    expect(updateDocumentApproval).toHaveBeenCalledWith(new Set(['d1.md']), 'rejected');
    expect(updateDocumentApproval).toHaveBeenCalledWith(new Set(['d2.md']), 'banned');
  });

  it('ignores an action for a task id that is not in the queue', () => {
    const { result, updateDocumentApproval } = setup([doc('only')]);
    act(() => { result.current.handleTransitionTask('dr_does_not_exist', 'Grounded & Updated'); });
    expect(updateDocumentApproval).not.toHaveBeenCalled();
  });
});

describe('useKbGovernanceData — the open task follows the document', () => {
  it('drops the active task once its document leaves the queue', () => {
    const { result, rerender } = setup([doc('leaving'), doc('staying')]);
    const leaving = result.current.reviewTasks.find((t) => t.documentName === 'leaving.md')!;

    act(() => { result.current.setActiveReviewTask(leaving); });
    expect(result.current.activeReviewTask?.documentName).toBe('leaving.md');

    // The document is approved elsewhere, so it is no longer Under Review.
    rerender({ docs: [doc('leaving', { approvalStatus: 'Approved' }), doc('staying')] });

    expect(result.current.activeReviewTask).toBeNull();
    expect(result.current.reviewTasks.map((t) => t.documentName)).toEqual(['staying.md']);
  });
});
