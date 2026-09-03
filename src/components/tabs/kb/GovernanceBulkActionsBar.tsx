/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CheckCircle2, Users, X } from 'lucide-react';
import { exportToCsv } from '../../../utils/csvExport';
import { ReviewTask } from '../../../types';
import { useLocale } from '../../../context/LocaleContext';

const ASSIGNABLE_OWNERS = ['Commercial Director', 'Telecommunications Specialist', 'Operations Manager'];

interface GovernanceBulkActionsBarProps {
  reviewTasks: ReviewTask[];
  selectedTaskIds: string[];
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<string[]>>;
  handleBulkApprove: () => void;
  handleBulkAssign: (newOwner: string) => void;
  handleBulkArchive: () => void;
}

/**
 * Bulk-operations toolbar shown above the Governance queue table when one or
 * more rows are selected. Extracted from GovernancePanel.
 */
export const GovernanceBulkActionsBar: React.FC<GovernanceBulkActionsBarProps> = ({
  reviewTasks,
  selectedTaskIds,
  setSelectedTaskIds,
  handleBulkApprove,
  handleBulkAssign,
  handleBulkArchive,
}) => {
  const { t } = useLocale();
  if (selectedTaskIds.length === 0) return null;

  return (
    <div className="flex-shrink-0 px-6 py-2 bg-brand-50/40 dark:bg-brand-950/10 border-b border-brand-100 dark:border-brand-900/30 flex items-center justify-between animate-in slide-in-from-top-2 duration-150">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-brand-900 dark:text-brand-400">
          {t('governanceBulk.itemsSelected', { count: selectedTaskIds.length })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleBulkApprove}
          className="flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 rounded-sm text-2xs font-bold cursor-pointer transition-colors"
        >
          <CheckCircle2 className="h-3 w-3" />
          {t('governanceBulk.approveGrounded')}
        </button>
        <div className="relative group">
          <button className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 text-slate-800 dark:text-slate-300 px-2.5 py-1 rounded-sm text-2xs font-bold cursor-pointer transition-colors">
            <Users className="h-3 w-3" />
            {t('governanceBulk.assignSelected')}
          </button>
          <div className="hidden group-hover:block absolute right-0 bottom-full mb-1 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-sm shadow-md py-1 z-50">
            <div className="px-2 py-1 text-4xs font-bold text-slate-400 uppercase tracking-wider font-mono">
              {t('governanceBulk.selectCustodian')}
            </div>
            {ASSIGNABLE_OWNERS.map((owner) => (
              <button
                key={owner}
                onClick={() => handleBulkAssign(owner)}
                className="w-full text-left px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              >
                {owner}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleBulkArchive}
          className="flex items-center gap-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-sm text-2xs font-bold cursor-pointer transition-colors"
        >
          {t('governanceBulk.archive')}
        </button>
        <button
          onClick={() => exportToCsv(
            reviewTasks,
            [
              { key: 'id', header: 'ID' },
              { key: 'documentName', header: 'Document' },
              { key: 'feedbackType', header: 'Feedback type' },
              { key: 'status', header: 'Status' },
              { key: 'owner', header: 'Owner' },
              { key: 'department', header: 'Department' },
              { key: 'priority', header: 'Priority' },
              { key: 'createdAt', header: 'Created at' },
            ],
            `review-tasks-${new Date().toISOString().slice(0, 10)}.csv`
          )}
          className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-sm text-2xs font-bold cursor-pointer transition-colors"
        >
          {t('common.export')}
        </button>
        <button
          onClick={() => setSelectedTaskIds([])}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-400 p-1 cursor-pointer"
          aria-label={t('governanceBulk.clearSelectionAria')}
          title={t('governanceBulk.clearSelectionTitle')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
