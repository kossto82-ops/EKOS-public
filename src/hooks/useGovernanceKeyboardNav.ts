/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { ReviewTask } from '../types';

interface UseGovernanceKeyboardNavArgs {
  // Must be the same prioritized/sorted list rendered in the table (see
  // GovernancePanel's `sortedTasks`) — using a separately-computed order
  // here would let ArrowDown/Enter highlight/select a different task than
  // what's visually next in the queue.
  sortedTasks: ReviewTask[];
  activeReviewTask: ReviewTask | null;
  highlightedIndex: number;
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveReviewTask: (task: ReviewTask | null) => void;
  handleTransitionTask: (taskId: string, nextStatus: 'Under Review' | 'Grounded & Updated') => void;
  handleReviewActionExecuted: (
    taskId: string,
    nextStatus: 'Under Review' | 'Grounded & Updated' | 'Rejected',
    updatedTask?: ReviewTask
  ) => void;
  toast: { success: (msg: string) => void };
  t: (path: string, vars?: Record<string, string | number>) => string;
}

/**
 * Keyboard navigation & fast-approval shortcuts for expert users working the
 * governance queue: arrow keys to move, space/x to select, enter to review,
 * 'a' to approve the highlighted task.
 */
export function useGovernanceKeyboardNav({
  sortedTasks,
  activeReviewTask,
  highlightedIndex,
  setHighlightedIndex,
  setSelectedTaskIds,
  setActiveReviewTask,
  handleTransitionTask,
  handleReviewActionExecuted,
  toast,
  t,
}: UseGovernanceKeyboardNavArgs) {
  useEffect(() => {
    if (activeReviewTask) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside form inputs/textareas/selects
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (sortedTasks.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          if (prev === -1) return 0;
          return Math.min(prev + 1, sortedTasks.length - 1);
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          if (prev <= 0) return 0;
          return prev - 1;
        });
      } else if (e.key === ' ' || e.key === 'x' || e.key === 'X') {
        if (highlightedIndex >= 0 && highlightedIndex < sortedTasks.length) {
          e.preventDefault();
          const targetTask = sortedTasks[highlightedIndex];
          setSelectedTaskIds((prev) =>
            prev.includes(targetTask.id)
              ? prev.filter((id) => id !== targetTask.id)
              : [...prev, targetTask.id]
          );
        }
      } else if (e.key === 'Enter') {
        if (highlightedIndex >= 0 && highlightedIndex < sortedTasks.length) {
          e.preventDefault();
          const targetTask = sortedTasks[highlightedIndex];
          handleTransitionTask(targetTask.id, 'Under Review');
          setActiveReviewTask(targetTask);
        }
      } else if (e.key === 'a' || e.key === 'A') {
        if (highlightedIndex >= 0 && highlightedIndex < sortedTasks.length) {
          e.preventDefault();
          const targetTask = sortedTasks[highlightedIndex];
          handleReviewActionExecuted(targetTask.id, 'Grounded & Updated');
          toast.success(t('governance.approvingGrounding', { name: targetTask.documentName }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeReviewTask, sortedTasks, highlightedIndex, setHighlightedIndex, setSelectedTaskIds, setActiveReviewTask, handleTransitionTask, handleReviewActionExecuted, toast, t]);
}
