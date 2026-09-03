/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { syncApi } from '../api/syncApi';
import { apiClient } from '../config/apiClient';
import { SyncStatusResponse, TriggerSyncResponse, SyncJobLog } from '../types/apiContracts';
import { KnowledgeSource } from '../types/knowledge';

/** Normalized outcome of a real SharePoint crawl trigger. */
export interface SharePointSyncOutcome {
  /** Whether the SP_* Graph credentials are configured server-side. */
  configured: boolean;
  /** Whether a crawl actually ran and succeeded. */
  success: boolean;
  /** Documents ingested/updated (0 when not configured or failed). */
  total: number;
  error?: string;
}

export interface ISyncService {
  getSyncStatus(): Promise<SyncStatusResponse>;
  triggerManualIngestion(): Promise<TriggerSyncResponse>;
  registerCompletedSync(log: Omit<SyncJobLog, 'id'>): Promise<SyncJobLog>;
  triggerSharePointSync(): Promise<SharePointSyncOutcome>;
  getKnowledgeSources(): Promise<KnowledgeSource[]>;
  updateSourceStatus(id: string, status: string): Promise<KnowledgeSource>;
}

class SyncServiceImpl implements ISyncService {
  async getSyncStatus(): Promise<SyncStatusResponse> {
    const response = await syncApi.getSyncStatus();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get ingestion sync status');
    }
    return response.data;
  }

  async triggerManualIngestion(): Promise<TriggerSyncResponse> {
    const response = await syncApi.triggerIncrementalSync();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to trigger manual index crawling');
    }
    return response.data;
  }

  async registerCompletedSync(log: Omit<SyncJobLog, 'id'>): Promise<SyncJobLog> {
    const response = await syncApi.addSyncLog(log);
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to register completed ingestion sync log');
    }
    return response.data;
  }

  async triggerSharePointSync(): Promise<SharePointSyncOutcome> {
    // Hits the REAL crawl endpoint. When SP_* is unconfigured the server
    // returns HTTP 200 with { success:false, configured:false } — surfaced
    // here so the UI can be honest ("not configured") instead of fabricating a
    // completed sync. On success we report the server's real ingested count.
    const res: any = await apiClient.post('/api/db/sync/sharepoint', {});
    const errMsg = typeof res?.error === 'string' ? res.error : res?.error?.message;
    if (res && res.configured === false) {
      return { configured: false, success: false, total: 0, error: errMsg };
    }
    if (res && res.success) {
      return { configured: true, success: true, total: res.data?.total ?? 0 };
    }
    return { configured: true, success: false, total: 0, error: errMsg || 'SharePoint sync failed.' };
  }

  async getKnowledgeSources(): Promise<KnowledgeSource[]> {
    const json = await apiClient.get<KnowledgeSource[]>('/api/db/sources');
    if (!json.success) {
      throw new Error(json.error?.message || 'Failed to load knowledge sources');
    }
    return json.data;
  }

  async updateSourceStatus(id: string, status: string): Promise<KnowledgeSource> {
    const json = await apiClient.post<KnowledgeSource>(`/api/db/sources/${encodeURIComponent(id)}/status`, { status });
    if (!json.success) {
      throw new Error(json.error?.message || 'Failed to update source status');
    }
    return json.data;
  }
}

export const syncService: ISyncService = new SyncServiceImpl();
