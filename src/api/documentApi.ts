/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiResponse, GetDocumentsResponse, UploadDocumentResponse, DeleteDocumentResponse } from '../types/apiContracts';
import { KBDocument, KBDocumentUpdate } from '../types';
import { apiClient } from '../config/apiClient';

export const documentApi = {
  /**
   * Retrieves a page of document records, optionally filtered by Brand ID.
   * Defaults to the server's first page (offset 0, limit 200) — pass
   * `offset` to fetch subsequent pages (see `GetDocumentsResponse.nextOffset`).
   */
  async getDocuments(brandId?: string, pagination?: { offset?: number; limit?: number }): Promise<ApiResponse<GetDocumentsResponse>> {
    const params = new URLSearchParams();
    if (brandId) params.set('brandId', brandId);
    if (pagination?.offset != null) params.set('offset', String(pagination.offset));
    if (pagination?.limit != null) params.set('limit', String(pagination.limit));
    const query = params.toString();
    const url = query ? `/api/db/documents?${query}` : '/api/db/documents';

    return apiClient.get<GetDocumentsResponse>(url);
  },

  /**
   * Retrieves a single document by its Unique Identifier
   */
  async getDocumentById(id: string): Promise<ApiResponse<KBDocument | null>> {
    const response = await apiClient.get<GetDocumentsResponse>('/api/db/documents');
    
    if (!response.success || !response.data) {
      return {
        success: false,
        data: null,
        error: response.error,
        metadata: response.metadata
      };
    }

    const documents: KBDocument[] = response.data.documents || [];
    const doc = documents.find(d => d.id === id) || null;

    return {
      success: true,
      data: doc,
      metadata: response.metadata
    };
  },

  /**
   * Uploads and registers a new document in the Enterprise knowledge repository
   */
  async uploadDocument(document: KBDocument): Promise<ApiResponse<UploadDocumentResponse>> {
    if (!document.name || !document.content) {
      return {
        success: false,
        data: null as any,
        error: {
          code: 'ERR_VALIDATION_FAILED',
          message: 'Document name and content are required'
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: 'req_doc_val_failed'
        }
      };
    }

    return apiClient.post<UploadDocumentResponse>('/api/db/documents', document);
  },

  /**
   * Deletes a document by ID
   */
  async deleteDocument(id: string): Promise<ApiResponse<DeleteDocumentResponse>> {
    return apiClient.delete<DeleteDocumentResponse>(`/api/db/documents/${encodeURIComponent(id)}`);
  },

  /**
   * Applies a partial update to a document — used both to persist a governance
   * approval decision (approvalStatus/version/lastReviewDate) and to let a
   * responsible owner edit content/metadata (content, owner, ownerId, category,
   * department). The server whitelists these fields and enforces permissions.
   */
  async updateDocument(
    id: string,
    patch: KBDocumentUpdate
  ): Promise<ApiResponse<{ document: KBDocument }>> {
    return apiClient.patch<{ document: KBDocument }>(`/api/db/documents/${encodeURIComponent(id)}`, patch);
  },

  /**
   * Applies a governance decision (approve / needs-fix / ban) to the document(s)
   * matching a name, resolved server-side so it works regardless of which page
   * the client has loaded. Returns how many rows were updated and the refreshed
   * documents (departmentIds parsed to string[]).
   */
  async setGovernanceDecision(
    documentName: string,
    decision: 'approved' | 'rejected' | 'banned'
  ): Promise<ApiResponse<{ updated: number; documents: KBDocument[] }>> {
    return apiClient.post<{ updated: number; documents: KBDocument[] }>(
      '/api/db/documents/governance-decision',
      { documentName, decision }
    );
  }
};
