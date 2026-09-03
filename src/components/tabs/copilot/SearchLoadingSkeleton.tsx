/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useLocale } from '../../../context/LocaleContext';
import { SearchResultSkeleton } from '../../shared/Skeletons';

/**
 * Modern Loading Skeleton styled specifically for enterprise policy searching.
 * Extracted from AssistantTab.
 */
export const SearchLoadingSkeleton: React.FC = () => {
  const { t } = useLocale();
  return (
    <div aria-live="polite" aria-label="Search results" className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center space-x-4 p-4 bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/80 rounded-sm">
        <div className="h-10 w-10 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center">
          <div role="status" aria-label="Searching..." className="h-5 w-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <div className="space-y-1 flex-1 text-left">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 tracking-tight">
            {t('assistant.loading.title')}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('assistant.loading.subtitle')}
          </p>
        </div>
      </div>
      <SearchResultSkeleton />
    </div>
  );
};
