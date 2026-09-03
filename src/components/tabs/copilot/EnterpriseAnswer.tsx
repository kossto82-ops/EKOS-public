/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { KnowledgeAnswer } from '../../../types/knowledge';
import { BadgeCheck, AlertTriangle, FileText } from 'lucide-react';
import { MarkdownContent } from '../../shared/MarkdownContent';
import { Badge } from '../../shared/DesignSystem';
import { useLocale } from '../../../context/LocaleContext';

interface EnterpriseAnswerProps {
  answer: KnowledgeAnswer;
  /** Whether this answer came from the live AI or the local keyword fallback. */
  retrievalSource?: 'live_ai' | 'local_fallback' | null;
}

export const EnterpriseAnswer: React.FC<EnterpriseAnswerProps> = ({ answer, retrievalSource }) => {
  const { t } = useLocale();
  // A local-fallback (simulated) answer must NOT wear a green "Verified" badge or
  // a high confidence score — that contradicts the simulated-content warning and
  // misleads users into trusting fabricated content. Force it to "review-needed"
  // and suppress the confidence number.
  const isFallback = retrievalSource === 'local_fallback';
  const sources = answer.sources || [];
  const statusConfig = {
    verified: {
      icon: BadgeCheck,
      variant: 'success' as const,
      label: t('assistant.result.statusVerified')
    },
    'review-needed': {
      icon: AlertTriangle,
      variant: 'warning' as const,
      label: t('assistant.result.statusReview')
    },
    draft: {
      icon: FileText,
      variant: 'neutral' as const,
      label: t('assistant.result.statusDraft')
    }
  };

  const currentStatus = isFallback
    ? statusConfig['review-needed']
    : (statusConfig[answer.status] || statusConfig.draft);

  return (
    <div className="space-y-8 font-sans">
      {/* 1. Header: Document Context, Title, Metadata Info */}
      <div className="space-y-4">
        {/* Breadcrumbs / Tags */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {answer.businessDomain}
          </span>
          <span className="text-slate-300 dark:text-slate-700 text-xs">•</span>
          <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {answer.answerType}
          </span>
          <span className="text-slate-300 dark:text-slate-700 text-xs">•</span>
          <span className="text-3xs font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {t('assistant.result.confidence')}: {isFallback ? '—' : `${answer.confidenceScore}%`}
          </span>
        </div>

        {/* Dynamic Title — this panel renders inside the Assistant tab's own
            page-level <h1>, so the answer title is a subsection heading. */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex-1 min-w-[300px]">
            {answer.title}
          </h2>
          {/* size="lg": this is the only status indicator on a generously-sized
              screen, sitting beside a text-3xl heading — the shared 8px chip
              that's right for a dense table read as subordinate to the 10px
              metadata chips above it here. The prominence affordance is on
              Badge itself, not a forked second implementation. */}
          <Badge variant={currentStatus.variant} size="lg">
            <currentStatus.icon className="h-3.5 w-3.5" />
            {currentStatus.label}
          </Badge>
        </div>

        {/* Minimal metadata text */}
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 font-medium">
          <div>
            {t('assistant.result.owner')}: <span className="text-slate-700 dark:text-slate-300 font-semibold">{answer.reviewOwner}</span>
          </div>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <div>
            {t('assistant.result.lastUpdated')}: <span className="text-slate-700 dark:text-slate-300 font-semibold">{new Date(answer.lastUpdated).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* 2. Executive Summary - Styled as a Premium Editorial Block */}
      <div className="pl-5 border-l-2 border-brand-500/40 py-1">
        <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
          {t('assistant.result.executiveSummary')}
        </h3>
        <p className="text-slate-600 dark:text-zinc-300 text-sm leading-relaxed font-medium italic">
          {answer.summary}
        </p>
      </div>

      {/* 3. Main Content — shared Markdown renderer (GFM tables/strikethrough),
          heading-demoted to sit under this panel's h2 title + h3 summary. */}
      <MarkdownContent headingOffset={2}>{answer.content}</MarkdownContent>

      {/* 4. Document Reference Footer.
          NOTE: the working "helpful"/"report" controls live in SearchResultPanel;
          the previously-duplicated (and non-functional) buttons here were removed. */}
      <div className="pt-8 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap gap-x-8 gap-y-4 items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <span className="text-slate-400 dark:text-slate-500 font-bold uppercase text-3xs tracking-wider block mb-0.5">{t('assistant.result.primarySource')}</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              {sources[0]?.name || 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500 font-bold uppercase text-3xs tracking-wider block mb-0.5">{t('assistant.result.secondarySources')}</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {sources.length > 1 ? t('assistant.result.moreDocumented', { count: sources.length - 1 }) : t('assistant.result.noneLinked')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

