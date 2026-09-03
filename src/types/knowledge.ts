/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface KnowledgeRecord {
  id: string;
  title: string;
  description: string;
  done: boolean;
  category: string;
  type: 'mandatory' | 'business' | 'attention' | 'standard';
  notes?: string;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  description: string;
  type: 'local' | 'mcp' | 'api';
  departmentScope?: 'global' | 'specific';
  departmentIds?: string[];
  status: 'healthy' | 'warning' | 'error' | 'syncing';
  lastUpdate: string;
  coverage: number;
  owner: string;

  // New Business Fields
  businessArea: string;
  criticality: 'Low' | 'Medium' | 'High' | 'Critical';
  primaryAudience: string[];
  recordCount: number;
  monthlyQueries: number;
  confidenceScore: number;
  lastSync: string;
  freshnessScore: number;
  daysSinceReview: number;
  reviewTeam: string;
  department: string;
  operationalRisk: 'Low' | 'Medium' | 'High';
  mcpStatus: 'not_connected' | 'connected' | 'syncing' | 'pending';
  mcpLastSync?: string;
  mcpCoverage?: number;
  mcpReliability?: number;
  isAuthoritative?: boolean;
}

export interface KnowledgeAnswerSource {
  id: string;
  name: string;
  /**
   * Short content excerpt showing WHY this document matched the query, produced
   * by the server's lexical retrieval. Lets the user see the relevant passage
   * and disambiguate between several similar matches. Optional (absent on the
   * local offline fallback and legacy answers).
   */
  snippet?: string;
  /** Lexical relevance score from server retrieval; higher = stronger match. */
  score?: number;
}

export interface KnowledgeResponse<T> {
  data: T;
  source: KnowledgeSource;
  timestamp: number;
}

export interface KnowledgeAnswer {
  id: string;
  title: string;
  summary: string;
  content: string; // Markdown
  confidenceScore: number;
  sources: KnowledgeAnswerSource[];
  status: 'verified' | 'review-needed' | 'draft';
  answerType: 'policy' | 'procedure' | 'faq' | 'guideline';
  businessDomain: string;
  lastUpdated: string;
  reviewOwner: string;
  feedbackActions: {
    helpful: boolean;
    flagged: boolean;
  };
}
