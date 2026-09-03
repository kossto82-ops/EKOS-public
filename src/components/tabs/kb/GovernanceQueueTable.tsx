/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ReviewTask } from '../../../types';
import { DynamicPriority } from '../../../utils/governancePriority';
import { useLocale } from '../../../context/LocaleContext';
import { Badge, EmptyState } from '../../shared/DesignSystem';

export type PrioritizedReviewTask = ReviewTask & { calculated: DynamicPriority };

export const taskRowId = (taskId: string) => `gov_task_row_${taskId}`;

interface GovernanceQueueRowProps {
  task: PrioritizedReviewTask;
  idx: number;
  isHighlighted: boolean;
  isSelected: boolean;
  showCriticalHeader: boolean;
  showHighHeader: boolean;
  showNormalHeader: boolean;
  criticalCount: number;
  highCount: number;
  normalCount: number;
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<string[]>>;
  handleTransitionTask: (taskId: string, nextStatus: 'Under Review' | 'Grounded & Updated') => void;
  setActiveReviewTask: (task: ReviewTask | null) => void;
  handleOpenDispatchPortal: (task: ReviewTask) => void;
}

/**
 * A single queue row (plus any group header rows that precede it). Memoized
 * so that changing `highlightedIndex`/`selectedTaskIds` only re-renders the
 * row(s) whose own highlighted/selected flag actually flipped, instead of
 * every row in the queue.
 */
