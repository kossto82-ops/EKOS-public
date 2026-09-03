/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useLocale } from '../../../context/LocaleContext';

interface QuickActionsSectionProps {
  departmentId: string;
  onSelect: (query: string) => void;
}

interface QuickActionEntry {
  category: string;
  query: string;
}

// Per-department accent colours (border + category text). Content itself is
// curated + translated in the locale files under assistant.quickActions.
const DEPT_COLORS: Record<string, { border: string; textCol: string }> = {
  customer_service: { border: 'border-l-indigo-600 dark:border-l-indigo-500', textCol: 'text-indigo-600 dark:text-indigo-400' },
  call_center: { border: 'border-l-blue-600 dark:border-l-blue-500', textCol: 'text-blue-600 dark:text-blue-400' },
  it: { border: 'border-l-slate-600 dark:border-l-slate-500', textCol: 'text-slate-600 dark:text-slate-400' },
  finance: { border: 'border-l-cyan-600 dark:border-l-cyan-500', textCol: 'text-cyan-600 dark:text-cyan-400' },
  sales: { border: 'border-l-orange-600 dark:border-l-orange-500', textCol: 'text-orange-600 dark:text-orange-400' },
};
const DEFAULT_COLORS = { border: 'border-l-brand-600 dark:border-l-brand-500', textCol: 'text-brand-600 dark:text-brand-400' };

/**
 * Curated, fully-translated department starter questions shown before a search.
 * Content comes from the locale files (assistant.quickActions.<dept>, falling
 * back to .default); clicking runs the same real grounded search as everything
 * else on the tab.
 */
export const QuickActionsSection: React.FC<QuickActionsSectionProps> = ({ departmentId, onSelect }) => {
  const { t, getList } = useLocale();

  const suggestions = useMemo<QuickActionEntry[]>(() => {
    const perDept = getList<QuickActionEntry>(`assistant.quickActions.${departmentId}`);
    return perDept.length > 0 ? perDept : getList<QuickActionEntry>('assistant.quickActions.default');
  }, [departmentId, getList]);

  const colors = DEPT_COLORS[departmentId] || DEFAULT_COLORS;

  if (suggestions.length === 0) return null;

  return (
    <section id="quick_actions" className="space-y-3 animate-fadeIn">
      <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2 select-none">
        <Sparkles className="h-3.5 w-3.5 text-brand-500" />
        {t('assistant.quickActionsTitle')}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {suggestions.map((action, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(action.query)}
            className={`text-left p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/10 hover:bg-slate-100/40 dark:hover:bg-slate-800/40 border-l-4 ${colors.border} transition-all cursor-pointer group`}
          >
            <span className={`text-3xs font-bold uppercase tracking-wider ${colors.textCol} block mb-1`}>
              {action.category}
            </span>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white line-clamp-2 leading-relaxed">
              {action.query}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
};
