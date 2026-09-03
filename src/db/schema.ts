import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

/**
 * 1. kb_documents Table
 */
export const kbDocuments = sqliteTable('kb_documents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(), // 'trained', 'failed', 'processing'
  scope: text('scope').notNull(), // 'global' or 'brand'
  brandId: text('brand_id'), // optional, only for brand scope
  category: text('category'),
  isImportant: integer('is_important', { mode: 'boolean' }).default(false),
  content: text('content'),
  uploadedAt: text('uploaded_at').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  owner: text('owner'),
  ownerId: text('owner_id'), // optional FK-by-convention to a PortalUser id — the responsible person who may edit this doc
  department: text('department'),
  departmentScope: text('department_scope'), // 'global' or 'specific'
  departmentIds: text('department_ids'), // JSON serialized list, e.g. '["customer_service","it"]'
  reviewFrequency: text('review_frequency'),
  expirationDate: text('expiration_date'),
  approvalStatus: text('approval_status'),
  version: text('version').default('1.0'),
  lastReviewDate: text('last_review_date'),
  viewsCount: integer('views_count').default(0),
  ratingUp: integer('rating_up').default(0),
  ratingDown: integer('rating_down').default(0),
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'), // nullable for soft-deletes
  processingReport: text('processing_report'), // JSON summary of parsing/chunking run
});

/**
 * 2. kb_document_versions Table
 */
