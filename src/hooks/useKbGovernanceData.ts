/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ReviewTask, KBDocument } from '../types';
import { INITIAL_SEARCH_GAPS } from '../constants/kb';
import { KB_EVENTS } from '../constants/events';
import { ISearchGap } from '../repositories/governanceRepository';
import { governanceService } from '../services/governanceService';

const GAPS_STORAGE_KEY = 'kb_search_gaps';

/** localStorage cache mirror for search gaps (server is the source of truth). */
function cacheSearchGaps(gaps: ISearchGap[]) {
  try {
    localStorage.setItem(GAPS_STORAGE_KEY, JSON.stringify(gaps));
  } catch (e) {
    console.error('useKbGovernanceData: failed to cache search gaps:', e);
  }
}

/**
 * Derives a review-queue task from a real Under-Review document. The review
 * queue is now the set of documents whose approvalStatus === 'Under Review'
 * (the actual governance state) — NOT a separate, hand-seeded task list that
 * drifted from the real corpus (114 docs were Under Review while the queue
 * showed 4 fabricated demo tasks). Analytics fields are neutral: we never
 * fabricate an aiConfidence or risk flag a document doesn't have.
 */
function documentToReviewTask(doc: KBDocument): ReviewTask {
  const deptIds = Array.isArray(doc.departmentIds) ? doc.departmentIds : [];
  return {
    id: `dr_${doc.id}`,
    documentName: doc.name,
    docName: doc.name,
    feedbackType: 'Document pending review',
    agentQuery: '',
    messageContent: `"${doc.name}" is awaiting governance validation before it can ground answers.`,
    status: 'Under Review',
    createdAt: doc.uploadedAt || doc.lastReviewDate || new Date().toISOString(),
    owner: doc.owner || 'Unassigned',
    department: doc.department || deptIds[0] || 'Global',
    departmentIds: deptIds,
    priority: 'Medium',
    similarIncidents: 0,
    flags: [],
  };
}

