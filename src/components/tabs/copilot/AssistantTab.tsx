/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext, useState, useEffect, useMemo } from 'react';
import { Search, Sparkles, Check } from 'lucide-react';
import { KBDocument } from '../../../types';
import { documentApi } from '../../../api/documentApi';
import { useBreadcrumbs } from '../../../context/BreadcrumbContext';
import { BrandContext } from '../../../context/BrandContext';
import { useDepartment } from '../../../hooks/useDepartment';
import { SearchResultPanel } from './SearchResultPanel';
import { useLocale } from '../../../context/LocaleContext';

import { SearchLoadingSkeleton } from './SearchLoadingSkeleton';
import { AssistantErrorAlert } from './AssistantErrorAlert';
import { QuickActionsSection } from './QuickActionsSection';
import { SuggestedContentSection } from './SuggestedContentSection';
import { SourceDetailModal } from './SourceDetailModal';
import { FullDocumentDrawer } from './FullDocumentDrawer';
import { ReportIssueModal } from './ReportIssueModal';
import { ShareResourceModal } from './ShareResourceModal';
import { useAssistantSearch } from '../../../hooks/useAssistantSearch';
import { useAssistantToast } from '../../../hooks/useAssistantToast';
import { useAssistantBreadcrumbs } from '../../../hooks/useAssistantBreadcrumbs';
import { buildReportReviewTask, enqueueReviewTask } from '../../../services/reviewQueueService';
import { downloadKbDocument } from '../../../utils/documentDownload';

