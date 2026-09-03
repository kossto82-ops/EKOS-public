import React from 'react';
import {
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Check,
  FileText,
  BookOpen,
  Flag,
  Share2,
  AlertTriangle,
  Layers,
  Clock
} from 'lucide-react';
import { EnterpriseAnswer } from './EnterpriseAnswer';
import { KnowledgeAnswer, KnowledgeAnswerSource } from '../../../types/knowledge';
import { SearchTimings } from '../../../types/apiContracts';
import { ApiError } from '../../../services/baseService';
import { useLocale } from '../../../context/LocaleContext';

interface SearchResultPanelProps {
  searchResult: KnowledgeAnswer;
  retrievalSource: 'live_ai' | 'local_fallback' | null;
  /** 'lexical' means semantic search did not run — see the banner below. */
  retrievalMode: 'hybrid' | 'lexical' | null;
  /** Per-stage wall clock. null for the offline fallback, which never called the server. */
  timings: SearchTimings | null;
  helpfulState: 'none' | 'yes' | 'no';
  setHelpfulState: (val: 'none' | 'yes' | 'no') => void;
  followUpQuery: string;
  setFollowUpQuery: (val: string) => void;
  handlePrepareFollowUp: () => void;
  isReportModalOpen: boolean;
  setIsReportModalOpen: (val: boolean) => void;
  onCopy: () => void;
  setSearchResult: (val: KnowledgeAnswer | null) => void;
  setSearchError: (val: ApiError | null) => void;
  handleFeedbackSubmit: (val: 'yes' | 'no') => void;
  handleSourceClick: (name: string, ext: string) => void;
  setIsDrawerOpen: (val: boolean) => void;
  setIsShareDialogOpen: (val: boolean) => void;
}

