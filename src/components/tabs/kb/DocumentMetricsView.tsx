/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { KBDocument } from '../../../types';
import { ISearchGap } from '../../../repositories/governanceRepository';
import {
  TableContainer,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '../../shared/DesignSystem';
import { EVAL_AGGREGATE } from '../../../constants/evalResults';
import { RetrievalQualityChart } from './RetrievalQualityChart';
import { computeKnowledgeHealth } from '../../../utils/knowledgeHealth';

const pct = (v: number) => `${Math.round(v * 100)}%`;

interface DocumentMetricsViewProps {
  documents: KBDocument[];
  searchGaps: ISearchGap[];
  handleResolveGap: (gapId: string, queryText: string) => void;
}

export const DocumentMetricsView: React.FC<DocumentMetricsViewProps> = ({
  documents,
  searchGaps,
  handleResolveGap,
}) => {
  const todayMs = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  // 1. Documents not reviewed in 90+ days
  const staleDocs = documents.filter((doc) => {
    if (!doc.lastReviewDate) return true;
    const reviewDateMs = new Date(doc.lastReviewDate).getTime();
    return todayMs - reviewDateMs > ninetyDaysMs;
  });

  // 2. Content without designated owner
  const unownedDocs = documents.filter((doc) => !doc.owner || doc.owner.trim() === '');

  // 3. Negatively rated documents
  const negativelyRated = documents
    .filter((doc) => (doc.ratingDown || 0) > 0)
    .sort((a, b) => (b.ratingDown || 0) - (a.ratingDown || 0));

  // 4. Search details count & zero-result searches
  const noResultSearches = searchGaps.filter((s) => !s.hasResults || s.escalated);

  // The score and its full breakdown come from one pure, documented place
  // (src/utils/knowledgeHealth.ts) rather than magic weights inlined here, so the
  // number below is auditable — every point it loses is attributed to a factor.
  const health = computeKnowledgeHealth({
    unowned: unownedDocs.length,
    overdueReview: staleDocs.length,
    negativeFeedback: negativelyRated.length,
    zeroResultQuery: noResultSearches.length,
  });
  const activeDeductions = health.deductions.filter((d) => d.points > 0);

  return (
    <div className="h-full overflow-y-auto pr-2 space-y-6">
      {/* Header */}
      <div className="border-b border-slate-100 dark:border-slate-900 pb-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
          Metrics
        </h3>
      </div>

      {/* Knowledge Health Score & Status Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 flex flex-col justify-between py-2">
          <div>
            <span className="text-3xs font-mono tracking-wider font-extrabold text-slate-500 dark:text-slate-400 uppercase">
              Knowledge Health Score
            </span>
            <div className="mt-4 flex items-center gap-4">
              <div className="text-3xl font-black font-mono tracking-tight text-slate-900 dark:text-white">
                {health.score}
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">/ 100</div>
            </div>

            {/* Score breakdown — the number above is 100 minus these. Without it
                the weights are invisible and "92" reads as a black box. */}
            <div className="mt-4">
              {activeDeductions.length === 0 ? (
                <p className="text-3xs font-mono text-success-600">
                  No deductions — no governance defects detected.
                </p>
              ) : (
                <>
                  <ul className="space-y-1" aria-label="Health score deductions">
                    {activeDeductions.map((d) => (
                      <li
                        key={d.key}
                        className="flex items-center justify-between gap-3 text-3xs font-mono"
                      >
                        <span className="text-slate-500 dark:text-slate-400">
                          {d.label}
                          <span className="text-slate-400 dark:text-slate-600">
                            {' '}
                            ({d.count}&times;{d.weight})
                          </span>
                        </span>
                        <span className="font-bold text-danger-600 tabular-nums">
                          &minus;{d.points}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {health.floored && (
                    <p className="mt-2 text-3xs font-mono text-slate-400 dark:text-slate-500">
                      Clamped up to the floor of {health.score} (raw {health.rawScore}).
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status Tags */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-4 py-2">
          <div className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-100 dark:border-slate-800/80">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Unowned docs</span>
            <span
              className={`font-mono font-bold ${
                unownedDocs.length > 0 ? 'text-warning-600' : 'text-success-600'
              }`}
            >
              {unownedDocs.length}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-100 dark:border-slate-800/80">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 border-0">
              Overdue review
            </span>
            <span
              className={`font-mono font-bold ${
                staleDocs.length > 0 ? 'text-danger-600' : 'text-success-600'
              }`}
            >
              {staleDocs.length}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-100 dark:border-slate-800/80">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Negative feedback
            </span>
            <span
              className={`font-mono font-bold ${
                negativelyRated.length > 0 ? 'text-danger-600' : 'text-success-600'
              }`}
            >
              {negativelyRated.length}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-100 dark:border-slate-800/80">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Zero-result queries
            </span>
            <span
              className={`font-mono font-bold ${
                noResultSearches.length > 0 ? 'text-warning-600' : 'text-success-600'
              }`}
            >
              {noResultSearches.length}
            </span>
          </div>
        </div>
      </div>

      {/* Retrieval Quality Row — measured, not invented.
          These replace three fabricated "Operational Outcomes" figures (a fixed
          "9.1s" search time, "82.5%" first-contact, "35.2%" escalation drop) that
          were never wired to anything. What sits here now is the offline
          retrieval-eval harness's own output (see src/constants/evalResults.ts),
          weighted across every labelled query set. */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-3xs font-bold text-slate-400 uppercase tracking-wider font-mono">
            Retrieval Quality
          </h4>
          <span className="text-3xs font-mono text-slate-400 dark:text-slate-500 normal-case">
            measured on {EVAL_AGGREGATE.totalQueries} labelled queries
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 border border-slate-100 dark:border-slate-800 rounded-sm">
            <span className="text-3xs font-mono font-extrabold text-slate-500 tracking-tight uppercase">
              Top-5 Hit Rate
            </span>
            <p className="text-xl font-bold font-sans mt-1 text-slate-900 dark:text-white">
              {pct(EVAL_AGGREGATE.hybridHitAt5)}
            </p>
          </div>
          <div className="p-4 border border-slate-100 dark:border-slate-800 rounded-sm">
            <span className="text-3xs font-mono font-extrabold text-slate-500 tracking-tight uppercase">
              Mean Recip. Rank
            </span>
            <p className="text-xl font-bold font-sans mt-1 text-slate-900 dark:text-white">
              {EVAL_AGGREGATE.hybridMrr.toFixed(2)}
            </p>
          </div>
          <div className="p-4 border border-slate-100 dark:border-slate-900 rounded-sm">
            <span className="text-3xs font-mono font-extrabold text-slate-500 tracking-tight uppercase">
              Lift vs Keyword
            </span>
            <p className="text-xl font-bold font-sans mt-1 text-success-600">
              +{pct(EVAL_AGGREGATE.lift)}
            </p>
          </div>
        </div>
        <RetrievalQualityChart />
      </div>

      {/* Search Gap Analysis.
          No border on this wrapper: TableContainer draws its own, and the two
          nested 16px apart read as a box inside a box. The table's border is the
          section frame here, which is also how the migrated tables in SettingsTab
          and SyncIndexingTab sit. */}
      <div className="p-4">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase font-sans border-b border-slate-100 dark:border-slate-800 pb-2 mb-4">
          Grounded Search Gap Analysis
        </h4>
        {searchGaps.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No search gaps detected.</p>
        ) : (
          <TableContainer aria-label="Search gap analysis table, scrollable" className="font-sans">
            <TableHead>
              <tr>
                <TableHeaderCell>Query</TableHeaderCell>
                <TableHeaderCell>Confidence</TableHeaderCell>
                <TableHeaderCell>Action</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {searchGaps.map((gap) => (
                <TableRow key={gap.id}>
                  <TableCell>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{gap.query}</span>
                  </TableCell>
                  <TableCell className="font-mono text-3xs">{gap.confidence || 'Low'}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleResolveGap(gap.id, gap.query)}
                      className="text-brand-600 font-bold hover:underline cursor-pointer"
                    >
                      Resolve
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableContainer>
        )}
      </div>
    </div>
  );
};
