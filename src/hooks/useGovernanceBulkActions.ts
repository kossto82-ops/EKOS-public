/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { ReviewTask } from '../types';

interface UseGovernanceBulkActionsArgs {
  reviewTasks: ReviewTask[];
  saveReviewTasks: (updated: ReviewTask[]) => void;
  updateDocumentApproval: (docNames: Set<string>, decision: 'approved' | 'rejected' | 'banned') => void;
  selectedTaskIds: string[];
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<string[]>>;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
  t: (path: string, vars?: Record<string, string | number>) => string;
}

/**
 * Bulk queue operations (approve / assign / archive) for the Governance work
 * queue. Extracted from GovernancePanel so the component can focus on
 * rendering; the operations themselves don't depend on any local UI state.
 */
export function useGovernanceBulkActions({
  reviewTasks,
  saveReviewTasks,
  updateDocumentApproval,
  selectedTaskIds,
  setSelectedTaskIds,
  toast,
  t,
}: UseGovernanceBulkActionsArgs) {
  const handleBulkApprove = useCallback(async () => {
    if (selectedTaskIds.length === 0) return;
    try {
      const requestedSet = new Set(selectedTaskIds);
      // Only genuinely-resolved tasks are ineligible — mirrors the server's
      // RESOLVED_TASK_STATUSES. 'Feedback Received' (fresh report) IS eligible:
      // a first approval of a reported issue is the normal flow.
      const isIneligible = (status: string) =>
        status === 'Grounded & Updated' || status === 'Rejected' || status === 'Banned';
      const ineligibleCount = reviewTasks.filter(
        (t) => requestedSet.has(t.id) && isIneligible(t.status)
      ).length;
      // Already-approved/banned tasks are excluded: approving them would overturn
      // a terminal decision or double-bump the source document's version.
      const selectedSet = new Set(
        reviewTasks
          .filter((t) => requestedSet.has(t.id) && !isIneligible(t.status))
          .map((t) => t.id)
      );

      if (selectedSet.size === 0) {
        toast.error(t('governance.bulkApproveNoneEligible'));
        return;
      }

      const updated = reviewTasks.map((t) => {
        if (selectedSet.has(t.id)) {
          return { ...t, status: 'Grounded & Updated' };
        }
        return t;
      });

      const selectedDocNames = new Set(
        reviewTasks.filter((t) => selectedSet.has(t.id)).map((t) => t.documentName)
      );
      // Persist the approval (status + version bump + review date) onto the docs.
      updateDocumentApproval(selectedDocNames, 'approved');

      saveReviewTasks(updated);
      toast.success(t('governance.bulkApproveSuccess', { count: selectedSet.size }));
      if (ineligibleCount > 0) {
        toast.error(t('governance.bulkApproveSkipped', { count: ineligibleCount }));
      }
      setSelectedTaskIds([]);
    } catch (e) {
      console.error(e);
      toast.error(t('governance.bulkApproveError'));
    }
  }, [reviewTasks, selectedTaskIds, saveReviewTasks, updateDocumentApproval, setSelectedTaskIds, toast, t]);

  const handleBulkAssign = useCallback(async (newOwner: string) => {
    if (selectedTaskIds.length === 0) return;
    try {
      const selectedSet = new Set(selectedTaskIds);
      const updated = reviewTasks.map((t) => {
        if (selectedSet.has(t.id)) {
          return { ...t, owner: newOwner, status: 'Under Review' };
        }
        return t;
      });

      saveReviewTasks(updated);
      toast.success(t('governance.bulkAssignSuccess', { count: selectedTaskIds.length, owner: newOwner }));
      setSelectedTaskIds([]);
    } catch (e) {
      console.error(e);
      toast.error(t('governance.bulkAssignError'));
    }
  }, [reviewTasks, selectedTaskIds, saveReviewTasks, setSelectedTaskIds, toast, t]);

  const handleBulkArchive = useCallback(async () => {
    if (selectedTaskIds.length === 0) return;
    try {
      const selectedSet = new Set(selectedTaskIds);
      const updated = reviewTasks.filter((t) => !selectedSet.has(t.id));

      saveReviewTasks(updated);
      toast.success(t('governance.bulkArchiveSuccess', { count: selectedTaskIds.length }));
      setSelectedTaskIds([]);
    } catch (e) {
      console.error(e);
      toast.error(t('governance.bulkArchiveError'));
    }
  }, [reviewTasks, selectedTaskIds, saveReviewTasks, setSelectedTaskIds, toast, t]);

  return { handleBulkApprove, handleBulkAssign, handleBulkArchive };
}
