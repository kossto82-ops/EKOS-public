/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useToast } from '../../../hooks/useToast';
import { useGovernancePanelContext } from './GovernancePanelContext';
import { GovernanceSandboxModal } from './GovernanceSandboxModal';
import { GovernanceDispatchModal } from './GovernanceDispatchModal';
import { GovernanceBulkActionsBar } from './GovernanceBulkActionsBar';
import { GovernanceQueueTable, taskRowId } from './GovernanceQueueTable';
import { useGovernanceBulkActions } from '../../../hooks/useGovernanceBulkActions';
import { useGovernanceKeyboardNav } from '../../../hooks/useGovernanceKeyboardNav';
import { getDynamicPriority } from '../../../utils/governancePriority';
import { useLocale } from '../../../context/LocaleContext';

export const GovernancePanel: React.FC = () => {
  const toast = useToast();
  const { t } = useLocale();
  const {
    reviewTasks,
    saveReviewTasks,
    updateDocumentApproval,
    selectedTaskIds,
    setSelectedTaskIds,
    highlightedIndex,
    setHighlightedIndex,
    activeReviewTask,
    setActiveReviewTask,
    handleTransitionTask,
    handleReviewActionExecuted,
    handleOpenDispatchPortal,
  } = useGovernancePanelContext();

  const { handleBulkApprove, handleBulkAssign, handleBulkArchive } = useGovernanceBulkActions({
    reviewTasks,
    saveReviewTasks,
    updateDocumentApproval,
    selectedTaskIds,
    setSelectedTaskIds,
    toast,
    t,
  });

  // Filtering, per-task priority scoring, and sorting are all memoized on `reviewTasks`
  // so an unrelated re-render (selection toggles, hover state, etc.) doesn't re-run
  // date-arithmetic scoring across the whole queue.
  const activeTasks = useMemo(
    () => reviewTasks.filter((t) => t.status !== 'Grounded & Updated' && t.status !== 'Banned'),
    [reviewTasks]
  );

  const sortedTasks = useMemo(() => {
    const enrichedTasks = activeTasks.map((t) => ({
      ...t,
      calculated: getDynamicPriority(t),
    }));
    return [...enrichedTasks].sort((a, b) => b.calculated.score - a.calculated.score);
  }, [activeTasks]);

  useGovernanceKeyboardNav({
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
  });

  const criticalTasks = useMemo(() => sortedTasks.filter((t) => t.calculated.level === 'Critical'), [sortedTasks]);
  const highTasks = useMemo(() => sortedTasks.filter((t) => t.calculated.level === 'High'), [sortedTasks]);
  const normalTasks = useMemo(() => sortedTasks.filter((t) => t.calculated.level === 'Normal'), [sortedTasks]);

  const allSelected = sortedTasks.length > 0 && sortedTasks.every((t) => selectedTaskIds.includes(t.id));

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(sortedTasks.map((t) => t.id));
    }
  };

  const queueContainerRef = useRef<HTMLDivElement>(null);

  // Keeps the accessible active-descendant in sync with the arrow-key highlight so
  // screen readers announce which row the [↑↓]/[Space]/[Enter]/[A] hotkeys act on.
  useEffect(() => {
    if (highlightedIndex >= 0) {
      queueContainerRef.current?.focus({ preventScroll: true });
    }
  }, [highlightedIndex]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50/20 dark:bg-slate-950/10">
      {/* Header: Focused on Actions & Speed */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-300 dark:border-slate-800/80 px-6 py-2.5 bg-slate-100/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-slate-200/60 text-slate-800 rounded-xs dark:bg-slate-800/80 dark:text-slate-200">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
              Work Queue
            </h3>
            <p className="text-3xs text-slate-500 font-mono">
              {activeTasks.length} active reviews • {selectedTaskIds.length} selected
            </p>
          </div>
        </div>

        {/* High-speed keyboard shortcuts indicator */}
        <div className="flex items-center gap-1.5 text-3xs font-mono text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 px-2.5 py-1 rounded-sm shadow-xs">
          <span className="font-bold text-brand-600 dark:text-brand-400">HOTKEYS:</span>
          <span>[↑↓] Move</span>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <span>[Space] Select</span>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <span>[Enter] Review</span>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <span>[A] Approve</span>
        </div>
      </div>

      <GovernanceBulkActionsBar
        reviewTasks={reviewTasks}
        selectedTaskIds={selectedTaskIds}
        setSelectedTaskIds={setSelectedTaskIds}
        handleBulkApprove={handleBulkApprove}
        handleBulkAssign={handleBulkAssign}
        handleBulkArchive={handleBulkArchive}
      />

      {/* Active Reviews Table Container */}
      <div
        ref={queueContainerRef}
        tabIndex={0}
        aria-label="Governance work queue, use arrow keys to navigate"
        aria-activedescendant={
          highlightedIndex >= 0 && sortedTasks[highlightedIndex] ? taskRowId(sortedTasks[highlightedIndex].id) : undefined
        }
        onFocus={() => {
          // Seed a starting highlight so Tab-ing in gives an immediate,
          // visible indication of focus rather than landing on an
          // unhighlighted table with only a container-level ring.
          if (highlightedIndex === -1 && sortedTasks.length > 0) {
            setHighlightedIndex(0);
          }
        }}
        className="flex-1 overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        <GovernanceQueueTable
          sortedTasks={sortedTasks}
          criticalCount={criticalTasks.length}
          highCount={highTasks.length}
          normalCount={normalTasks.length}
          highlightedIndex={highlightedIndex}
          setHighlightedIndex={setHighlightedIndex}
          selectedTaskIds={selectedTaskIds}
          setSelectedTaskIds={setSelectedTaskIds}
          allSelected={allSelected}
          onToggleAll={handleToggleAll}
          handleTransitionTask={handleTransitionTask}
          setActiveReviewTask={setActiveReviewTask}
          handleOpenDispatchPortal={handleOpenDispatchPortal}
        />
      </div>

      {/* 5. SOP Sandbox & Grounding Addendum Popup Editor Modal */}
      <GovernanceSandboxModal />

      {/* 6. GOVERNANCE DISPATCH - SLA Dispatch & Owner Assignment Portal Modal */}
      <GovernanceDispatchModal />
    </div>
  );
};
