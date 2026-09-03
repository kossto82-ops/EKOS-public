/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SearchKnowledgeResponse } from '../types/apiContracts';
import { searchApi } from '../api/searchApi';
import { ResponseState, withTimeout, executeWithRetry, mapToApiError } from './baseService';

export interface ISearchService {
  /**
   * Searches the enterprise knowledge base with timeout protection,
   * automatic retry capabilities, and a structured ResponseState.
   */
  search(query: string, brandId?: string, departmentId?: string, locale?: string): Promise<ResponseState<SearchKnowledgeResponse>>;
}

class SearchServiceImpl implements ISearchService {
  async search(query: string, brandId?: string, departmentId?: string, locale?: string): Promise<ResponseState<SearchKnowledgeResponse>> {
    // Generate a temporary requestId for local tracking
    const tempRequestId = `req_svc_${Math.random().toString(36).substring(2, 11)}`;

    try {
      // Execute retrieval with a strict 30-second timeout constraint and 2 automatic retries (total 3 attempts).
      // Note: Search queries are read-only (idempotent), so automatic retries are safe.
      const { data: apiResponse, retries } = await executeWithRetry(
        async () => {
          const fetchPromise = searchApi.search(query, brandId, departmentId, locale);
          const response = await withTimeout(fetchPromise, 30000);
          
          if (!response.success) {
            // Throw so that the retry engine catches the failure and backs off
            throw response.error || new Error('Internal retrieval status failure');
          }
          return response;
        },
        2, // 2 retries (3 attempts total)
        true // Idempotent read-only request
      );

      return {
        data: apiResponse.data,
        isLoading: false,
        error: null,
        retries
      };

    } catch (error: unknown) {
      // Map any network failures, timeouts, or backend rejections to standard ApiError format
      const apiError = mapToApiError(error, tempRequestId);
      
      return {
        data: null,
        isLoading: false,
        error: apiError,
        retries: 2
      };
    }
  }
}

export const searchService: ISearchService = new SearchServiceImpl();
