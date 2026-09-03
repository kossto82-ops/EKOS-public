/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect } from 'react';
import { Home, Sparkles, Search } from 'lucide-react';
import { BreadcrumbItem } from '../components/shared/Breadcrumb';
import { KnowledgeAnswer } from '../types/knowledge';
import { ApiError } from '../services/baseService';

interface UseAssistantBreadcrumbsArgs {
  searchResult: KnowledgeAnswer | null;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
  t: (path: string) => string;
  setSearchQuery: (val: string) => void;
  setSearchResult: (val: KnowledgeAnswer | null) => void;
  setSearchError: (val: ApiError | null) => void;
  setHelpfulState: (val: 'none' | 'yes' | 'no') => void;
  setFollowUpQuery: (val: string) => void;
}

/**
 * Drives the shared header breadcrumb trail for the Assistant tab. Extracted
 * from AssistantTab.
 */
export function useAssistantBreadcrumbs({
  searchResult,
  setBreadcrumbs,
  t,
  setSearchQuery,
  setSearchResult,
  setSearchError,
  setHelpfulState,
  setFollowUpQuery,
}: UseAssistantBreadcrumbsArgs) {
  useLayoutEffect(() => {
    const handleHomeClick = () => {
      setSearchQuery('');
      setSearchResult(null);
      setSearchError(null);
      setHelpfulState('none');
      setFollowUpQuery('');
      window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }));
    };
    if (searchResult) {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('nav.assistant'), icon: Sparkles, onClick: () => setSearchResult(null) },
        { label: t('assistant.breadcrumbResults'), icon: Search }
      ]);
    } else {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('nav.assistant'), icon: Sparkles }
      ]);
    }
  }, [searchResult, setBreadcrumbs, t]);
}
