/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { governanceApi, ISearchGap, IDeskSettings } from '../api/governanceApi';
import { AiProviderConfig, ReviewTask } from '../types';

export interface IGovernanceService {
  getAiConfig(): Promise<AiProviderConfig>;
  updateAiConfig(config: AiProviderConfig): Promise<void>;
  
  getSearchGaps(): Promise<ISearchGap[]>;
  addSearchGap(gap: Omit<ISearchGap, 'id' | 'timestamp'>): Promise<ISearchGap>;
  resolveSearchGap(id: string): Promise<void>;
  saveSearchGaps(gaps: ISearchGap[]): Promise<void>;
  
  getReviewTasks(): Promise<ReviewTask[]>;
  addReviewTask(task: Omit<ReviewTask, 'id' | 'createdAt'>): Promise<ReviewTask>;
  updateReviewTaskStatus(id: string, status: ReviewTask['status']): Promise<void>;
  saveReviewTasks(tasks: ReviewTask[]): Promise<{ blockedCount: number }>;
  submitReport(task: ReviewTask): Promise<ReviewTask>;

  getDeskSettings(): Promise<IDeskSettings>;
  updateDeskSettings(settings: IDeskSettings): Promise<void>;
}

class GovernanceServiceImpl implements IGovernanceService {
  async getAiConfig(): Promise<AiProviderConfig> {
    const response = await governanceApi.getAiConfig();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to fetch AI configuration');
    }
    return response.data;
  }

  async updateAiConfig(config: AiProviderConfig): Promise<void> {
    const response = await governanceApi.updateAiConfig(config);
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to update AI model configuration');
    }
  }

  async getSearchGaps(): Promise<ISearchGap[]> {
    const response = await governanceApi.getSearchGaps();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to fetch search gaps list');
    }
    return response.data;
  }

  async addSearchGap(gap: Omit<ISearchGap, 'id' | 'timestamp'>): Promise<ISearchGap> {
    const listRes = await governanceApi.getSearchGaps();
    if (!listRes.success) {
      throw new Error(listRes.error?.message || 'Failed to fetch existing search gaps');
    }
    const gaps = listRes.data;
    const newGap: ISearchGap = {
      ...gap,
      id: `gap_${Math.random().toString(36).substring(2, 11)}`,
      timestamp: new Date().toISOString()
    };
    const saveRes = await governanceApi.saveSearchGaps([newGap, ...gaps]);
    if (!saveRes.success) {
      throw new Error(saveRes.error?.message || 'Failed to save new search gap log');
    }
    return newGap;
  }

  async resolveSearchGap(id: string): Promise<void> {
    const listRes = await governanceApi.getSearchGaps();
    if (!listRes.success) {
      throw new Error(listRes.error?.message || 'Failed to fetch existing search gaps');
    }
    const gaps = listRes.data;
    const updated = gaps.map(g => (g.id === id ? { ...g, resolved: true } : g));
    const saveRes = await governanceApi.saveSearchGaps(updated);
    if (!saveRes.success) {
      throw new Error(saveRes.error?.message || 'Failed to update search gap resolution status');
    }
  }

  async saveSearchGaps(gaps: ISearchGap[]): Promise<void> {
    const saveRes = await governanceApi.saveSearchGaps(gaps);
    if (!saveRes.success) {
      throw new Error(saveRes.error?.message || 'Failed to persist search gaps');
    }
  }

  async getReviewTasks(): Promise<ReviewTask[]> {
    const response = await governanceApi.getReviewTasks();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to fetch policy review tasks');
    }
    return response.data;
  }

  async addReviewTask(task: Omit<ReviewTask, 'id' | 'createdAt'>): Promise<ReviewTask> {
    const listRes = await governanceApi.getReviewTasks();
    if (!listRes.success) {
      throw new Error(listRes.error?.message || 'Failed to fetch existing review tasks');
    }
    const tasks = listRes.data;
    const newTask: ReviewTask = {
      ...task,
      id: `task_${Math.random().toString(36).substring(2, 11)}`,
      createdAt: new Date().toISOString()
    };
    const saveRes = await governanceApi.saveReviewTasks([newTask, ...tasks]);
    if (!saveRes.success) {
      throw new Error(saveRes.error?.message || 'Failed to save review policy task');
    }
    return newTask;
  }

  async updateReviewTaskStatus(id: string, status: ReviewTask['status']): Promise<void> {
    const listRes = await governanceApi.getReviewTasks();
    if (!listRes.success) {
      throw new Error(listRes.error?.message || 'Failed to fetch existing review tasks');
    }
    const tasks = listRes.data;
    const updated = tasks.map(t => (t.id === id ? { ...t, status } : t));
    const saveRes = await governanceApi.saveReviewTasks(updated);
    if (!saveRes.success) {
      throw new Error(saveRes.error?.message || 'Failed to update review task status');
    }
  }

  async saveReviewTasks(tasks: ReviewTask[]): Promise<{ blockedCount: number }> {
    const saveRes = await governanceApi.saveReviewTasks(tasks);
    if (!saveRes.success) {
      throw new Error(saveRes.error?.message || 'Failed to persist review tasks');
    }
    // The server may sanitize blocked re-approvals; surface the count so the
    // caller can reconcile the cache/UI to what actually persisted.
    return { blockedCount: (saveRes as any).blockedCount ?? 0 };
  }

  async submitReport(task: ReviewTask): Promise<ReviewTask> {
    const res = await governanceApi.submitReport(task);
    if (!res.success) {
      throw new Error(res.error?.message || 'Failed to file review task report');
    }
    return res.data;
  }

  async getDeskSettings(): Promise<IDeskSettings> {
    const response = await governanceApi.getDeskSettings();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to fetch global desk configuration metrics');
    }
    return response.data;
  }

  async updateDeskSettings(settings: IDeskSettings): Promise<void> {
    const response = await governanceApi.saveDeskSettings(settings);
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to save global desk configuration metrics');
    }
  }
}

export const governanceService: IGovernanceService = new GovernanceServiceImpl();
export type { ISearchGap };
