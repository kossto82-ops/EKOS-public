/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { INITIAL_KNOWLEDGE_SOURCES } from '../../constants/sources';
import { 
  ShieldCheck, 
  Search, 
  Layers, 
  Star, 
  Clock, 
  User, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  RefreshCw,
  FileText,
  Percent,
  CheckSquare,
  Home
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useDepartment } from '../../hooks/useDepartment';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { syncService } from '../../services/syncService';
import { KnowledgeSource } from '../../types/knowledge';
import { useBreadcrumbs } from '../../context/BreadcrumbContext';
import { isVisibleToDepartment } from '../../utils/scoping';
import { useLocale } from '../../context/LocaleContext';
import { Badge, EmptyState } from '../shared/DesignSystem';

// Format sync timestamp beautifully — pure, so hoisted out of the component
// rather than being recreated (and re-passed to every row) on every render.
const formatSyncDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  // new Date(undefined|garbage) yields an Invalid Date that does NOT throw, so
  // the old try/catch never caught it and toLocaleDateString returned the
  // literal string "Invalid Date". Detect it explicitly and show a neutral dash.
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Convert status to a professional governance badge config — pure, hoisted
// for the same reason as formatSyncDate above. Returns a translation key
// (resolved to display text at render time via t()) rather than a literal
// label, so this lookup stays localizable without losing its hoisted-out-of-
// the-component perf characteristics.
const getStatusDisplay = (status: string) => {
  switch (status) {
    case 'healthy':
      return {
        labelKey: 'healthy' as const,
        badgeClass: 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-400 border-slate-200 dark:border-slate-800',
        icon: <CheckCircle2 className="h-3 w-3 text-slate-700 dark:text-slate-400" />
      };
    case 'syncing':
      return {
        labelKey: 'syncing' as const,
        badgeClass: 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-400 border-slate-200 dark:border-slate-800',
        icon: <RefreshCw className="h-3 w-3 text-slate-700 dark:text-slate-400 animate-spin" />
      };
    case 'warning':
      return {
        labelKey: 'warning' as const,
        badgeClass: 'bg-warning-50 text-warning-800 border-warning-200 dark:bg-warning-950/20 dark:text-warning-300 dark:border-warning-900/60',
        icon: <AlertTriangle className="h-3 w-3 text-warning-600 dark:text-warning-400" />
      };
    case 'error':
    default:
      return {
        labelKey: 'error' as const,
        badgeClass: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-300 dark:border-red-900/60',
        icon: <ShieldAlert className="h-3 w-3 text-red-600 dark:text-red-400" />
      };
  }
};

interface SourceRowProps {
  source: KnowledgeSource;
  onTriggerSync: (sourceId: string, sourceName: string) => void;
}

/**
 * A single knowledge-source row. Memoized so an unrelated re-render (e.g.
 * another row's sync completing) doesn't re-render every row in the list.
 */
