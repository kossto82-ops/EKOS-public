/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { TrendingUp, Clock, FileText } from 'lucide-react';
import { useLocale } from '../../../context/LocaleContext';
import { KBDocument } from '../../../types';
import { isDocumentVisible } from '../../../utils/scoping';

interface SuggestedContentSectionProps {
  /** Real KB documents (already loaded by the Assistant tab). */
  documents: KBDocument[];
  brandId: string;
  departmentId: string;
  /** Runs a real knowledge-base search for the given query text. */
  onSelect: (query: string) => void;
}

/** Turn a raw document filename into a readable title (drop extension, underscores → spaces). */
function cleanTitle(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best available "last changed" date for a document. */
function docDate(d: KBDocument): number {
  const raw = d.lastReviewDate || (d as any).updatedAt || d.uploadedAt || '';
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * "Common Operational Questions" and "Recent Policy Changes" — both derived
 * from the REAL knowledge base documents visible to the active brand/department.
 * Clicking any item runs a real grounded search (no mock answers).
 */
export const SuggestedContentSection: React.FC<SuggestedContentSectionProps> = ({
  documents,
  brandId,
  departmentId,
  onSelect,
}) => {
  const { t, locale } = useLocale();

  const visible = useMemo(
    () => documents.filter((d) => d.status === 'trained' && isDocumentVisible(d, brandId, departmentId)),
    [documents, brandId, departmentId]
  );

  // Common questions: prioritise flagged-important docs, then most-viewed.
  const commonQuestions = useMemo(() => {
    return [...visible]
      .sort((a, b) => Number(b.isImportant) - Number(a.isImportant) || (b.viewsCount || 0) - (a.viewsCount || 0))
      .slice(0, 6)
      .map((d) => ({ id: d.id, title: cleanTitle(d.name), category: d.category || d.department || '' }));
  }, [visible]);

  // Recent policy changes: most recently reviewed/updated real documents.
  const recentChanges = useMemo(() => {
    return [...visible]
      .filter((d) => docDate(d) > 0)
      .sort((a, b) => docDate(b) - docDate(a))
      .slice(0, 4)
      .map((d) => {
        const dt = new Date(docDate(d));
        let when = '';
        try {
          when = dt.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
          when = dt.toISOString().split('T')[0];
        }
        return { id: d.id, title: cleanTitle(d.name), when };
      });
  }, [visible, locale]);

  if (visible.length === 0) return null;

  return (
    <>
      <section id="frequently_accessed" className="space-y-4 pt-4 max-w-full">
        <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2 select-none">
          <TrendingUp className="h-3.5 w-3.5 text-brand-500" />
          {t('assistant.commonQuestionsTitle')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {commonQuestions.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onSelect(doc.title)}
              className="flex items-center gap-3 py-3 px-4 border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-800 text-left transition-colors cursor-pointer group rounded-lg"
            >
              <div className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-900 text-slate-500 group-hover:text-brand-600 transition-colors shrink-0">
                <FileText className="h-4 w-4" />
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 group-hover:text-slate-950 dark:group-hover:text-white transition-colors line-clamp-2">
                {doc.title}
              </span>
            </button>
          ))}
        </div>
      </section>

      {recentChanges.length > 0 && (
        <section id="recent_updates" className="space-y-4 pt-2 max-w-full">
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2 select-none">
            <Clock className="h-3.5 w-3.5 text-brand-500" />
            {t('assistant.recentChangesTitle')}
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/20 border border-slate-100/60 dark:border-slate-800/60 rounded-xl px-5 py-2">
            {recentChanges.map((update) => (
              <button
                key={update.id}
                onClick={() => onSelect(update.title)}
                className="w-full flex items-center justify-between py-3.5 text-xs font-medium text-left hover:opacity-80 transition-opacity"
              >
                <span className="text-slate-700 dark:text-slate-300 line-clamp-1 pr-3">{update.title}</span>
                <span className="text-slate-400 dark:text-slate-500 shrink-0">{update.when}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
};