export const SearchResultPanel: React.FC<SearchResultPanelProps> = ({
  searchResult,
  retrievalSource,
  retrievalMode,
  timings,
  helpfulState,
  followUpQuery,
  setFollowUpQuery,
  handlePrepareFollowUp,
  setIsReportModalOpen,
  setSearchResult,
  setSearchError,
  handleFeedbackSubmit,
  handleSourceClick,
  setIsDrawerOpen,
  setIsShareDialogOpen,
}) => {
  const { t } = useLocale();
  if (!searchResult) return null;

  // Several documents matched the query with comparable relevance — surface a
  // disambiguation hint so the user can pick the right source (or refine) rather
  // than assuming the top answer is the only relevant document. Gated on real
  // server-retrieval scores so the offline fallback's decorative source pairs
  // never produce a false "multiple matches" claim.
  // How long the answer took, and which stage spent it. Shown because the number
  // was measured server-side from the beginning and then discarded by the client:
  // a user who finds search slow could not tell a slow provider from slow
  // retrieval, and neither could anyone they reported it to. One decimal — this
  // is an order-of-magnitude cue, not a benchmark.
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  const rankedSources = searchResult.sources || [];
  const hasMultipleRelated =
    rankedSources.length > 1 &&
    rankedSources[0]?.score != null &&
    rankedSources[1]?.score != null &&
    rankedSources[1].score >= rankedSources[0].score * 0.5;

  return (
    <section id="answer_layout" className="space-y-5 pt-2 animate-fadeIn">
      
      {/* Reset back to hub link */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800/40">
        <button 
          onClick={() => {
            setSearchResult(null);
            setSearchError(null);
          }} 
          aria-label={t('assistant.result.clearSearch')}
          className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('assistant.result.backToHub')}
        </button>
        <div className="flex items-center gap-3">
          {timings && (
            <span className="text-3xs font-medium text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              <span>{t('assistant.result.timingTotal', { total: seconds(timings.totalMs) })}</span>
              <span className="text-slate-300 dark:text-slate-600">
                {t('assistant.result.timingBreakdown', {
                  llm: seconds(timings.llmMs),
                  retrieval: seconds(timings.retrievalMs + timings.candidatesMs),
                })}
              </span>
            </span>
          )}
          <span className="text-3xs font-mono text-slate-400">ID: {searchResult.id}</span>
        </div>
      </div>

      {/*
        Keyword-only retrieval. Distinct from the simulated-answer banner below it:
        there the LLM was unavailable, here the LLM answered normally but was
        grounded on documents found without semantic search. Both can be true at
        once, and both are shown, because they are different reasons to distrust
        the answer.
      */}
      {retrievalMode === 'lexical' && (
        <div
          role="status"
          className="flex items-start gap-2.5 p-3.5 rounded-xl bg-warning-50 dark:bg-warning-950/20 border border-warning-200 dark:border-warning-900/50 text-warning-900 dark:text-warning-200 text-xs font-medium"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>{t('assistant.result.keywordOnlyTitle')}</strong> {t('assistant.result.keywordOnlyBody')}
          </span>
        </div>
      )}

      {retrievalSource === 'local_fallback' && (
        <div
          role="status"
          className="flex items-start gap-2.5 p-3.5 rounded-xl bg-warning-50 dark:bg-warning-950/20 border border-warning-200 dark:border-warning-900/50 text-warning-900 dark:text-warning-200 text-xs font-medium"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>{t('assistant.result.simulatedTitle')}</strong> {t('assistant.result.simulatedBody')}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-8 items-start">

        {/* Left Column (70%): EnterpriseAnswer and Feedback UI */}
        <div className="lg:col-span-7 space-y-6">

          {hasMultipleRelated && (
            <div
              role="status"
              className="flex items-start gap-2.5 p-3.5 rounded-xl bg-brand-50/60 dark:bg-brand-950/20 border border-brand-100 dark:border-brand-900/40 text-brand-900 dark:text-brand-200 text-xs font-medium"
            >
              <Layers className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>{t('assistant.result.multipleMatchesTitle', { count: rankedSources.length })}</strong>{' '}
                {t('assistant.result.multipleMatchesBody')}
              </span>
            </div>
          )}

          <div aria-live="polite" aria-label="Search results" className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800/80 p-6 md:p-8">
            <EnterpriseAnswer answer={searchResult} retrievalSource={retrievalSource} />
          </div>

          {/* Feedback and Ask Follow-up Area */}
          <div className="bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100/80 dark:border-slate-800/60 rounded-xl p-6 space-y-4">
            
            {/* Helpful Rating */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                  {t('assistant.result.helpfulQuestion')}
                </p>
                <p className="text-2xs text-slate-500 dark:text-slate-400">
                  {t('assistant.result.helpfulSubtitle')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {helpfulState === 'none' ? (
                  <>
                    <button
                      onClick={() => handleFeedbackSubmit('yes')}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      {t('assistant.result.yes')}
                    </button>
                    <button
                      onClick={() => handleFeedbackSubmit('no')}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-danger-600 dark:hover:text-danger-400 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                      {t('assistant.result.no')}
                    </button>
                  </>
                ) : (
                  <span className="text-xs font-bold text-success-600 dark:text-success-400 flex items-center gap-1.5 bg-success-50 dark:bg-success-950/30 px-3.5 py-1.5 rounded-lg border border-success-100 dark:border-success-900/40 animate-fadeIn">
                    <Check className="h-3.5 w-3.5" />
                    {t('assistant.result.feedbackThanks')}
                  </span>
                )}
              </div>
            </div>

            <div className="h-px bg-slate-200/50 dark:bg-slate-800/40"></div>

            {/* Follow-up search helper */}
            <div className="space-y-3">
              <label htmlFor="followup_input" className="block text-xs font-extrabold text-slate-800 dark:text-slate-200">
                {t('assistant.result.followUpLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  id="followup_input"
                  type="text"
                  value={followUpQuery}
                  onChange={(e) => setFollowUpQuery(e.target.value)}
                  placeholder={t('assistant.result.followUpPlaceholder')}
                  aria-label={t('assistant.result.followUpAria')}
                  className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-white outline-hidden focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all font-medium"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handlePrepareFollowUp();
                    }
                  }}
                />
                <button
                  onClick={handlePrepareFollowUp}
                  aria-label={t('assistant.result.followUpSubmit')}
                  className="px-3.5 py-2 bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/40 dark:hover:bg-brand-900/60 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-900 text-xs font-bold rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {t('assistant.result.followUpSubmit')}
                </button>
              </div>
              <p className="text-3xs text-slate-400 dark:text-slate-500 font-medium select-none">
                {t('assistant.result.followUpNote')}
              </p>
            </div>

            {/* Inline link reports */}
            <div className="text-right pt-1">
              <button
                onClick={() => setIsReportModalOpen(true)}
                aria-label={t('assistant.result.reportLink')}
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 underline cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded-sm"
              >
                {t('assistant.result.reportLink')}
              </button>
            </div>

          </div>

        </div>

        {/* Right Column (30%): Metadata Governance Sidebar */}
        <div className="lg:col-span-3 space-y-5 lg:border-l lg:border-slate-100 lg:dark:border-slate-800/80 lg:pl-6 select-none">
          
          {/* Box 1: Confidence Bar */}
          <div className="p-4 rounded-xl bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 space-y-3">
            <p className="text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center justify-between">
              <span>{t('assistant.result.confidenceScore')}</span>
              <span className="text-brand-600 dark:text-brand-400 font-extrabold text-xs">{searchResult.confidenceScore}%</span>
            </p>
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-brand-600 dark:bg-brand-400 rounded-full transition-all duration-500"
                style={{ width: `${searchResult.confidenceScore}%` }}
              ></div>
            </div>
            <p className="text-3xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
              {searchResult.confidenceScore >= 95
                ? t('assistant.result.confidenceHigh')
                : t('assistant.result.confidenceStandard')}
            </p>
          </div>

          {/* Box 2: Source Documents List */}
          <div className="p-4 rounded-xl bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 space-y-3">
            <p className="text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {t('assistant.result.linkedSources', { count: (searchResult.sources || []).length })}
            </p>
            <div className="space-y-2">
              {(searchResult.sources || []).length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  {t('assistant.result.noSources')}
                </p>
              ) : (
                (searchResult.sources || []).map((source: KnowledgeAnswerSource) => {
                  // Only surface a file type we actually know — i.e. one embedded
                  // in the real source name. Never fabricate ".pdf"/".docx", which
                  // misrepresents the document to the user.
                  const dotIdx = source.name.lastIndexOf('.');
                  const hasExt = dotIdx > 0 && dotIdx < source.name.length - 1;
                  const fileExt = hasExt ? source.name.slice(dotIdx) : '';
                  return (
                    <button
                      key={source.id}
                      onClick={() => handleSourceClick(source.name, fileExt)}
                      className="w-full flex items-start gap-3 p-2 bg-white dark:bg-slate-950 hover:bg-brand-50/30 dark:hover:bg-brand-950/20 border border-slate-100/60 dark:border-slate-800 hover:border-brand-200 dark:hover:border-brand-900 rounded-lg text-left transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <div className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-900 text-slate-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors shrink-0">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors block truncate">
                          {source.name}
                        </span>
                        {source.snippet && (
                          <span className="text-3xs text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
                            {source.snippet}
                          </span>
                        )}
                        <div className="flex items-center gap-1 text-4xs text-slate-400 dark:text-slate-500 font-medium">
                          <span>
                            {hasExt
                              ? t('assistant.result.documentLabel', { ext: fileExt.slice(1).toUpperCase() })
                              : t('assistant.result.documentGeneric')}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Box 3: Document Governance Info */}
          <div className="p-4 rounded-xl bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 space-y-3">
            <p className="text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {t('assistant.result.governanceInfo')}
            </p>
            <div className="divide-y divide-slate-100/60 dark:divide-slate-800/60 text-2xs font-medium text-slate-600 dark:text-slate-400">
              <div className="flex justify-between py-2.5">
                <span className="text-slate-400 dark:text-slate-500">{t('assistant.result.businessDomain')}</span>
                <span className="text-slate-800 dark:text-slate-100 font-bold">{searchResult.businessDomain}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-slate-400 dark:text-slate-500">{t('assistant.result.documentOwner')}</span>
                <span className="text-slate-800 dark:text-slate-100 font-bold">{searchResult.reviewOwner}</span>
              </div>
              {/* NOTE: KnowledgeAnswer carries no version field, so the previous
                  hardcoded "v1.4 / v2.3" was fabricated metadata. Row removed until
                  a real version is available on the answer payload. */}
              <div className="flex justify-between py-2.5">
                <span className="text-slate-400 dark:text-slate-500">{t('assistant.result.lastReviewed')}</span>
                <span className="text-slate-800 dark:text-slate-100 font-bold">
                  {new Date(searchResult.lastUpdated).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Box 4: Administrative Action Buttons */}
          <div className="space-y-2">
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="w-full h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
            >
              <BookOpen className="h-4 w-4" />
              {t('assistant.result.viewFullDocument')}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsReportModalOpen(true)}
                aria-label="Report inaccuracy"
                className="h-10 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
              >
                <Flag className="h-4 w-4" />
                {t('assistant.result.reportIssue')}
              </button>
              <button
                onClick={() => setIsShareDialogOpen(true)}
                className="h-10 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
              >
                <Share2 className="h-4 w-4" />
                {t('assistant.result.share')}
              </button>
            </div>
          </div>

        </div>

      </div>

    </section>
  );
};