const GovernanceQueueRow: React.FC<GovernanceQueueRowProps> = React.memo(function GovernanceQueueRow({
  task,
  idx,
  isHighlighted,
  isSelected,
  showCriticalHeader,
  showHighHeader,
  showNormalHeader,
  criticalCount,
  highCount,
  normalCount,
  setHighlightedIndex,
  setSelectedTaskIds,
  handleTransitionTask,
  setActiveReviewTask,
  handleOpenDispatchPortal,
}) {
  const { t } = useLocale();
  const level = task.calculated.level;

  let priorityVariant: 'danger' | 'warning' | 'neutral' = 'neutral';
  let dotColor = '';
  if (level === 'Critical') {
    priorityVariant = 'danger';
    // motion-reduce:animate-none — this dot pulses for as long as a critical task
    // is in the queue, which is a screen a reviewer may sit on for a long stretch.
    // Marking it data-persistent-motion kept it from stalling the accessibility
    // suite; that was a test fix and not an accessibility one. Honouring
    // prefers-reduced-motion is the accessibility one. The colour still carries
    // the signal when the animation is off.
    dotColor = 'bg-red-500 animate-pulse motion-reduce:animate-none';
  } else if (level === 'High') {
    priorityVariant = 'warning';
    dotColor = 'bg-warning-500';
  } else {
    priorityVariant = 'neutral';
    dotColor = 'bg-slate-400';
  }

  return (
    <React.Fragment>
      {showCriticalHeader && (
        <tr role="row" className="bg-red-50/20 dark:bg-red-950/5 select-none border-t">
          <td
            role="cell"
            colSpan={7}
            className="px-3 py-1 text-3xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider font-sans border-y border-red-200/40 dark:border-red-900/30"
          >
            {t('governanceQueue.criticalHeader', { count: criticalCount })}
          </td>
        </tr>
      )}
      {showHighHeader && (
        <tr role="row" className="bg-warning-50/20 dark:bg-warning-950/5 select-none border-t">
          <td
            role="cell"
            colSpan={7}
            className="px-3 py-1 text-3xs font-bold text-warning-700 dark:text-warning-400 uppercase tracking-wider font-sans border-y border-warning-200/40 dark:border-red-900/30"
          >
            {t('governanceQueue.highHeader', { count: highCount })}
          </td>
        </tr>
      )}
      {showNormalHeader && (
        <tr role="row" className="bg-slate-50/40 dark:bg-slate-900/40 select-none border-t">
          <td
            role="cell"
            colSpan={7}
            className="px-3 py-1 text-3xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider font-sans border-y border-slate-200/30 dark:border-slate-800/30"
          >
            {t('governanceQueue.normalHeader', { count: normalCount })}
          </td>
        </tr>
      )}
      <tr
        id={taskRowId(task.id)}
        role="row"
        aria-selected={isSelected}
        onClick={() => {
          setHighlightedIndex(idx);
        }}
        className={`h-8 transition-colors duration-75 border-b border-slate-100 dark:border-slate-800 cursor-pointer ${
          isHighlighted
            ? 'bg-brand-50/50 dark:bg-brand-950/20 border-l-2 border-l-brand-600 dark:border-l-brand-500'
            : isSelected
            ? 'bg-brand-50/20 dark:bg-brand-950/5'
            : 'hover:bg-slate-50/80 dark:hover:bg-slate-900/60'
        }`}
      >
        <td role="cell" className="px-2 py-0.5 align-middle text-center border-r border-slate-100 dark:border-slate-900">
          <input
            type="checkbox"
            aria-label={t('governanceQueue.selectTaskAria', { name: task.documentName })}
            checked={isSelected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => {
              setSelectedTaskIds((prev) =>
                prev.includes(task.id)
                  ? prev.filter((id) => id !== task.id)
                  : [...prev, task.id]
              );
            }}
            className="rounded border-slate-300 dark:border-slate-700 text-brand-600 focus:ring-brand-500 cursor-pointer"
          />
        </td>
        <td role="cell" className="px-2.5 py-0.5 align-middle border-r border-slate-100 dark:border-slate-900">
          <Badge variant={priorityVariant} title={task.calculated.reason}>
            {/* data-persistent-motion: the Critical dot pulses forever by design,
                it is an urgency signal rather than a loading affordance. The
                accessibility suites settle by waiting for animation to stop, so
                without this marker a queue containing one critical task would
                never look "loaded" and the axe run would time out instead. */}
            <span data-persistent-motion="true" className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            {level}
            {task.calculated.isAged && (
              // aria-hidden: a screen reader would otherwise announce the glyph's
              // Unicode name ("stopwatch") with nothing tying it to "this task has
              // aged". The Badge's own title carries task.calculated.reason, which
              // states that in words.
              <span aria-hidden="true" className="text-5xs opacity-75 ml-0.5">⏱️</span>
            )}
          </Badge>
        </td>
        <td
          role="cell"
          className="px-2.5 py-0.5 align-middle border-r border-slate-100 dark:border-slate-900 truncate font-bold text-slate-900 dark:text-white"
          title={task.documentName}
        >
          {task.documentName}
        </td>
        <td
          role="cell"
          className="px-2.5 py-0.5 align-middle border-r border-slate-100 dark:border-slate-900 truncate text-slate-800 dark:text-slate-300"
          title={task.feedbackType}
        >
          {task.feedbackType}
        </td>
        <td
          role="cell"
          className="px-2.5 py-0.5 align-middle border-r border-slate-100 dark:border-slate-900 truncate text-slate-600 dark:text-slate-400"
          title={task.owner}
        >
          {task.owner}
        </td>
        <td role="cell" className="px-2.5 py-0.5 align-middle border-r border-slate-100 dark:border-slate-900 font-mono text-3xs text-slate-500">
          {Math.round(task.calculated.ageInDays)}d
        </td>
        <td role="cell" className="px-2.5 py-0.5 align-middle text-right">
          <div className="flex items-center justify-end gap-1.5 h-8">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleTransitionTask(task.id, 'Under Review');
                setActiveReviewTask(task);
              }}
              className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-brand-600 dark:hover:bg-brand-700 px-2 py-0.5 rounded-xs text-3xs font-bold cursor-pointer transition-colors"
            >
              {t('governanceQueue.reviewButton')}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDispatchPortal(task);
              }}
              className="bg-warning-600 hover:bg-warning-600 text-white px-2 py-0.5 rounded-xs text-3xs font-bold cursor-pointer transition-colors"
            >
              {t('governanceQueue.dispatchButton')}
            </button>
          </div>
        </td>
      </tr>
    </React.Fragment>
  );
});

interface GovernanceQueueTableProps {
  sortedTasks: PrioritizedReviewTask[];
  criticalCount: number;
  highCount: number;
  normalCount: number;
  highlightedIndex: number;
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedTaskIds: string[];
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<string[]>>;
  allSelected: boolean;
  onToggleAll: () => void;
  handleTransitionTask: (taskId: string, nextStatus: 'Under Review' | 'Grounded & Updated') => void;
  setActiveReviewTask: (task: ReviewTask | null) => void;
  handleOpenDispatchPortal: (task: ReviewTask) => void;
}