const SourceRow: React.FC<SourceRowProps> = React.memo(function SourceRow({ source, onTriggerSync }) {
  const { t } = useLocale();
  const statusCfg = getStatusDisplay(source.status);

  return (
    <div
      id={`source_row_${source.id}`}
      className="group relative grid grid-cols-1 lg:grid-cols-[2fr_1.2fr_1.5fr_1.2fr_auto] gap-4 lg:gap-6 items-start lg:items-center px-6 py-5 hover:bg-slate-50/30 dark:hover:bg-slate-900/10 transition-colors"
    >

      {/* Column 1: Core Domain Metadata */}
      <div className="space-y-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors truncate block">
            {source.name}
          </span>
          {source.isAuthoritative && (
            <span className="inline-flex items-center gap-0.5 bg-slate-950 text-white dark:bg-slate-200 dark:text-slate-950 px-1.5 py-0.2 text-5xs font-mono tracking-widest uppercase font-extrabold rounded-xs">
              <Star className="h-2 w-2 fill-current" /> {t('knowledgeSources.authoritative')}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-normal">
          {source.description}
        </p>
        <div className="flex items-center gap-2 text-3xs text-slate-400 dark:text-slate-500 font-mono font-bold uppercase tracking-wider select-none">
          <span>{t('knowledgeSources.areaPrefix')} {source.businessArea}</span>
          <span>•</span>
          <span>{t('knowledgeSources.riskPrefix')} {source.operationalRisk}</span>
        </div>
      </div>

      {/* Column 2: Governance & Ownership */}
      <div className="text-xs text-slate-700 dark:text-slate-300 font-medium space-y-1 select-none">
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 text-slate-400" />
          <span className="font-bold text-slate-700 dark:text-slate-200">{source.owner}</span>
        </div>
        <div className="flex items-center gap-1.5 text-2xs text-slate-400 dark:text-slate-500">
          <ShieldCheck className="h-3 w-3 text-slate-400" />
          <span>{t('knowledgeSources.auditorPrefix')} {source.reviewTeam}</span>
        </div>
      </div>

      {/* Column 3: Integrity & Coverage Metrics */}
      <div className="text-xs font-mono font-bold text-slate-700 dark:text-slate-400 space-y-1 select-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-slate-400" />
            <span>{t('knowledgeSources.indexFilesCount', { count: (source.recordCount ?? 0).toLocaleString() })}</span>
          </div>
          <div className="flex items-center gap-1">
            <Percent className="h-3.5 w-3.5 text-slate-400" />
            <span>{t('knowledgeSources.scopeCoverage', { coverage: source.coverage })}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-2xs text-slate-400 dark:text-slate-500">
          <div className="flex items-center gap-1">
            <CheckSquare className="h-3 w-3 text-slate-400" />
            <span>{t('knowledgeSources.trustIntegrity', { score: source.confidenceScore })}</span>
          </div>
          <div>
            <span>{t('knowledgeSources.requestsPerMonth', { count: (source.monthlyQueries ?? 0).toLocaleString() })}</span>
          </div>
        </div>
      </div>

      {/* Column 4: Sync & Review Metadata */}
      <div className="text-xs text-slate-500 dark:text-slate-500 space-y-1 select-none">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-semibold text-slate-600 dark:text-slate-400">{t('knowledgeSources.syncPrefix', { date: formatSyncDate(source.lastSync) })}</span>
        </div>
        <div className="text-2xs text-slate-400 dark:text-slate-500 font-mono font-bold uppercase tracking-wider pl-5">
          {source.daysSinceReview === 0
            ? t('knowledgeSources.reviewedToday')
            : t('knowledgeSources.reviewedDaysAgo', { days: source.daysSinceReview })
          }
        </div>
      </div>

      {/* Column 5: Operational Status Badge */}
      <div className="flex flex-col lg:items-end justify-center gap-2 select-none shrink-0 min-w-[120px]">
        {/* variant="inherit": these four states carry their own palette,
            including per-state border colours, which no shared variant
            expresses. The primitive contributes the geometry only — under
            `inherit` it adds no colour of its own, so badgeClass's border-* is
            unopposed rather than competing with a border-current it cannot
            reliably beat. */}
        <Badge appearance="outline" variant="inherit" className={statusCfg.badgeClass}>
          {statusCfg.icon}
          {t(`knowledgeSources.status.${statusCfg.labelKey}`)}
        </Badge>
        <button
          type="button"
          onClick={() => onTriggerSync(source.id, source.name)}
          className="text-4xs font-bold text-slate-400 hover:text-slate-900 dark:text-slate-500 dark:hover:text-white uppercase tracking-wider underline cursor-pointer transition-colors"
        >
          {t('knowledgeSources.auditValidation')}
        </button>
      </div>

    </div>
  );
});

export const KnowledgeSourcesView: React.FC = () => {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { activeDepartment } = useDepartment();
  const toast = useToast();
  const { t } = useLocale();

  useEffect(() => {
    setBreadcrumbs([
      {
        label: t('common.home'),
        icon: Home,
        onClick: () => window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }))
      },
      { label: t('nav.sources'), icon: Layers }
    ]);
  }, [setBreadcrumbs, t]);

  // --- FILTER, SEARCH, AND SORT STATES ---
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const isMountedRef = useRef(true);
  const pendingSyncTimeoutsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pendingSyncTimeoutsRef.current.forEach(id => window.clearTimeout(id));
      pendingSyncTimeoutsRef.current.clear();
    };
  }, []);

  const loadSources = useCallback(() => {
    setIsLoading(true);
    setLoadError(false);
    return syncService.getKnowledgeSources()
      .then(fetched => {
        if (!isMountedRef.current) return;
        setSources(fetched);
      })
      .catch(err => {
        console.error('Failed to load knowledge sources:', err);
        if (!isMountedRef.current) return;
        setLoadError(true);
        toast.error(t('knowledgeSources.loadError'));
      })
      .finally(() => {
        if (isMountedRef.current) setIsLoading(false);
      });
  }, [toast, t]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // Debounced so filtering doesn't re-run on every keystroke — the input
  // itself still updates instantly via `searchQuery`.
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);

  // Dynamic lists for filters
  const businessAreas = useMemo(
    () => Array.from(new Set(sources.map((s) => s.businessArea).filter(Boolean))) as string[],
    [sources]
  );

  // Filter sources
  const filteredSources = useMemo(() => sources.filter((source) => {
    if (!isVisibleToDepartment(source, activeDepartment.id)) {
      return false;
    }

    // 0. Search Query
    if (debouncedSearchQuery.trim() !== '') {
      const q = debouncedSearchQuery.toLowerCase();
      const matchesName = source.name?.toLowerCase().includes(q);
      const matchesDesc = source.description?.toLowerCase().includes(q);
      const matchesOwner = source.owner?.toLowerCase().includes(q);
      const matchesTeam = source.reviewTeam?.toLowerCase().includes(q);
      const matchesArea = source.businessArea?.toLowerCase().includes(q);
      if (!matchesName && !matchesDesc && !matchesOwner && !matchesTeam && !matchesArea) {
        return false;
      }
    }

    // 1. Business Area Filter
    if (areaFilter !== 'all' && source.businessArea !== areaFilter) {
      return false;
    }

    // 2. Risk/Criticality Filter
    if (riskFilter !== 'all') {
      if (riskFilter === 'critical' && source.criticality !== 'Critical') return false;
      if (riskFilter === 'high_medium' && source.criticality !== 'High' && source.criticality !== 'Medium') return false;
      if (riskFilter === 'low' && source.criticality !== 'Low') return false;
    }

    // 3. Operational Status Filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && (source.status !== 'healthy' && source.status !== 'syncing')) return false;
      if (statusFilter === 'attention' && (source.status !== 'warning' && source.status !== 'error')) return false;
    }

    return true;
  }), [sources, activeDepartment.id, debouncedSearchQuery, areaFilter, riskFilter, statusFilter]);

  // Sort: Authoritative domains at the top, then by name
  const sortedSources = useMemo(() => [...filteredSources].sort((a, b) => {
    if (a.isAuthoritative && !b.isAuthoritative) return -1;
    if (!a.isAuthoritative && b.isAuthoritative) return 1;
    return a.name.localeCompare(b.name);
  }), [filteredSources]);

  const handleTriggerSync = (_sourceId: string, sourceName: string) => {
    // There is no per-source live re-validation backend; the only real sync is
    // the global SharePoint crawl on the Sync tab. This action therefore
    // honestly re-reads the source's CURRENT server status rather than faking a
    // 'healthy' result on a 3s timer — the old behavior unconditionally
    // laundered warning/error sources to healthy, hiding real governance state.
    toast.success(t('knowledgeSources.rechecking', { name: sourceName }));
    syncService.getKnowledgeSources()
      .then(refreshed => {
        if (!isMountedRef.current) return;
        setSources(refreshed);
        toast.success(t('knowledgeSources.refreshed', { name: sourceName }));
      })
      .catch(err => {
        console.error(`Failed to refresh source ${sourceName}:`, err);
        if (isMountedRef.current) toast.error(t('knowledgeSources.refreshError', { name: sourceName }));
      });
  };

  return (
    <div className="space-y-6 font-sans">
      
      {/* 1. WORKSPACE HEADER */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-900 pb-5 select-none">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Layers className="h-5 w-5 text-slate-800 dark:text-slate-200" />
            {t('knowledgeSources.title')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-3xl leading-relaxed">
            {t('knowledgeSources.description')}
          </p>
        </div>

        {/* Governance Certification Seal */}
        <div className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-sm bg-slate-50 dark:bg-slate-950 select-none flex-shrink-0 self-start md:self-center">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-700 dark:text-slate-300" />
          <span className="text-3xs font-bold font-mono text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            {t('knowledgeSources.complianceActive')}
          </span>
        </div>
      </header>

      {/* 2. DISCOVERY WORKSPACE PANEL (Horizontal Filter Bar) */}
      <div className="px-6 py-4 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-900 rounded-sm space-y-4 select-none">
        
        {/* Real-time Domain Search */}
        <div className="relative">
          <label htmlFor="source_search_input" className="sr-only">{t('knowledgeSources.searchAria')}</label>
          <input
            id="source_search_input"
            type="text"
            placeholder={t('knowledgeSources.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-500 text-xs font-semibold rounded-lg pl-3 pr-12 py-2 border border-transparent focus:border-slate-200 dark:focus:border-slate-800 focus:outline-hidden transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
            >
              {t('knowledgeSources.clearButton')}
            </button>
          )}
        </div>

        {/* Filters Matrix */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
          
          {/* Classification Area */}
          <div className="flex items-center gap-2" role="group" aria-label={t('knowledgeSources.domainAreaFilterAria')}>
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('knowledgeSources.domainArea')}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={areaFilter === 'all'}
                onClick={() => setAreaFilter('all')}
                className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                  areaFilter === 'all'
                    ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('knowledgeSources.filterAll')}
              </button>
              {businessAreas.map((area) => {
                const isActive = areaFilter === area;
                return (
                  <button
                    key={area}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setAreaFilter(area)}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {area}
                  </button>
                );
              })}
            </div>
          </div>

          <span className="text-slate-200 dark:text-slate-800 font-bold hidden sm:inline">|</span>

          {/* Operational Risk Filter */}
          <div className="flex items-center gap-2" role="group" aria-label={t('knowledgeSources.riskLevelFilterAria')}>
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('knowledgeSources.riskLevel')}
            </span>
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: t('knowledgeSources.filterAll') },
                { id: 'critical', label: t('knowledgeSources.riskOptions.critical') },
                { id: 'high_medium', label: t('knowledgeSources.riskOptions.highMedium') },
                { id: 'low', label: t('knowledgeSources.riskOptions.low') }
              ].map((risk) => {
                const isActive = riskFilter === risk.id;
                return (
                  <button
                    key={risk.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setRiskFilter(risk.id)}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {risk.label}
                  </button>
                );
              })}
            </div>
          </div>

          <span className="text-slate-200 dark:text-slate-800 font-bold hidden sm:inline">|</span>

          {/* Sync Status Filter */}
          <div className="flex items-center gap-2" role="group" aria-label={t('knowledgeSources.syncHealthFilterAria')}>
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('knowledgeSources.syncHealth')}
            </span>
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: t('knowledgeSources.filterAll') },
                { id: 'active', label: t('knowledgeSources.syncOptions.active') },
                { id: 'attention', label: t('knowledgeSources.syncOptions.attention') }
              ].map((status) => {
                const isActive = statusFilter === status.id;
                return (
                  <button
                    key={status.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setStatusFilter(status.id)}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {status.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset Action */}
          {(areaFilter !== 'all' || riskFilter !== 'all' || statusFilter !== 'all' || searchQuery !== '') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setAreaFilter('all');
                setRiskFilter('all');
                setStatusFilter('all');
              }}
              className="ml-auto text-3xs font-bold uppercase text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 underline cursor-pointer"
            >
              {t('knowledgeSources.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {/* 3. REPOSITORY LIST CONTAINER */}
      <div className="bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-900 rounded-sm overflow-hidden">
        {isLoading ? (
          // Distinct loading state — never conflate "still loading" with
          // "nothing matches your filters".
          <div role="status" aria-live="polite" className="text-xs font-mono text-slate-500 py-16 text-center flex flex-col items-center justify-center space-y-4">
            <RefreshCw className="h-5 w-5 text-slate-400 animate-spin" />
            <span className="font-bold text-slate-700 dark:text-slate-300">{t('knowledgeSources.loadingSources')}</span>
          </div>
        ) : loadError ? (
          <div role="alert" className="text-xs font-mono text-slate-500 py-16 text-center flex flex-col items-center justify-center space-y-4">
            <ShieldAlert className="h-5 w-5 text-danger-500" />
            <div className="space-y-1">
              <span className="font-bold text-slate-800 dark:text-slate-300 block">{t('knowledgeSources.loadErrorTitle')}</span>
              <p className="text-2xs text-slate-400">{t('knowledgeSources.loadErrorBody')}</p>
            </div>
            <button
              type="button"
              onClick={() => loadSources()}
              className="text-xs font-bold text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 underline cursor-pointer"
            >
              {t('knowledgeSources.retry')}
            </button>
          </div>
        ) : sortedSources.length === 0 ? (
          <EmptyState
            role="status"
            aria-live="polite"
            icon={ShieldAlert}
            title={t('knowledgeSources.noMatchTitle')}
            description={t('knowledgeSources.noMatchBody')}
            action={
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setAreaFilter('all');
                  setRiskFilter('all');
                  setStatusFilter('all');
                }}
                className="text-xs font-bold text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 underline cursor-pointer"
              >
                {t('knowledgeSources.clearSearchAndFilters')}
              </button>
            }
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-900">

            {/* Header Strip for scanning */}
            <div className="hidden lg:grid lg:grid-cols-[2fr_1.2fr_1.5fr_1.2fr_auto] gap-6 items-center px-6 py-3 bg-slate-50 dark:bg-slate-900/40 text-3xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 select-none">
              <div>{t('knowledgeSources.columnHeaders.domain')}</div>
              <div>{t('knowledgeSources.columnHeaders.governance')}</div>
              <div>{t('knowledgeSources.columnHeaders.metrics')}</div>
              <div>{t('knowledgeSources.columnHeaders.sync')}</div>
              <div className="text-right pr-4">{t('knowledgeSources.columnHeaders.status')}</div>
            </div>

            {/* Ingestion Source Rows */}
            {sortedSources.map((source) => (
              <SourceRow key={source.id} source={source} onTriggerSync={handleTriggerSync} />
            ))}

          </div>
        )}
      </div>

    </div>
  );
};
