/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// AUTH & ROLES
export type Role = 'Administrator' | 'LocationManager' | 'TeamLeader' | 'Operator' | 'Agent';
export type UserRole = Role;

export interface Department {
  id: string;
  displayName: string;
  icon: string;
  color: string;
  description: string;
}

// Role visibility rules:
// - 'settings' tab full: Administrator only
// - 'kb' tab upload/delete: Administrator, TeamLeader
// - 'copilot', 'sources': all roles

export type Tab = 'kb' | 'copilot' | 'sources' | 'settings' | 'sync' | 'governance' | 'review';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'Active' | 'Away' | 'Inactive';
  brandIds: string[];        // which brands this user belongs to
  departmentIds: string[];   // which departments this user belongs to. '*' = all departments
  teamId?: string;
  lastActive: string;
  permissions: {
    manageRates: boolean;
    manageForwarding: boolean;
    manageClients: boolean;
    viewLogs: boolean;
    manageAiAgents: boolean;
    manageKnowledgeBase: boolean;
  };
}

// BRANDS
export interface BrandPricingPlan {
  name: string;              // "Starter" | "Standard" | "Pro"
  baseMonthly: number;       // net price
  includedMinutes: number;
  excessRatePerMin: number;
  currency: string;          // "EUR"
  currencySymbol: string;    // "€"
}

export interface Brand {
  id: string;                // "northwind_es" | "northwind_bureau" | "northwind_de" | ...
  displayName: string;       // "Secretaría.es"
  shortCode: string;         // "ES" | "FR" | "DE"
  country: string;           // "Spain"
  locale: string;            // "es-ES"
  vatRate: number;           // 0.21 | 0.20 | 0.19
  vatLabel: string;          // "IVA" | "TVA" | "MwSt"
  currency: string;
  currencySymbol: string;
  pricingPlans: BrandPricingPlan[];
  color: string;             // Tailwind color string for brand badge (e.g. "emerald", "fuchsia")
  teamIds: string[];
}

export interface Team {
  id: string;
  name: string;              // "Service ES" | "Service FR" | "Service DE"
  brandId: string;
  leadId?: string;           // PortalUser.id
  memberIds: string[];
}

// KNOWLEDGE BASE
export interface KBDocument {
  id: string;
  name: string;
  type: 'pdf' | 'xlsx' | 'docx' | 'csv' | 'txt' | 'md';
  status: 'trained' | 'pending' | 'indexing';
  scope: 'global' | 'brand';   // global = shared across all brands
  brandId?: string;             // set if scope === 'brand'
  departmentScope?: 'global' | 'specific';   // global = visible to all departments
  departmentIds?: string[];                  // set if departmentScope === 'specific'. Can include multiple.
  category?: string;            // document classification category
  content?: string;
  uploadedAt: string;
  uploadedBy: string;
  owner?: string;
  ownerId?: string;   // responsible PortalUser id — this user may edit the document even without KB-manage permission
  department?: string;
  reviewFrequency?: string;
  expirationDate?: string;
  approvalStatus?: 'Approved' | 'Draft' | 'Under Review' | 'Expired' | 'Banned';
  version?: string;
  lastReviewDate?: string;
  viewsCount?: number;
  ratingUp?: number;
  ratingDown?: number;
  isImportant?: boolean;   // high priority / critical documents
}

/**
 * Fields that may be sent in a PATCH /api/db/documents/:id partial update.
 * ownerId and brandId accept null so a manager can clear them (unassign the
 * responsible owner / set the region back to Global).
 */
export type KBDocumentUpdate =
  Partial<Pick<KBDocument, 'approvalStatus' | 'version' | 'lastReviewDate' | 'content' | 'owner' | 'category' | 'department' | 'scope' | 'departmentScope' | 'departmentIds'>>
  & { ownerId?: string | null; brandId?: string | null };

export interface KBMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  brandId?: string;
  confidence?: 'High' | 'Medium' | 'Low';
  sourcesDetails?: { name: string; version: string; lastReviewDate: string; owner: string; }[];
  feedback?: 'Helpful' | 'Outdated' | 'Incorrect' | 'Missing information';
}

// SETTINGS
export interface AiProviderConfig {
  provider: 'gemini' | 'anthropic' | 'openai' | 'groq' | 'custom';
  apiKey?: string;
  model: string;               // free text
  temperature: number;
  maxHistory: number;
  customEndpointUrl?: string;
  systemPromptOverride?: string;
}

// GOVERNANCE
export interface ReviewTask {
  id: string;
  documentName: string;
  docName?: string;
  feedbackType: string;
  agentQuery: string;
  messageContent: string;
  status: string;
  createdAt: string;
  owner: string;
  department: string;
  departmentIds?: string[];
  priority?: 'Urgent' | 'High' | 'Medium' | 'Low' | string;
  aiConfidence?: number;
  similarIncidents?: number;
  flags?: string[];
  dispatchNotes?: string;
  recommendation?: string;
}

// MISC
