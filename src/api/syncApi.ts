/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiResponse, SyncStatusResponse, TriggerSyncResponse, SyncJobLog } from '../types/apiContracts';
import { apiClient } from '../config/apiClient';

export const syncApi = {
  /**
   * Retrieves active knowledge base crawler synchronization status
   */
  async getSyncStatus(): Promise<ApiResponse<SyncStatusResponse>> {
    return apiClient.get<SyncStatusResponse>('/api/db/sync/status');
  },

  /**
   * Triggers an incremental delta crawl & indexing synchronization job
   */
  async triggerIncrementalSync(): Promise<ApiResponse<TriggerSyncResponse>> {
    return apiClient.post<TriggerSyncResponse>('/api/db/sync/run', {
      sourceId: 'src_sharepoint_kb',
      sourceName: 'SharePoint — Knowledge Base',
      type: 'Incremental Delta Sync',
      recordsProcessed: Math.floor(Math.random() * 50) + 1,
      duration: '3.5s',
      status: 'Completed'
    });
  },

  /**
   * Logs a completed or pending crawler sync job transaction
   */
  async addSyncLog(log: Omit<SyncJobLog, 'id'>): Promise<ApiResponse<SyncJobLog>> {
    const runResponse = await apiClient.post<{ jobId: string }>('/api/db/sync/run', log);
    
    if (!runResponse.success || !runResponse.data) {
      return {
        success: false,
        data: null as any,
        error: runResponse.error,
        metadata: runResponse.metadata
      };
    }

    // Get updated sync status to find the newly logged task, similar to the original logic
    const statusResponse = await apiClient.get<SyncStatusResponse>('/api/db/sync/status');
    const logs: SyncJobLog[] = statusResponse.success && statusResponse.data 
      ? statusResponse.data.syncLogs || [] 
      : [];
      
    const newLog = logs[0] || { id: runResponse.data.jobId, ...log };

    return {
      success: true,
      data: newLog,
      metadata: runResponse.metadata
    };
  }
};