export const AssistantTab: React.FC = () => {
  const { t, locale } = useLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  const brandCtx = useContext(BrandContext);
  const activeBrandId = brandCtx?.activeBrand?.id;
  const { activeDepartment } = useDepartment();

  const { toastMessage, showToast } = useAssistantToast();

  const {
    searchQuery,
    setSearchQuery,
    searchResult,
    setSearchResult,
    isSearching,
    searchError,
    setSearchError,
    isApiKeyConfigured,
    retrievalSource,
    retrievalMode,
    timings,
    helpfulState,
    setHelpfulState,
    followUpQuery,
    setFollowUpQuery,
    performSearch,
    handleSearch,
    handleFeedbackSubmit,
    handlePrepareFollowUp,
    emptyQueryHint,
    setEmptyQueryHint,
  } = useAssistantSearch({ activeBrandId, activeDepartmentId: activeDepartment.id, showToast, t, locale });

  // Real KB documents that back the "Common Operational Questions" and "Recent
  // Policy Changes" sections. Loaded per active brand; the sections filter to
  // the active department client-side.
  const [kbDocuments, setKbDocuments] = useState<KBDocument[]>([]);
  useEffect(() => {
    let stale = false;
    // The suggestion sections only render a handful of items, so this asks for
    // the server's default page instead of 1000 full documents (each carrying
    // its whole `content`) just to derive a few titles. A dedicated
    // metadata-only endpoint is the real fix — tracked in the backlog.
    documentApi.getDocuments(activeBrandId, { limit: 200 })
      .then((res) => {
        if (stale) return;
        if (res.success && res.data?.documents) setKbDocuments(res.data.documents);
      })
      .catch((err) => console.error('Assistant: failed to load KB documents for suggestions:', err));
    return () => { stale = true; };
  }, [activeBrandId]);

  // Every suggestion click (quick action, common question, recent change) runs
  // the same real grounded search — one consistent path, no mock answers.
  const runSuggestedSearch = (query: string) => {
    setSearchQuery(query);
    performSearch(query);
  };

  useAssistantBreadcrumbs({
    searchResult,
    setBreadcrumbs,
    t,
    setSearchQuery,
    setSearchResult,
    setSearchError,
    setHelpfulState,
    setFollowUpQuery,
  });

  // Modal / Interaction states
  const [activeSourceModal, setActiveSourceModal] = useState<{ name: string; fileExt: string } | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

  // Form input in report modal
  const [reportDetails, setReportDetails] = useState('');
  const [reportCategory, setReportCategory] = useState('Outdated Information');

  // Clipboard copy state helper
  const [copiedLink, setCopiedLink] = useState(false);

  // Resolve one of the answer's cited sources to the real KB document (which
  // carries the full text/content) — by id first, then by exact name. The
  // answer only holds {id, name}, so without this lookup the "full document"
  // views had nothing but the AI's synthesized summary to show.
  const resolveSourceDoc = (src?: { id?: string; name?: string } | null): KBDocument | null => {
    if (!src) return null;
    if (src.id) {
      const byId = kbDocuments.find((d) => d.id === src.id);
      if (byId) return byId;
    }
    const name = src.name?.trim().toLowerCase();
    if (!name) return null;
    return kbDocuments.find((d) => (d.name || '').trim().toLowerCase() === name) || null;
  };

  // The primary source document backing the current answer — drives the
  // "View full document" drawer.
  const primarySourceDoc = useMemo(
    () => resolveSourceDoc(searchResult?.sources?.[0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchResult, kbDocuments]
  );

  const handleSourceClick = (name: string, fileExt: string) => {
    setActiveSourceModal({ name, fileExt });
  };

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDetails.trim()) return;

    // Turn the report into a real Governance review task so it lands in the
    // work queue and routes to the document owner — instead of being discarded.
    const documentName =
      searchResult?.sources?.[0]?.name || searchResult?.title || 'Unattributed answer';
    const task = buildReportReviewTask({
      category: reportCategory,
      details: reportDetails,
      documentName,
      agentQuery: searchQuery || searchResult?.title || '',
      owner: searchResult?.reviewOwner || 'Unassigned',
      department: activeDepartment.displayName,
      departmentIds: [activeDepartment.id],
      aiConfidence: searchResult?.confidenceScore,
    });
    enqueueReviewTask(task);

    setIsReportModalOpen(false);
    setReportDetails('');
    setReportCategory('Outdated Information');
    showToast(t('assistant.toasts.issueFiled'));
  };

  const handleCopyLink = () => {
    const mockUrl = `https://enterprise.internal/governance/document/${searchResult?.id || 'doc'}`;
    // navigator.clipboard is undefined in insecure/unsupported contexts; calling
    // .writeText on it throws synchronously, so the .catch below would never run.
    if (!navigator.clipboard?.writeText) {
      showToast('Could not copy link — please copy it manually.');
      return;
    }
    navigator.clipboard.writeText(mockUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }).catch(err => {
      console.error('Failed to copy link to clipboard:', err);
      showToast('Could not copy link — please copy it manually.');
    });
  };

  return (
    <div className="space-y-6 font-sans text-left max-w-6xl mx-auto py-6 px-4 relative">

      {/* Toast Notification HUD */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5 border border-slate-800 dark:border-slate-200 animate-slideUp text-xs font-semibold">
          <Check className="h-4 w-4 text-brand-400 dark:text-brand-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-900 pb-2 select-none">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Assistant
          </h1>
        </div>
      </header>

      {/* Banner de API Key faltante */}
      {isApiKeyConfigured === false && (
        <div className="bg-warning-50 dark:bg-warning-950/20 border border-warning-200 dark:border-warning-900/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-warning-900 dark:text-warning-200 text-xs font-medium animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-sm">💡</span>
            <span>{t('assistant.offlineBanner.text')} <strong>{t('assistant.offlineBanner.fuzzyNote')}</strong></span>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'settings' }))}
            className="px-3 py-1.5 bg-warning-600 hover:bg-warning-700 active:bg-warning-800 text-white text-2xs font-bold rounded-lg transition-colors shrink-0 self-start sm:self-auto cursor-pointer shadow-xs"
          >
            {t('assistant.offlineBanner.goToSettings')}
          </button>
        </div>
      )}

      {/* Quick Actions (Suggested Questions) visible prior to active search output */}
      {!searchResult && !isSearching && !searchError && (
        <QuickActionsSection
          departmentId={activeDepartment.id}
          onSelect={runSuggestedSearch}
        />
      )}

      {/* Dominant Search Input Section */}
      <section id="enterprise_search" className="space-y-4">
        <form onSubmit={handleSearch} className="relative max-w-full">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (emptyQueryHint) setEmptyQueryHint(false); }}
            placeholder={t('assistant.searchPlaceholder')}
            aria-label={t('assistant.searchAriaLabel')}
            aria-describedby={emptyQueryHint ? 'search_empty_hint' : undefined}
            className="w-full h-14 pl-14 pr-32 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-base shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all outline-hidden text-slate-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-4 h-9 text-xs font-bold rounded-lg transition-all shadow-xs bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-600"
          >
            {t('common.search')}
          </button>
        </form>
        {/* Visible cue for an empty submit — previously the interaction was
            silently swallowed (role=alert so assistive tech announces it too). */}
        {emptyQueryHint && (
          <p id="search_empty_hint" role="alert" className="text-xs font-semibold text-warning-700 dark:text-warning-400">
            {t('assistant.guards.emptyQuery')}
          </p>
        )}
      </section>

      {/* Persistent screen-reader status region. Lives in the DOM at all times
          (not swapped in/out with the loading/result/error views) so assistive
          tech reliably announces each search state transition. */}
      <div role="status" aria-live="polite" className="sr-only">
        {isSearching
          ? t('assistant.statusSearching')
          : searchError
            ? t('assistant.statusSearchFailed')
            : searchResult
              ? t('assistant.statusResultsReady')
              : ''}
      </div>

      {/* Loading Skeleton View */}
      {isSearching && (
        <SearchLoadingSkeleton />
      )}

      {/* Error View with Actionable Retry Button */}
      {searchError && !isSearching && (
        <AssistantErrorAlert error={searchError} onRetry={() => performSearch(searchQuery)} />
      )}

      {/* Two-Column Search Result Display with Metadata Sidebar */}
      {!isSearching && searchResult && (
        <SearchResultPanel
          searchResult={searchResult}
          retrievalSource={retrievalSource}
          retrievalMode={retrievalMode}
          timings={timings}
          helpfulState={helpfulState}
          setHelpfulState={setHelpfulState}
          followUpQuery={followUpQuery}
          setFollowUpQuery={setFollowUpQuery}
          handlePrepareFollowUp={handlePrepareFollowUp}
          isReportModalOpen={isReportModalOpen}
          setIsReportModalOpen={setIsReportModalOpen}
          onCopy={() => {
            if (!navigator.clipboard?.writeText) {
              showToast('Could not copy answer — please copy it manually.');
              return;
            }
            navigator.clipboard.writeText(searchResult?.content || '')
              .then(() => showToast('Answer copied to clipboard.'))
              .catch(err => {
                console.error('Failed to copy answer to clipboard:', err);
                showToast('Could not copy answer — please copy it manually.');
              });
          }}
          setSearchResult={setSearchResult}
          setSearchError={setSearchError}
          handleFeedbackSubmit={handleFeedbackSubmit}
          handleSourceClick={handleSourceClick}
          setIsDrawerOpen={setIsDrawerOpen}
          setIsShareDialogOpen={setIsShareDialogOpen}
        />
      )}

      {/* Frequently Accessed Docs & Policy Lists (shown if no search results) */}
      {!isSearching && !searchResult && (
        <SuggestedContentSection
          documents={kbDocuments}
          brandId={activeBrandId || ''}
          departmentId={activeDepartment.id}
          onSelect={runSuggestedSearch}
        />
      )}

      {/* --- INTERACTIVE DIALOGS AND OVERLAYS (No window.alert or window.open) --- */}

      {activeSourceModal && (
        <SourceDetailModal
          source={activeSourceModal}
          document={resolveSourceDoc({ name: activeSourceModal.name })}
          onClose={() => setActiveSourceModal(null)}
          onDownload={(source) => {
            // Download the RESOLVED document, not the source stub: the stub carries
            // only a name, and the text to write lives on the KB document. Naming and
            // the extension rewrite are handled in src/utils/documentDownload.ts —
            // source.name already carries its real extension, so nothing re-appends
            // source.fileExt (which used to double it, e.g. "x.pdf.pdf").
            const filename = downloadKbDocument(resolveSourceDoc({ name: source.name }));
            showToast(
              filename
                ? t('kb.docList.downloadToast', { name: filename })
                : t('kb.docList.downloadEmpty', { name: source.name })
            );
            setActiveSourceModal(null);
          }}
        />
      )}

      {isDrawerOpen && (
        <FullDocumentDrawer
          searchResult={searchResult}
          sourceDocument={primarySourceDoc}
          onClose={() => setIsDrawerOpen(false)}
          onCopyFullText={() => showToast('Full text copied to workspace clip!')}
        />
      )}

      {isReportModalOpen && (
        <ReportIssueModal
          reportCategory={reportCategory}
          setReportCategory={setReportCategory}
          reportDetails={reportDetails}
          setReportDetails={setReportDetails}
          onSubmit={handleReportSubmit}
          onClose={() => setIsReportModalOpen(false)}
        />
      )}

      {isShareDialogOpen && (
        <ShareResourceModal
          shareUrl={`https://enterprise.internal/governance/document/${searchResult?.id || 'doc'}`}
          copiedLink={copiedLink}
          onCopyLink={handleCopyLink}
          onClose={() => setIsShareDialogOpen(false)}
        />
      )}

    </div>
  );
};

export default AssistantTab;
