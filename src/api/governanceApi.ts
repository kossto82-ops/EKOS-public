/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiResponse } from '../types/apiContracts';
import { AiProviderConfig, ReviewTask } from '../types';
import { apiClient } from '../config/apiClient';

export interface ISearchGap {
  id: string;
  query: string;
  timestamp: string;
  hasResults: boolean;
  dominantSource: string;
  escalated: boolean;
  confidence: string;
  resolved: boolean;
}

export interface IDeskSettings {
  maxAnswerSec: number;
  escalationStarLimit: number;
  enableSlack: boolean;
  enableGdpr: boolean;
}

export const governanceApi = {
  /**
   * Retrieves current AI models configuration
   */
  async getAiConfig(): Promise<ApiResponse<AiProviderConfig>> {
    return apiClient.get<AiProviderConfig>('/api/db/governance/ai-config');
  },

  /**
   * Updates AI Model parameters and active providers
   */
  async updateAiConfig(config: AiProviderConfig): Promise<ApiResponse<void>> {
    if (!config.model) {
      return {
        success: false,
        data: undefined,
        error: {
          code: 'ERR_INVALID_AI_MODEL',
          message: 'Model identifier cannot be blank'
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: 'req_gov_invalid'
        }
      };
    }

    return apiClient.post<void>('/api/db/governance/ai-config', config);
  },

  /**
   * Loads search query gaps detected in operations
   */
  async getSearchGaps(): Promise<ApiResponse<ISearchGap[]>> {
    return apiClient.get<ISearchGap[]>('/api/db/governance/gaps');
  },

  /**
   * Persists updated or resolved search gaps list
   */
  async saveSearchGaps(gaps: ISearchGap[]): Promise<ApiResponse<void>> {
    return apiClient.post<void>('/api/db/governance/gaps', gaps);
  },

  /**
   * Retrieves current governance workflow review tasks
   */
  async getReviewTasks(): Promise<ApiResponse<ReviewTask[]>> {
    return apiClient.get<ReviewTask[]>('/api/db/governance/tasks');
  },

  /**
   * Persists active review task adjustments or state transitions
   */
  async saveReviewTasks(tasks: ReviewTask[]): Promise<ApiResponse<void>> {
    return apiClient.post<void>('/api/db/governance/tasks', tasks);
  },

  /**
   * Files a single review task from an issue report. Unlike saveReviewTasks,
   * this intake endpoint is open to any authenticated caller (e.g. an agent in
   * the Assistant) — the server forces a fresh unresolved status and appends it
   * to the queue.
   */
  async submitReport(task: ReviewTask): Promise<ApiResponse<ReviewTask>> {
    return apiClient.post<ReviewTask>('/api/db/governance/report', task);
  },

  /**
   * Loads global administrative secretary response metrics
   */
  async getDeskSettings(): Promise<ApiResponse<IDeskSettings>> {
    return apiClient.get<IDeskSettings>('/api/db/governance/desk-settings');
  },

  /**
   * Saves global desk rules and automation parameters
   */
  async saveDeskSettings(settings: IDeskSettings): Promise<ApiResponse<void>> {
    return apiClient.post<void>('/api/db/governance/desk-settings', settings);
  }
};
