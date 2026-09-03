/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext, useEffect, useLayoutEffect, useState } from 'react';
import { AuthContext } from '../../../context/AuthContext';
import { BrandContext } from '../../../context/BrandContext';
import { apiClient } from '../../../config/apiClient';
import {
  Activity,
  Layers,
  ShieldCheck,
  Clock,
  Database,
  History,
  Home
} from 'lucide-react';
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

export const SettingsTab: React.FC = () => {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useLocale();
  const auth = useContext(AuthContext);
  const brandCtx = useContext(BrandContext);

  useLayoutEffect(() => {
    setBreadcrumbs([
      {
        label: t('common.home'),
        icon: Home,
        onClick: () => window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }))
      },
      { label: t('nav.systemHealth'), icon: Activity }
    ]);
  }, [setBreadcrumbs, t]);

  if (!auth || !brandCtx) return null;
  const { activeBrand } = brandCtx;

  const [syncStatus, setSyncStatus] = useState<{ indexIntegrity: number; totalIndexedKeys: number; syncLogs: any[] } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Real platform telemetry from the sync-status endpoint (S4): index integrity
  // and the actual sync-job history. That route requires the 'sync' role
  // (Admin/IT); for other roles it 403s and we render an honest "unavailable"
  // state rather than fabricated numbers.
  useEffect(() => {
    let mounted = true;
    apiClient.get<{ indexIntegrity: number; totalIndexedKeys: number; syncLogs: any[] }>('/api/db/sync/status')
      .then(res => {
        if (!mounted) return;
        if (res.success && res.data) setSyncStatus(res.data);
        else setStatusError(typeof res.error === 'string' ? res.error : (res.error?.message || 'unavailable'));
      })
      .catch((e) => { if (mounted) setStatusError(e instanceof Error ? e.message : 'unavailable'); });
    return () => { mounted = false; };
  }, []);

  const realSyncLogs: any[] = syncStatus?.syncLogs ?? [];
  const lastSyncEnd = realSyncLogs.find((l) => l.endTime)?.endTime || '—';

  // Metrics derived from REAL telemetry. Retrieval-success / coverage / per-service
  // latency are not yet instrumented, so they are intentionally not shown as
  // fabricated numbers — see the "illustrative" note on the services table.
  const metrics = [
    {
      id: 'index-health',
      title: t('settings.metrics.indexHealth.title'),
      value: syncStatus ? `${syncStatus.indexIntegrity}%` : '—',
      description: t('settings.metrics.indexHealth.description'),
      status: syncStatus ? t('status.optimal') : t('status.current'),
      statusVariant: syncStatus ? ('success' as const) : ('neutralMuted' as const),
      icon: ShieldCheck
    },
    {
      id: 'documents-indexed',
      title: t('settings.metrics.documentsIndexed.title'),
      value: syncStatus ? syncStatus.totalIndexedKeys.toLocaleString() : '—',
      description: t('settings.metrics.documentsIndexed.description'),
      status: t('status.current'),
      statusVariant: 'brand' as const,
      icon: Layers
    },
    {
      id: 'last-sync',
      title: t('settings.metrics.lastSync.title'),
      value: lastSyncEnd,
      description: t('settings.metrics.lastSync.description'),
      status: t('status.current'),
      statusVariant: 'neutralMuted' as const,
      icon: Clock
    }
  ];

  // Illustrative service list — NOT live telemetry (no backing instrumentation
  // yet). Kept as a clearly-labelled sample so the layout is representative
  // without asserting a real health state.
  const services = [
    {
      name: 'Knowledge Vector Database',
      description: t('settings.services.vectorDb.description'),
      status: t('status.healthy'),
      latency: '42ms',
      coverage: '98%',
      lastSync: '2026-06-24T06:22:18Z',
      version: 'v4.12.2'
    },
    {
      name: 'Enterprise Grounding Hub',
      description: t('settings.services.groundingHub.description'),
      status: t('status.healthy'),
      latency: '12ms',
      coverage: '100%',
      lastSync: '2026-06-24T06:00:00Z',
      version: 'v2.4.0'
    },
    {
      name: 'Cross-Brand Document Sync Router',
      description: t('settings.services.docSyncRouter.description'),
      status: t('status.warning'),
      latency: '185ms',
      coverage: '75%',
      lastSync: '2026-06-21T18:00:00Z',
      version: 'v1.8.5'
    },
    {
      name: 'Legacy Archive Indexer',
      description: t('settings.services.legacyArchive.description'),
      status: t('status.halted'),
      latency: '--',
      coverage: '40%',
      lastSync: '2026-06-15T15:00:00Z',
      version: 'v1.0.0'
    }
  ];

  // Real sync-job history from the DB (empty array falls back to an explicit
  // message row in the table below — never fabricated runs).
  const syncJobs = realSyncLogs.map((j) => ({
    sourceName: j.sourceName,
    type: j.type,
    recordsProcessed: typeof j.recordsProcessed === 'number' ? j.recordsProcessed : 0,
    duration: j.duration || '--',
    status: j.status,
    endTime: j.endTime || '—'
  }));

  return (
    <div id="platform_health_tab" className="space-y-8 font-sans text-left">
      
      {/* Top Banner section */}
      <section id="health_banner" className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-900 pb-2">
        <div>
          <h1 
            id="health_title"
            className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2"
          >
            <Activity className="h-5 w-5 text-success-600 dark:text-success-400" />
            {t('nav.systemHealth')}
          </h1>
        </div>
      </section>

      {/* KPI Grid Section */}
      <section id="health_metrics_section" aria-label={t('settings.regions.metricsSection')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div 
              key={metric.id}
              id={`metric_card_${metric.id}`}
              className="py-3 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-3xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{metric.title}</span>
                <Icon className="h-5 w-5 text-slate-400" />
              </div>
              
              <div className="mt-4 flex items-baseline gap-2.5">
                <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">{metric.value}</span>
                <Badge variant={metric.statusVariant}>
                  {metric.status}
                </Badge>
              </div>
              
              <span className="text-2xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {metric.description}
              </span>
            </div>
          );
        })}
      </section>

      {/* Core Services Table Segment (ServiceNow-Style Layout) */}
      <section id="health_services_section" aria-label={t('settings.regions.servicesSection')} className="space-y-3.5">
        <div className="flex items-center gap-2 select-none text-slate-400 dark:text-slate-500">
          <Database className="h-4 w-4" />
          <h2 className="text-3xs font-mono font-bold uppercase tracking-wider">
            {t('settings.sectionHeaders.integrationServices', { count: services.length })}
          </h2>
          <Badge variant="amber">
            {t('settings.illustrative')}
          </Badge>
        </div>

        <TableContainer aria-label={t('settings.regions.servicesTable')}>
          <TableHead>
            <tr>
              <TableHeaderCell className="w-1/3">{t('settings.tableHeaders.service')}</TableHeaderCell>
              <TableHeaderCell>{t('settings.tableHeaders.operationalStatus')}</TableHeaderCell>
              <TableHeaderCell className="text-center">{t('settings.tableHeaders.serviceLatency')}</TableHeaderCell>
              <TableHeaderCell className="text-center">{t('settings.tableHeaders.indexCoverage')}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t('settings.tableHeaders.serviceVersion')}</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {services.map((service, index) => {
              const isHealthy = service.status === t('status.healthy');
              const isWarning = service.status === t('status.warning');

              return (
                <TableRow key={index} id={`service_row_${index}`}>
                  <TableCell>
                    <div className="font-bold text-slate-800 dark:text-slate-200">{service.name}</div>
                    <div className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5 font-normal leading-relaxed">{service.description}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        isHealthy ? 'bg-success-500' : isWarning ? 'bg-warning-500' : 'bg-danger-500'
                      }`}></span>
                      <span className={`font-mono font-bold text-3xs uppercase ${
                        isHealthy ? 'text-success-600 dark:text-success-400' : isWarning ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'
                      }`}>
                        {service.status}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-400">{service.latency}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-400">{service.coverage}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-slate-500 dark:text-slate-400">{service.version}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </TableContainer>
      </section>

      {/* Sync Log Section (Microsoft Admin Center Style Logs) */}
      <section id="health_sync_log_section" aria-label={t('settings.regions.syncSection')} className="space-y-3.5">
        <div className="flex items-center gap-2 select-none text-slate-400 dark:text-slate-500">
          <History className="h-4 w-4" />
          <h2 className="text-3xs font-mono font-bold uppercase tracking-wider">
            {t('settings.sectionHeaders.syncLogs')}
          </h2>
        </div>

        <TableContainer aria-label={t('settings.regions.syncTable')}>
          <TableHead>
            <tr>
              <TableHeaderCell className="w-1/3">{t('sync.tableHeaders.targetSource')}</TableHeaderCell>
              <TableHeaderCell>{t('sync.tableHeaders.syncType')}</TableHeaderCell>
              <TableHeaderCell className="text-center">{t('settings.syncLogHeaders.recordsIndexed')}</TableHeaderCell>
              <TableHeaderCell className="text-center">{t('settings.syncLogHeaders.syncDuration')}</TableHeaderCell>
              <TableHeaderCell>{t('settings.syncLogHeaders.syncResult')}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t('settings.syncLogHeaders.completedTime')}</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {syncJobs.map((job, index) => {
              const isCompleted = job.status === 'Completed';
              const isWarning = job.status === 'Warning';

              return (
                <TableRow key={index} id={`sync_row_${index}`}>
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
            {syncJobs.length === 0 && (
              <tr>
                <TableCell colSpan={6} className="text-center">
                  <span className="text-2xs text-slate-500 dark:text-slate-400 font-normal">
                    {statusError ? t('settings.telemetryUnavailable') : t('settings.noSyncRuns')}
                  </span>
                </TableCell>
              </tr>
            )}
          </TableBody>
        </TableContainer>
      </section>
    </div>
  );
};
