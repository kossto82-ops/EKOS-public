/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { AuthContext } from '../../../context/AuthContext';
import { useBrand } from '../../../hooks/useBrand';
import { useDepartment } from '../../../hooks/useDepartment';
import { useToast } from '../../../hooks/useToast';
import { KBDocument } from '../../../types';
import { Database, BookOpen, BarChart2 } from 'lucide-react';
import { useBreadcrumbs } from '../../../context/BreadcrumbContext';
import { useLocale } from '../../../context/LocaleContext';
import { DocumentListSkeleton, MetricCardSkeleton } from '../../shared/Skeletons';
import { setPendingResolveGap } from '../../../utils/crossTabIntent';

import { DocumentAuditProfileDrawer } from './DocumentAuditProfileDrawer';
import { DocumentDetailDrawer } from './DocumentDetailDrawer';
import { DocumentLibrarySection } from './DocumentLibrarySection';
import { useKbDocuments } from '../../../hooks/useKbDocuments';
import { useKbGovernanceData } from '../../../hooks/useKbGovernanceData';
import { useKbBreadcrumbs } from '../../../hooks/useKbBreadcrumbs';

interface KnowledgeBaseTabProps {}

export const KnowledgeBaseTab: React.FC<KnowledgeBaseTabProps> = () => {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useLocale();
  const { activeBrand } = useBrand();
  const { activeDepartment } = useDepartment();
  const auth = useContext(AuthContext);
  const toast = useToast();

  const [activeSubTab, setActiveSubTab] = useState<'library' | 'metrics'>('library');
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Clear the selected doc too, not just the open flag: the audit-profile
  // drawer is keyed off `selectedDoc`, so leaving it set would pop that drawer
  // open the moment the detail drawer closes.
  const handleCloseDocDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setSelectedDoc(null);
  }, []);

  // Trigger brief skeleton loaders on sub-tab or brand changes
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [activeSubTab, activeBrand]);

  // Whether the caller governs ALL departments and should therefore see every
  // review-queue task regardless of the active-department selector — i.e. any
  // user scoped to '*' (Administrators). This replaces the old
  // `userDepartments.length === 10` count, which silently broke whenever the
  // DEPARTMENTS list changed and could hide cross-department tasks — e.g. a
  // document whose owner left the company — from the very admins meant to
  // triage them. Team Leaders remain scoped to their own department(s).
  const canSeeAllDepartments = (auth?.currentUser?.departmentIds || []).includes('*');

  const {
    documents,
    filteredDocuments,
    handleUploadDoc,
    handleDeleteDoc,
    handleUpdateDoc,
    updateDocumentApproval,
    hasMoreDocuments,
    isLoadingMoreDocuments,
    loadMoreDocuments,
  } = useKbDocuments({
    brandId: activeBrand.id,
    departmentId: activeDepartment.id,
    toast,
  });

  // The review/governance workflow (approve/reject/ban, search-gap sandbox,
  // dispatch) is no longer part of this tab — it is the separate Review Queue
  // top-level destination (see ReviewQueueTab.tsx). This hook is still reused
  // here (rather than duplicated) purely for the search-gap data the Metrics
  // sub-tab displays; the review-queue-specific fields it also returns
  // (reviewTasks, selection, dispatch/sandbox state, etc.) are unused here.
  const {
    searchGaps,
  } = useKbGovernanceData({
    departmentId: activeDepartment.id,
    canSeeAllDepartments,
    documents,
    updateDocumentApproval,
    toast,
  });

  if (!auth) return null;
  const { canPerformAction, canAccess } = auth;
  const canManageKB = canPerformAction('upload_kb');
  // Gate the "Resolve" action on a search gap (Metrics sub-tab) on the SAME
  // predicate that gates the Review Queue tab itself (canAccess('review') =
  // Administrator/LocationManager, mirroring the server's
  // canAccessTab('governance') check on the approve/ban/tasks routes) —
  // resolving a gap opens the Sandbox editor that now lives exclusively on
  // that tab, so a user who cannot reach it should not be offered the action.
  const canViewReviewQueue = canAccess('review');

  // Clicking "Resolve" on a search gap (DocumentMetricsView, via
  // DocumentLibrarySection) opens the Sandbox editor, which lives on the
  // separate Review Queue tab.
  //
  // The gap is left in a slot rather than dispatched as an event. Only one tab
  // is mounted at a time, so an event fired from here reaches no listener at
  // all: the review queue registers its handler when it mounts, which is after
  // the navigation this function triggers. That ordering made the action a
  // silent no-op — it navigated and opened nothing. The receiver drains the slot
  // on mount instead, which has no such race.
  const handleRequestResolveGap = useCallback((gapId: string, queryText: string) => {
    if (!canViewReviewQueue) {
      toast.error(t('kb.metrics.resolveGapForbidden'));
      return;
    }
    setPendingResolveGap({ gapId, queryText });
    window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'review' }));
  }, [canViewReviewQueue, toast, t]);

  useKbBreadcrumbs({
    activeSubTab,
    isDrawerOpen,
    selectedDoc,
    setBreadcrumbs,
    t,
    setSelectedDoc,
    setIsDrawerOpen,
    setActiveSubTab,
  });

  return (
    <div className="flex flex-col h-full">
      {/* 1. Subtitle & Global Metric Context Description */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-2 select-none">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-sans uppercase tracking-wider flex items-center gap-2">
            <Database className="h-4 w-4 text-brand-500" /> Documents
          </h2>
        </div>

        {/* Beautiful Workspace Sub-Tab Switcher */}
        <div
          role="tablist"
          aria-label="Knowledge Base Sub-tabs"
          className="flex bg-slate-100 dark:bg-slate-900 rounded-lg p-0.5 border border-slate-200/50 dark:border-slate-800 font-sans text-xs select-none"
        >
          <button
            id="kb_subtab_library"
            role="tab"
            aria-selected={activeSubTab === 'library'}
            aria-controls={activeSubTab === 'library' && !isLoading ? 'kb_panel_library' : undefined}
            onClick={() => setActiveSubTab('library')}
            className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
              activeSubTab === 'library'
                ? 'bg-white text-slate-900 dark:bg-slate-800 dark:text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t('kb.subTabs.repository')}
          </button>
          <button
            id="kb_subtab_metrics"
            role="tab"
            aria-selected={activeSubTab === 'metrics'}
            aria-controls={activeSubTab === 'metrics' && !isLoading ? 'kb_panel_metrics' : undefined}
            onClick={() => setActiveSubTab('metrics')}
            className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
              activeSubTab === 'metrics'
                ? 'bg-white text-slate-900 dark:bg-slate-800 dark:text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
            }`}
          >
            <BarChart2 className="h-3.5 w-3.5 text-brand-500" />
            {t('kb.subTabs.metrics')}
          </button>
        </div>
      </div>

      {/* Main workspace container space */}
      <div className="flex-1 overflow-hidden min-h-0 pt-4">
        {isLoading ? (
          <div tabIndex={0} className="h-full overflow-y-auto px-1" role="status" aria-busy="true" aria-label="Loading content">
            {activeSubTab === 'library' && <DocumentListSkeleton count={5} />}
            {activeSubTab === 'metrics' && (
              <div className="space-y-6">
                <MetricCardSkeleton count={3} />
                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-sm space-y-4">
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-1/4 animate-pulse" />
                  <div className="space-y-2">
                    <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-full animate-pulse" />
                    <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-11/12 animate-pulse" />
                    <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-5/6 animate-pulse" />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <DocumentLibrarySection
            activeSubTab={activeSubTab}
            filteredDocuments={filteredDocuments}
            onUploadDoc={handleUploadDoc}
            onDeleteDoc={handleDeleteDoc}
            canManageKB={canManageKB}
            brandId={activeBrand.id}
            brandDisplayName={activeBrand.displayName}
            setSelectedDoc={setSelectedDoc}
            setIsDrawerOpen={setIsDrawerOpen}
            searchGaps={searchGaps}
            handleResolveGap={handleRequestResolveGap}
            hasMoreDocuments={hasMoreDocuments}
            isLoadingMoreDocuments={isLoadingMoreDocuments}
            onLoadMoreDocuments={loadMoreDocuments}
          />
        )}
      </div>

      {/* Slide drawers */}
      {isDrawerOpen && (
        <DocumentDetailDrawer
          doc={selectedDoc}
          onClose={handleCloseDocDrawer}
          canEdit={
            canManageKB ||
            (!!selectedDoc?.ownerId && selectedDoc.ownerId === auth.currentUser.id)
          }
          canManage={canManageKB}
          onSave={async (id, patch) => {
            const updated = await handleUpdateDoc(id, patch);
            // Keep the open drawer in sync from the AUTHORITATIVE server row
            // (handleUpdateDoc returns it) — the server may have changed fields
            // the client didn't send (version bump, approvalStatus → Under
            // Review on a content edit). selectedDoc is a separate copy.
            if (updated) setSelectedDoc((prev) => (prev && prev.id === id ? updated : prev));
            return !!updated;
          }}
          users={auth.allUsers}
          // Closing the detail drawer while keeping selectedDoc set surfaces the
          // audit-profile drawer (gated on `selectedDoc && !isDrawerOpen`).
          onViewAudit={() => setIsDrawerOpen(false)}
        />
      )}

      {/* The audit-profile drawer and the detail drawer are both keyed off the
          same document selection. Only show the audit profile when the detail
          drawer is NOT open, so a document click opens the single (editable)
          detail view instead of stacking two right-hand drawers with duelling
          focus traps. */}
      {selectedDoc && !isDrawerOpen && (
        <DocumentAuditProfileDrawer
          selectedDoc={selectedDoc}
          setSelectedDoc={setSelectedDoc}
          documents={filteredDocuments}
        />
      )}
    </div>
  );
};

export default KnowledgeBaseTab;