interface UseKbGovernanceDataArgs {
  departmentId: string;
  /**
   * True when the caller governs every department (scoped to '*', i.e. an
   * Administrator) and must see the ENTIRE queue regardless of the active
   * department. Team Leaders remain scoped to their own department(s).
   */
  canSeeAllDepartments: boolean;
  /** The documents the caller can see (already brand/department-scoped by the
   *  server GET /api/db/documents). The review queue is derived from these. */
  documents: KBDocument[];
  updateDocumentApproval: (docNames: Set<string>, decision: 'approved' | 'rejected' | 'banned') => void;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Search-gap state plus the document-derived governance review queue. The queue
 * reflects the real Under-Review documents (validation actions write straight to
 * the document's approvalStatus, so an approved/rejected/banned doc leaves the
 * queue on the next render). Search gaps keep their server+cache model.
 */
export function useKbGovernanceData({ departmentId, canSeeAllDepartments, documents, updateDocumentApproval, toast }: UseKbGovernanceDataArgs) {
  const [searchGaps, setSearchGaps] = useState<ISearchGap[]>([]);
  const [activeReviewTask, setActiveReviewTask] = useState<ReviewTask | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // The review queue = real documents currently Under Review, mapped to tasks.
  const reviewTasks = useMemo<ReviewTask[]>(
    () => (documents || [])
      .filter((d) => d.approvalStatus === 'Under Review' && !(d as any).deletedAt)
      .map(documentToReviewTask),
    [documents]
  );

  const filteredReviewTasks = useMemo(() => {
    return reviewTasks.filter((task) => {
      // Admins ('*') see the whole queue.
      if (canSeeAllDepartments) return true;
      // Global / unassigned docs (no departmentIds) stay visible to everyone so
      // a global document's review is never hidden from the queue.
      if (!task.departmentIds || task.departmentIds.length === 0) return true;
      // Otherwise: only the doc's own department(s) (e.g. a Service TL reviews
      // Service docs of any brand — the docs are already brand-scoped upstream).
      return task.departmentIds.includes(departmentId);
    });
  }, [reviewTasks, departmentId, canSeeAllDepartments]);

  // Keep activeReviewTask pointing at a live task; drop it once its document
  // leaves the queue (approved/rejected/banned elsewhere).
  useEffect(() => {
    setActiveReviewTask((prev) => (prev ? reviewTasks.find((t) => t.id === prev.id) || null : prev));
  }, [reviewTasks]);

  // --- Search gaps: server (SQLite) source of truth, localStorage offline cache ---
  useEffect(() => {
    const loadSearchGaps = async () => {
      try {
        const serverGaps = await governanceService.getSearchGaps();
        if (serverGaps && serverGaps.length > 0) {
          cacheSearchGaps(serverGaps);
          setSearchGaps(serverGaps);
          return;
        }
        cacheSearchGaps(INITIAL_SEARCH_GAPS);
        setSearchGaps(INITIAL_SEARCH_GAPS);
        governanceService.saveSearchGaps(INITIAL_SEARCH_GAPS).catch(() => {});
      } catch (serverErr) {
        const savedGaps = localStorage.getItem(GAPS_STORAGE_KEY);
        if (savedGaps) {
          try { setSearchGaps(JSON.parse(savedGaps)); return; } catch { /* fall through */ }
        }
        cacheSearchGaps(INITIAL_SEARCH_GAPS);
        setSearchGaps(INITIAL_SEARCH_GAPS);
      }
    };
    void loadSearchGaps();

    const handleGapsUpdate = () => {
      try {
        const saved = localStorage.getItem(GAPS_STORAGE_KEY);
        if (saved) setSearchGaps(JSON.parse(saved));
      } catch (e) {}
    };
    window.addEventListener(KB_EVENTS.SEARCH_GAPS_UPDATED, handleGapsUpdate);
    return () => window.removeEventListener(KB_EVENTS.SEARCH_GAPS_UPDATED, handleGapsUpdate);
  }, []);

  const saveSearchGaps = useCallback((updated: ISearchGap[]) => {
    cacheSearchGaps(updated);
    setSearchGaps(updated);
    window.dispatchEvent(new Event(KB_EVENTS.SEARCH_GAPS_UPDATED));
    governanceService.saveSearchGaps(updated).catch((e) => {
      console.error('useKbGovernanceData: failed to persist search gaps to server:', e);
    });
  }, []);

  // Compatibility no-op: the review queue is derived from documents, so the
  // source of truth for a review decision is the document's approvalStatus
  // (written by updateDocumentApproval, which callers already invoke). There is
  // no separate task list to persist. Kept so bulk-action/panel callers that
  // pass an updated task array don't need to special-case the queue.
  const saveReviewTasks = useCallback((_updated: ReviewTask[]) => {
    window.dispatchEvent(new Event(KB_EVENTS.REVIEW_TASKS_UPDATED));
  }, []);

  const handleTransitionTask = useCallback((taskId: string, nextStatus: 'Under Review' | 'Grounded & Updated') => {
    const task = reviewTasks.find((t) => t.id === taskId);
    if (!task) return;
    if (nextStatus === 'Grounded & Updated') {
      // Approving writes straight to the document; the doc then leaves the queue.
      updateDocumentApproval(new Set([task.documentName]), 'approved');
    }
  }, [reviewTasks, updateDocumentApproval]);

  const handleReviewActionExecuted = useCallback((
    taskId: string,
    nextStatus: 'Under Review' | 'Grounded & Updated' | 'Rejected' | 'Banned',
    _updatedTask?: ReviewTask
  ) => {
    const task = reviewTasks.find((t) => t.id === taskId);
    if (!task) return;
    if (nextStatus === 'Grounded & Updated') updateDocumentApproval(new Set([task.documentName]), 'approved');
    else if (nextStatus === 'Rejected') updateDocumentApproval(new Set([task.documentName]), 'rejected');
    else if (nextStatus === 'Banned') updateDocumentApproval(new Set([task.documentName]), 'banned');
    // The document state change re-derives the queue; drop the drawer selection
    // if this task's doc is leaving Under Review.
    if (nextStatus !== 'Under Review') setActiveReviewTask((prev) => (prev && prev.id === taskId ? null : prev));
  }, [reviewTasks, updateDocumentApproval]);

  const handleReviewNavigate = useCallback((direction: 'prev' | 'next') => {
    setActiveReviewTask((current) => {
      if (!current) return current;
      const index = reviewTasks.findIndex((t) => t.id === current.id);
      if (direction === 'next' && index < reviewTasks.length - 1) return reviewTasks[index + 1];
      if (direction === 'prev' && index > 0) return reviewTasks[index - 1];
      toast.error(direction === 'next' ? 'Already at the last task in the queue.' : 'Already at the first task in the queue.');
      return current;
    });
  }, [reviewTasks, toast]);

  // Number of documents awaiting review (drives the queue badge).
  const pendingCount = useMemo(() => reviewTasks.length, [reviewTasks]);

  return {
    searchGaps,
    setSearchGaps,
    saveSearchGaps,
    reviewTasks,
    filteredReviewTasks,
    saveReviewTasks,
    activeReviewTask,
    setActiveReviewTask,
    highlightedIndex,
    setHighlightedIndex,
    selectedTaskIds,
    setSelectedTaskIds,
    handleTransitionTask,
    handleReviewActionExecuted,
    handleReviewNavigate,
    pendingCount,
  };
}
