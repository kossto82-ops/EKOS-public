/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KBDocument, Brand, PortalUser, AiProviderConfig } from './index';
import { KnowledgeSource, KnowledgeAnswer } from './knowledge';

/**
 * Standard API Response envelope
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    timestamp: string;
    requestId: string;
  };
}

/**
 * API Contracts for Document Management (Knowledge Base)
 */
export interface GetDocumentsResponse {
  documents: KBDocument[];
  totalCount: number;
  filteredCount: number;
  availableCategories: string[];
  // Server-side pagination (offset/limit) — hasMore/nextOffset describe the
  // filtered set, not the raw table. A caller that ignores these still gets
  // a valid (if now bounded to the default page size) response.
  hasMore: boolean;
  nextOffset: number | null;
}

export interface UploadDocumentResponse {
  document: KBDocument;
  ingestionJobId: string;
}

export interface DeleteDocumentResponse {
  documentId: string;
  deleted: boolean;
}

/**
 * API Contracts for Search and Retrieval
 */
/**
 * Where a search's wall-clock actually went. Absent on the client-side offline
 * fallback, which never reached the server and so has nothing to report.
 */
export interface SearchTimings {
  /** Loading the caller-scoped candidate set out of `kb_documents`. */
  candidatesMs: number;
  /** Lexical ranking + the query-embedding round-trip (+ reranking, if on). */
  retrievalMs: number;
  /** The answer call to the AI provider. Usually the whole story. */
  llmMs: number;
  /** Whole handler, including the parts the three stages above do not cover. */
  totalMs: number;
}

export interface SearchKnowledgeResponse {
  answer: KnowledgeAnswer;
  /** Whole-handler wall clock — despite the name, never retrieval alone. */
  retrievalLatencyMs: number;
  /** Per-stage breakdown of the number above. */
  timings?: SearchTimings;
  /**
   * Absolute cosine floor — a degenerate-vector guard, NOT the filter that
   * decides what survives. 0 when semantic search did not run.
   */
  vectorSimilarityThreshold: number;
  /**
   * The cut that actually applies: chunks must score at least this fraction of
   * the query's best chunk. null when semantic search did not run. See
   * docs/RAG.md §5.5 for why an absolute threshold is the wrong instrument.
   */
  vectorRelativeFloor?: number | null;
  /** Embedding-space signature (`provider:model[:dims]`), or 'lexical-only'. */
  indexVersion: string;
  // 'hybrid': lexical ranking fused with semantic chunk search.
  // 'lexical': semantic search was unavailable (no provider, nothing embedded,
  // or a provider error) and only term matching ran.
  retrievalMode?: 'hybrid' | 'lexical';
  // 'live_ai': the backend's real LLM synthesized this answer.
  // 'local_fallback': the LLM call failed or is unconfigured and this is the
  // client's local keyword-matched/generated substitute — see searchApi.ts.
  retrievalSource: 'live_ai' | 'local_fallback';
}

/**
 * API Contracts for Ingestion, Sync & Indexing Operations
 */
export interface SyncJobLog {
  id: string;
  sourceId: string;
  sourceName: string;
  type: string;
  recordsProcessed: number;
  duration: string;
  // Matches the values the server actually writes (sync.ts) and the DB comment
  // in schema.ts. 'Running' was never emitted; 'Started' is what TriggerSyncResponse advertises.
  status: 'Completed' | 'Warning' | 'Halted' | 'Started';
  endTime: string;
}

export interface SyncStatusResponse {
  syncLogs: SyncJobLog[];
  indexIntegrity: number;
  totalIndexedKeys: number;
  scheduledInterval: string;
  nextScheduledSync: string;
  isSyncing: boolean;
}

export interface TriggerSyncResponse {
  jobId: string;
  status: 'Started' | 'Queued' | 'Failed';
  estimatedDurationMs: number;
}

/**
 * API Contracts for System Governance & Configuration
 *
 * (GovernanceSettingsResponse and UpdateAiConfigResponse were removed: no route
 * ever returned those shapes and nothing imported them — a stale contract that
 * a future wire-up would have silently followed instead of the real
 * /api/db/governance/* envelopes.)
 */
