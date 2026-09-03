/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect } from 'react';
import { Home, Library, Eye, FileText, BookOpen, BarChart2 } from 'lucide-react';
import { BreadcrumbItem } from '../components/shared/Breadcrumb';
import { KBDocument } from '../types';

interface UseKbBreadcrumbsArgs {
  activeSubTab: 'library' | 'metrics';
  isDrawerOpen: boolean;
  selectedDoc: KBDocument | null;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
  t: (path: string) => string;
  setSelectedDoc: (doc: KBDocument | null) => void;
  setIsDrawerOpen: (open: boolean) => void;
  setActiveSubTab: (tab: 'library' | 'metrics') => void;
}

/**
 * Drives the shared header breadcrumb trail for the Knowledge Base tab based
 * on which drawer/sub-tab is currently active. Extracted from
 * KnowledgeBaseTab.
 *
 * The review/governance workflow no longer lives here — it is its own
 * top-level tab (see ReviewQueueTab.tsx and its own breadcrumb wiring), so
 * this hook only ever deals with 'library' and 'metrics'.
 */
export function useKbBreadcrumbs({
  activeSubTab,
  isDrawerOpen,
  selectedDoc,
  setBreadcrumbs,
  t,
  setSelectedDoc,
  setIsDrawerOpen,
  setActiveSubTab,
}: UseKbBreadcrumbsArgs) {
  useLayoutEffect(() => {
    const handleHomeClick = () => {
      setSelectedDoc(null);
      setIsDrawerOpen(false);
      window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }));
    };
    const handleDocumentsClick = () => {
      setSelectedDoc(null);
      setIsDrawerOpen(false);
      setActiveSubTab('library');
      window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'kb' }));
    };

    if (isDrawerOpen && selectedDoc) {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('kb.breadcrumb.documents'), icon: Library, onClick: handleDocumentsClick },
        { label: t('kb.breadcrumb.detail'), icon: Eye },
        { label: selectedDoc.name, icon: FileText }
      ]);
    } else if (activeSubTab === 'library') {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('kb.breadcrumb.documents'), icon: Library, onClick: handleDocumentsClick },
        { label: t('kb.breadcrumb.library'), icon: BookOpen }
      ]);
    } else {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('kb.breadcrumb.documents'), icon: Library, onClick: handleDocumentsClick },
        { label: t('kb.subTabs.metrics'), icon: BarChart2 }
      ]);
    }
  }, [activeSubTab, isDrawerOpen, selectedDoc, setBreadcrumbs, t]);
}