/**
 * The prioritized, grouped work-queue table for the Governance panel.
 * Extracted from GovernancePanel — purely presentational, all state lives
 * in the parent.
 */
export const GovernanceQueueTable: React.FC<GovernanceQueueTableProps> = ({
  sortedTasks,
  criticalCount,
  highCount,
  normalCount,
  highlightedIndex,
  setHighlightedIndex,
  selectedTaskIds,
  setSelectedTaskIds,
  allSelected,
  onToggleAll,
  handleTransitionTask,
  setActiveReviewTask,
  handleOpenDispatchPortal,
}) => {
  const { t } = useLocale();
  let renderedCriticalHeader = false;
  let renderedHighHeader = false;
  let renderedNormalHeader = false;

  if (sortedTasks.length === 0) {
    return (
      <EmptyState className="m-6" title={t('governanceQueue.emptyState')} />
    );
  }

  return (
    <table role="table" aria-label={t('governanceQueue.tableAria')} aria-rowcount={sortedTasks.length} className="w-full text-xs text-left table-fixed border-collapse">
      <colgroup>
        <col className="w-[36px]" />
        <col className="w-[110px]" />
        <col className="w-[30%]" />
        <col className="w-[20%]" />
        <col className="w-[18%]" />
        <col className="w-[60px]" />
        <col className="w-[130px]" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase text-4xs font-mono tracking-wider">
        <tr role="row" className="h-7">
          <th role="columnheader" className="px-2 py-1 align-middle text-center border-r border-slate-200/50 dark:border-slate-800/50">
            <input
              type="checkbox"
              aria-label={t('governanceQueue.selectAllAria')}
              checked={allSelected}
              onChange={onToggleAll}
              className="rounded border-slate-300 dark:border-slate-700 text-brand-600 focus:ring-brand-500 cursor-pointer"
            />
          </th>
          <th role="columnheader" className="px-2.5 py-1 align-middle border-r border-slate-200/50 dark:border-slate-800/50">
            {t('governanceQueue.headers.prioritySystem')}
          </th>
          <th role="columnheader" className="px-2.5 py-1 align-middle border-r border-slate-200/50 dark:border-slate-800/50">
            {t('governanceQueue.headers.document')}
          </th>
          <th role="columnheader" className="px-2.5 py-1 align-middle border-r border-slate-200/50 dark:border-slate-800/50">
            {t('governanceQueue.headers.anomaly')}
          </th>
          <th role="columnheader" className="px-2.5 py-1 align-middle border-r border-slate-200/50 dark:border-slate-800/50">
            {t('governanceQueue.headers.custodian')}
          </th>
          <th role="columnheader" className="px-2.5 py-1 align-middle border-r border-slate-200/50 dark:border-slate-800/50">
            {t('governanceQueue.headers.age')}
          </th>
          <th role="columnheader" className="px-2.5 py-1 align-middle text-right">{t('governanceQueue.headers.action')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800">
        {sortedTasks.map((task, idx) => {
          const level = task.calculated.level;
          const showCriticalHeader = level === 'Critical' && !renderedCriticalHeader;
          const showHighHeader = level === 'High' && !renderedHighHeader;
          const showNormalHeader = level === 'Normal' && !renderedNormalHeader;

          if (showCriticalHeader) renderedCriticalHeader = true;
          if (showHighHeader) renderedHighHeader = true;
          if (showNormalHeader) renderedNormalHeader = true;

          return (
            <GovernanceQueueRow
              key={task.id}
              task={task}
              idx={idx}
              isHighlighted={highlightedIndex === idx}
              isSelected={selectedTaskIds.includes(task.id)}
              showCriticalHeader={showCriticalHeader}
              showHighHeader={showHighHeader}
              showNormalHeader={showNormalHeader}
              criticalCount={criticalCount}
              highCount={highCount}
              normalCount={normalCount}
              setHighlightedIndex={setHighlightedIndex}
              setSelectedTaskIds={setSelectedTaskIds}
              handleTransitionTask={handleTransitionTask}
              setActiveReviewTask={setActiveReviewTask}
              handleOpenDispatchPortal={handleOpenDispatchPortal}
            />
          );
        })}
      </tbody>
    </table>
  );
};