export const kbDocumentVersions = sqliteTable('kb_document_versions', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => kbDocuments.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  content: text('content').notNull(),
  changeSummary: text('change_summary'),
  createdBy: text('created_by').notNull(),
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 3. kb_document_chunks Table
 */
export const kbDocumentChunks = sqliteTable('kb_document_chunks', {
  id: text('id').primaryKey(),
  versionId: text('version_id').notNull().references(() => kbDocumentVersions.id, { onDelete: 'cascade' }),
  documentId: text('document_id'), // Reference to top-level document
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  section: text('section'), // Title or structure path (e.g. "Section 1.2 > Table")
  estimatedTokenCount: integer('estimated_token_count'),
  futureEmbeddingStatus: text('future_embedding_status'), // 'pending', 'generated', 'failed', 'ignored'
  
  // Future Vector/Embedding integration fields
  embedding: text('embedding'), // JSON string or text-based high-dimensional vector placeholder
  embeddingModel: text('embedding_model'),
  embeddingVersion: text('embedding_version'),
  embeddingDate: text('embedding_date'),
  similarityScore: real('similarity_score'),
  validationWarnings: text('validation_warnings'), // serialized warnings list
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 4. kb_sources Table
 */
export const kbSources = sqliteTable('kb_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'gdrive', 'notion', 'confluence', 'webscraper'
  status: text('status').notNull(), // 'active', 'inactive', 'syncing'
  recordCount: integer('record_count').notNull().default(0),
  syncFrequency: text('sync_frequency').notNull(),
  lastUpdate: text('last_update'),
  config: text('config'), // JSON configuration string
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 5. kb_sync_jobs Table
 */
export const kbSyncJobs = sqliteTable('kb_sync_jobs', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => kbSources.id, { onDelete: 'cascade' }),
  sourceName: text('source_name').notNull(),
  type: text('type').notNull(), // 'Incremental Delta Sync', 'Scheduled Nightly Sync', etc.
  recordsProcessed: integer('records_processed').notNull().default(0),
  duration: text('duration').notNull(), // e.g. '14.5s'
  status: text('status').notNull(), // 'Completed', 'Warning', 'Halted', 'Started'
  endTime: text('end_time'),
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 6. kb_queries_audit Table
 */
export const kbQueriesAudit = sqliteTable('kb_queries_audit', {
  id: text('id').primaryKey(),
  query: text('query').notNull(),
  response: text('response').notNull(),
  confidence: text('confidence').notNull(), // 'High', 'Medium', 'Low'
  matchedSources: text('matched_sources'), // Comma separated or JSON string of source names/details
  rating: text('rating').default('none'), // 'up', 'down', 'none'
  feedback: text('feedback'),
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 7. kb_search_gaps Table
 */
export const kbSearchGaps = sqliteTable('kb_search_gaps', {
  id: text('id').primaryKey(),
  query: text('query').notNull(),
  timestamp: text('timestamp').notNull(),
  hasResults: integer('has_results', { mode: 'boolean' }).notNull(),
  dominantSource: text('dominant_source').notNull(),
  escalated: integer('escalated', { mode: 'boolean' }).notNull().default(false),
  confidence: text('confidence').notNull(), // 'High', 'Medium', 'Low'
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 8. kb_governance_configs Table
 */
export const kbGovernanceConfigs = sqliteTable('kb_governance_configs', {
  key: text('key').primaryKey(), // 'ai_provider_config', 'desk_settings', 'review_tasks'
  value: text('value').notNull(), // JSON string representing the actual settings object
  
  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/**
 * 9. kb_brands Table
 */
export const kbBrands = sqliteTable('kb_brands', {
  id: text('id').primaryKey(),
  displayName: text('displayName').notNull(),
  shortCode: text('shortCode').notNull(),
  country: text('country'),
  locale: text('locale'),
  vatRate: real('vatRate'),
  vatLabel: text('vatLabel'),
  currency: text('currency'),
  currencySymbol: text('currencySymbol'),
  color: text('color'),
  teamIds: text('teamIds'), // JSON serialized list
  pricingPlans: text('pricingPlans'), // JSON serialized list
  isActive: integer('isActive', { mode: 'boolean' }).default(true),
  tenantId: text('tenantId').default('tenant_default'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

/**
 * 10. user_directory Table
 *
 * Maps a corporate Active Directory user name to an EKOS identity for the OAuth
 * authentication mode (docs/AUTH_INTEGRATION_PLAN.md §5, decision #1: a DB table
 * rather than AD `authorities` claims). One row per provisioned corporate user;
 * a corporate login with no row is authenticated but NOT authorized (the caller
 * fails closed). RBAC still consumes only `role` + `departmentIds`; the rest are
 * carried so req.user is a complete PortalUser without a second lookup.
 *
 * Seeded from src/constants/users.ts (corporate_username = email local-part) as
 * the bridge from the interim roster; maintained by admins thereafter.
 */
export const userDirectory = sqliteTable('user_directory', {
  corporateUsername: text('corporate_username').primaryKey(), // lower-cased AD user_name
  ekosUserId: text('ekos_user_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  departmentIds: text('department_ids').notNull(), // JSON array
  brandIds: text('brand_ids').notNull(),           // JSON array
  permissions: text('permissions').notNull(),      // JSON PortalUser.permissions
  status: text('status').notNull().default('Active'),

  // Enterprise Standard Fields
  tenantId: text('tenant_id').notNull().default('tenant_default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 11. auth_sessions Table
 *
 * Server-side sessions for the BFF login flow (docs/AUTH_INTEGRATION_PLAN.md §4,
 * decision #3: a SQLite table now, Redis at multi-node). One row per logged-in
 * browser. The corporate access/refresh tokens are stored ENCRYPTED at rest
 * (src/server/crypto.ts) and never leave the server — the browser only ever
 * holds the signed, httpOnly session-id cookie. A row is created at
 * /auth/callback, read on every authenticated request, and deleted at
 * /auth/logout or when it passes `expires_at`.
 */
export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(), // opaque session id (the cookie carries a signed form)
  ekosUserId: text('ekos_user_id').notNull(),
  corporateUsername: text('corporate_username').notNull(),
  accessTokenEnc: text('access_token_enc').notNull(),  // AES-256-GCM ciphertext
  refreshTokenEnc: text('refresh_token_enc'),          // nullable, encrypted
  accessTokenExp: integer('access_token_exp'),         // unix seconds
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),             // absolute session expiry, ISO
  lastSeenAt: text('last_seen_at').notNull(),
});

/**
 * Drizzle Relations Definitions
 */

export const kbDocumentsRelations = relations(kbDocuments, ({ many }) => ({
  versions: many(kbDocumentVersions),
}));

export const kbDocumentVersionsRelations = relations(kbDocumentVersions, ({ one, many }) => ({
  document: one(kbDocuments, {
    fields: [kbDocumentVersions.documentId],
    references: [kbDocuments.id],
  }),
  chunks: many(kbDocumentChunks),
}));

export const kbDocumentChunksRelations = relations(kbDocumentChunks, ({ one }) => ({
  version: one(kbDocumentVersions, {
    fields: [kbDocumentChunks.versionId],
    references: [kbDocumentVersions.id],
  }),
}));

export const kbSourcesRelations = relations(kbSources, ({ many }) => ({
  syncJobs: many(kbSyncJobs),
}));

export const kbSyncJobsRelations = relations(kbSyncJobs, ({ one }) => ({
  source: one(kbSources, {
    fields: [kbSyncJobs.sourceId],
    references: [kbSources.id],
  }),
}));
