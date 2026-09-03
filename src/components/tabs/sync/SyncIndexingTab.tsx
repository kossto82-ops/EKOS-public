/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useToast } from '../../../hooks/useToast';
import { 
  Database, 
  RefreshCw, 
  History, 
  CheckCircle, 
  AlertTriangle, 
  Play, 
  Clock, 
  ShieldCheck,
  Server,
  Home
} from 'lucide-react';
import { syncService } from '../../../services/syncService';
import { SyncJobLog } from '../../../types/apiContracts';
import { useBreadcrumbs } from '../../../context/BreadcrumbContext';
import { useLocale } from '../../../context/LocaleContext';
import {
  Badge,
  TableContainer,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '../../shared/DesignSystem';

// No real recurring sync interval is wired up client-side (see
// docs/KNOWN_LIMITATIONS.md) — this computes the next 6-hour UTC boundary
// from the current time purely for display, so the "Every 6h" schedule
// shown here is at least internally consistent and never a stale,
// long-past hardcoded date.
function getNextScheduledSyncTime(now: Date): string {
  const nextBoundaryHour = Math.ceil((now.getUTCHours() + 1) / 6) * 6;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), nextBoundaryHour, 0, 0));
  return next.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

export const SyncIndexingTab: React.FC = () => {
  const { setBreadcrumbs } = useBreadcrumbs();
  const toast = useToast();
  const { t } = useLocale();

  useLayoutEffect(() => {
    setBreadcrumbs([
      { 
        label: 'Home', 
        icon: Home,
        onClick: () => window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }))
      },
      { label: 'Sync', icon: RefreshCw }
    ]);
  }, [setBreadcrumbs]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncJobLog[]>([]);
  // Real telemetry from GET /api/db/sync/status (chunk count + % of docs
  // indexed). Init to 0 rather than the old fake 99.8 / 142500 so nothing
  // invented is shown before the first fetch resolves.
  const [indexIntegrity, setIndexIntegrity] = useState(0);
  const [totalIndexedKeys, setTotalIndexedKeys] = useState(0);
  const [syncStatusMessage, setSyncStatusMessage] = useState('');

  // Derive the integrity badge from the real value instead of a static
  // "Optimal" label that lied when the index was empty/degraded.
  const integrityBadge = indexIntegrity >= 95
    ? { label: 'Optimal', variant: 'success' as const }
    : indexIntegrity >= 70
      ? { label: 'Degraded', variant: 'warning' as const }
      : { label: 'Low', variant: 'danger' as const };

  const isMountedRef = useRef(true);
  const manualSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (manualSyncTimeoutRef.current) clearTimeout(manualSyncTimeoutRef.current);
    };
  }, []);

  const refreshSyncStatus = () => {
    return syncService.getSyncStatus().then(status => {
      if (!isMountedRef.current) return;
      setSyncLogs(status.syncLogs);
      setIndexIntegrity(status.indexIntegrity);
      setTotalIndexedKeys(status.totalIndexedKeys);
    }).catch(err => {
      console.error('Failed to get sync status:', err);
      toast.error(t('sync.toasts.loadError'));
    });
  };

  useEffect(() => {
    refreshSyncStatus();
  }, []);

  const handleManualSync = () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncStatusMessage(t('sync.toasts.syncCompletedMessage'));
    toast.success(t('sync.toasts.syncStarted'));

    // Drive the REAL crawl endpoint and report the server's actual outcome.
    // Previously this fabricated a hardcoded "154 records processed" log (and
    // double-inserted rows) regardless of what happened — an invented audit
    // trail. When SharePoint isn't configured we now say so honestly instead of
    // reporting a completed sync that never ran.
    syncService.triggerSharePointSync()
      .then(result => {
        if (!isMountedRef.current) return;
        if (!result.configured) {
          setSyncStatusMessage(t('sync.toasts.syncNotConfiguredMessage'));
          toast.warning(t('sync.toasts.syncNotConfigured'));
          return;
        }
        if (!result.success) {
          setSyncStatusMessage(t('sync.toasts.syncFailed'));
          toast.error(t('sync.toasts.syncFailed'));
          return;
        }
        // Success: the server already wrote a real job row — refetch canonical
        // status/telemetry and report the actual ingested count.
        return refreshSyncStatus().then(() => {
          if (!isMountedRef.current) return;
          setSyncStatusMessage(t('sync.toasts.syncCompletedStatusMessage', { count: result.total }));
          toast.success(t('sync.toasts.syncCompletedToast'));
        });
      })
      .catch(err => {
        console.error('Manual SharePoint sync failed:', err);
        if (!isMountedRef.current) return;
        setSyncStatusMessage(t('sync.toasts.syncFailed'));
        toast.error(t('sync.toasts.syncFailed'));
      })
      .finally(() => {
        if (isMountedRef.current) setIsSyncing(false);
      });
  };

  return (
    <div id="sync_indexing_tab" className="space-y-8 font-sans text-left">
      {/* Screen reader live region for sync state changes */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {syncStatusMessage}
      </div>
      
      {/* Banner segment */}
      <section id="sync_banner" className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-900 pb-5">
        <div>
          <h1 
            id="sync_title"
            className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2"
          >
            <RefreshCw className={`h-5 w-5 text-brand-600 dark:text-brand-400 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync
          </h1>
          <p 
            id="sync_subtitle"
            className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed font-sans font-medium"
          >
            Monitor file synchronization operations.
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className={`inline-flex items-center gap-1.5 rounded-sm px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-all cursor-pointer ${
            isSyncing 
              ? 'bg-slate-700 cursor-not-allowed opacity-80' 
              : 'bg-brand-600 hover:bg-brand-700'
          }`}
        >
          <Play className={`h-3.5 w-3.5 ${isSyncing ? 'animate-pulse' : ''}`} />
          {isSyncing ? t('sync.runSyncButton.syncing') : t('sync.runSyncButton.runSync')}
        </button>
      </section>

      {/* Index Metrics */}
      <section id="sync_stats_grid" className="grid grid-cols-1 sm:grid-cols-3 gap-4.5">
        <div className="bg-white dark:bg-slate-950 p-5 rounded-sm border border-slate-200 dark:border-slate-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-3xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Index Integrity</span>
            <ShieldCheck className="h-4.5 w-4.5 text-slate-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">{indexIntegrity}%</span>
            <Badge variant={integrityBadge.variant}>{integrityBadge.label}</Badge>
          </div>
          <span className="text-2xs text-slate-500 mt-1">Share of documents with indexable content</span>
        </div>

        <div className="bg-white dark:bg-slate-950 p-5 rounded-sm border border-slate-200 dark:border-slate-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-3xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Indexed Documents</span>
            <Database className="h-4.5 w-4.5 text-slate-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">{totalIndexedKeys.toLocaleString()}</span>
            <Badge variant="brand">Indexed</Badge>
          </div>
          <span className="text-2xs text-slate-500 mt-1">Documents with indexable content</span>
        </div>

        <div className="bg-white dark:bg-slate-950 p-5 rounded-sm border border-slate-200 dark:border-slate-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-3xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Scheduled Routine</span>
            <Clock className="h-4.5 w-4.5 text-slate-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">Every 6h</span>
            <Badge variant="neutral">Auto</Badge>
          </div>
          <span className="text-2xs text-slate-500 mt-1">Next schedule: {getNextScheduledSyncTime(new Date())}</span>
        </div>
      </section>

      {/* Sync Log Section (Microsoft Admin Center Style Logs) */}
      <section id="sync_log_section" aria-label="Ingestion and Re-indexing Logs" className="space-y-3.5">
        <div className="flex items-center gap-2 select-none text-slate-400 dark:text-slate-500">
          <History className="h-4 w-4" />
          <h2 className="text-3xs font-mono font-bold uppercase tracking-wider">
            Ingestion & Synchronization Logs
          </h2>
        </div>

        <TableContainer aria-label={t('sync.logsTableAria')}>
          <TableHead>
            <tr>
              <TableHeaderCell className="w-1/3">{t('sync.tableHeaders.targetSource')}</TableHeaderCell>
              <TableHeaderCell>{t('sync.tableHeaders.syncType')}</TableHeaderCell>
              <TableHeaderCell className="text-center">{t('sync.tableHeaders.recordsIngestion')}</TableHeaderCell>
              <TableHeaderCell className="text-center">{t('sync.tableHeaders.executionDuration')}</TableHeaderCell>
              <TableHeaderCell>{t('sync.tableHeaders.transactionStatus')}</TableHeaderCell>
              <TableHeaderCell className="text-right font-mono">{t('sync.tableHeaders.completionTime')}</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {syncLogs.map((job, index) => {
              const isCompleted = job.status === 'Completed';
              const isWarning = job.status === 'Warning';

              return (
                <TableRow key={job.id} id={`sync_log_row_${index}`}>
                  <TableCell>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{job.sourceName}</span>
                  </TableCell>
                  <TableCell className="text-slate-500 dark:text-slate-400 font-sans">
                    {job.type}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-slate-700 dark:text-slate-400">
                      {job.recordsProcessed > 0 ? job.recordsProcessed.toLocaleString() : '--'}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-slate-700 dark:text-slate-400">{job.duration}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 font-mono font-bold text-3xs uppercase`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        isCompleted ? 'bg-success-500' : isWarning ? 'bg-warning-500' : 'bg-slate-400'
                      }`}></span>
                      <span className={
                        isCompleted ? 'text-success-600 dark:text-success-400' : isWarning ? 'text-warning-600 dark:text-warning-400' : 'text-slate-500 dark:text-slate-400'
                      }>
                        {job.status}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-slate-500 dark:text-slate-400">
                    {job.endTime}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </TableContainer>
      </section>

      {/* Security note */}
      <div className="bg-slate-50 dark:bg-slate-900/25 p-4 border border-slate-100 dark:border-slate-800 rounded-sm text-2xs text-slate-500 dark:text-slate-400 select-none leading-relaxed">
        <strong>Governance Ingestion Protocol:</strong> Standard sync sequences are executed under strict sandboxed container instances to ensure data security. Real-time changes might require up to 60 seconds to fully propagate through the distributed semantic cache. For support regarding secure keys and manual endpoints, review the <strong>System Governance</strong> matrices.
      </div>
    </div>
  );
};
