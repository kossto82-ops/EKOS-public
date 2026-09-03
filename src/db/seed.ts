import { db } from './db.ts';
import { 
  kbDocuments, 
  kbDocumentVersions, 
  kbDocumentChunks, 
  kbSources, 
  kbSyncJobs, 
  kbSearchGaps, 
  kbGovernanceConfigs,
  kbBrands,
  userDirectory
} from './schema.ts';
import { INITIAL_KB_DOCS } from '../constants/kb.ts';
import { INITIAL_KNOWLEDGE_SOURCES } from '../constants/sources.ts';
import { INITIAL_USERS } from '../constants/users.ts';
import { BRANDS } from '../constants/brands.ts';
import { buildChunkRows } from '../server/chunking.ts';
import { logger } from '../server/logger.ts';

export async function seedDatabase() {
  const now = new Date().toISOString();
  
  // Seed kb_brands (ensure all brands from BRANDS are present in the database)
  logger.info('Checking for missing brands in database...');
  const existingBrands = db.select().from(kbBrands).all();
  const existingBrandIds = new Set(existingBrands.map(b => b.id));
  
  let seededBrandsCount = 0;
  for (const b of BRANDS) {
    if (!existingBrandIds.has(b.id)) {
      db.insert(kbBrands).values({
        id: b.id,
        displayName: b.displayName,
        shortCode: b.shortCode,
        country: b.country || null,
        locale: b.locale || null,
        vatRate: b.vatRate !== undefined ? b.vatRate : null,
        vatLabel: b.vatLabel || null,
        currency: b.currency || null,
        currencySymbol: b.currencySymbol || null,
        color: b.color || null,
        teamIds: b.teamIds ? JSON.stringify(b.teamIds) : '[]',
        pricingPlans: b.pricingPlans ? JSON.stringify(b.pricingPlans) : '[]',
        isActive: true,
        tenantId: 'tenant_default',
        createdAt: now,
        updatedAt: now
      }).run();
      seededBrandsCount++;
    }
  }
  if (seededBrandsCount > 0) {
    logger.info({ seededBrands: seededBrandsCount }, 'Seeded missing brands into database');
  }

  // 1. Check if we already have documents to prevent double-seeding of the
  // one-time-only data below (sources, sync jobs, search gaps, governance configs).
  const existingDocIds = new Set(db.select({ id: kbDocuments.id }).from(kbDocuments).all().map(d => d.id));
  const isFirstSeed = existingDocIds.size === 0;

  if (!isFirstSeed) {
    // Still upsert any newly-added INITIAL_KB_DOCS entries (e.g. new KB articles)
    // into an already-seeded database — see the per-document loop below, which
    // skips ids that already exist either way.
    logger.info('Database already seeded. Checking for new documents to add...');
  } else {
    logger.info('Database empty. Seeding initial enterprise knowledge data...');
  }

  // 2. Seed kb_sources (Knowledge Sources). Runs on every boot but is
  // idempotent via onConflictDoNothing — so it backfills after an interrupted
  // first seed and never throws a UNIQUE error if kb_documents was truncated
  // for a re-ingest while kb_sources survived.
  for (const src of INITIAL_KNOWLEDGE_SOURCES) {
    db.insert(kbSources).values({
      id: src.id,
      name: src.name,
      type: src.type,
      status: src.status === 'healthy' ? 'active' : src.status === 'syncing' ? 'syncing' : 'inactive',
      recordCount: src.recordCount || 0,
      syncFrequency: 'Every 6h',
      lastUpdate: src.lastUpdate || now,
      config: JSON.stringify({
        description: src.description,
        coverage: src.coverage,
        owner: src.owner,
        businessArea: src.businessArea,
        criticality: src.criticality,
        primaryAudience: src.primaryAudience,
        monthlyQueries: src.monthlyQueries,
        confidenceScore: src.confidenceScore,
        freshnessScore: src.freshnessScore,
        daysSinceReview: src.daysSinceReview,
        reviewTeam: src.reviewTeam,
        department: src.department,
        operationalRisk: src.operationalRisk,
        mcpStatus: src.mcpStatus,
        isAuthoritative: src.isAuthoritative
      }),
      tenantId: 'tenant_default',
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing().run();
  }
  if (isFirstSeed) logger.info('Seeded knowledge sources.');

  // 3. Seed kb_documents, versions, and chunks — upsert-by-id so newly-added
  // INITIAL_KB_DOCS entries land in an already-seeded database too.
  let seededDocsCount = 0;
  for (const doc of INITIAL_KB_DOCS) {
    if (existingDocIds.has(doc.id)) continue;
    seededDocsCount++;
    // Insert document
    db.insert(kbDocuments).values({
      id: doc.id,
      name: doc.name,
      type: doc.type,
      status: doc.status || 'trained',
      scope: doc.scope,
      brandId: doc.brandId || null,
      category: doc.category || 'Operations Manual',
      isImportant: doc.isImportant || false,
      content: doc.content || '',
      uploadedAt: doc.uploadedAt || now,
      uploadedBy: doc.uploadedBy || 'system',
      owner: doc.owner || 'Operations Executive',
      // Kept null rather than defaulted: ownerId is the responsible PortalUser id
      // that PATCH /api/db/documents/:id checks to let that person edit their own
      // document (routes/documents.ts's isOwner). Crawled documents genuinely have
      // nobody, and inventing an id there would hand out edit rights; manually
      // uploaded documents carry the real uploader, and dropping it on the floor
      // silently took those rights away from the owner who just uploaded them.
      ownerId: doc.ownerId || null,
      department: doc.department || 'Operations',
      departmentScope: doc.departmentScope || 'global',
      departmentIds: doc.departmentIds ? JSON.stringify(doc.departmentIds) : '[]',
      reviewFrequency: doc.reviewFrequency || 'Every 90 days',
      // No fabricated expiry. This defaulted to the literal '2026-12-31', and
      // since nothing in the corpus supplies a real expiration date — kbMapping.ts
      // deliberately leaves it undefined, with a comment explaining that a uniform
      // hardcoded date makes the entire KB non-groundable — that default landed on
      // every row. isGroundableDoc() excludes anything expired, so on 2027-01-01
      // retrieval would have returned nothing, for every query, with no error.
      // The mapping layer was fixed for exactly this and the seed reintroduced it
      // one layer down. Stays null until a real review/expiry policy exists.
      expirationDate: doc.expirationDate || null,
      approvalStatus: doc.approvalStatus || 'Approved',
      version: doc.version || '1.0',
      lastReviewDate: doc.lastReviewDate || now.split('T')[0],
      viewsCount: doc.viewsCount || 0,
      ratingUp: doc.ratingUp || 0,
      ratingDown: doc.ratingDown || 0,
      tenantId: 'tenant_default',
      createdAt: now,
      updatedAt: now
    }).run();

    // Insert version
    const versionId = `ver_${doc.id}_${doc.version || '1.0'}`.replace(/\./g, '_');
    db.insert(kbDocumentVersions).values({
      id: versionId,
      documentId: doc.id,
      version: doc.version || '1.0',
      content: doc.content || '',
      changeSummary: 'Initial document ingest.',
      createdBy: doc.uploadedBy || 'system',
      tenantId: 'tenant_default',
      createdAt: now,
      updatedAt: now
    }).run();

    // Insert chunks. Embeddings are left null and futureEmbeddingStatus
    // 'pending' — the backfill in src/server/embeddings.ts vectorizes them
    // out of band so a first boot never blocks on a provider call.
    for (const chunk of buildChunkRows(doc.id, versionId, doc.content || '', now)) {
      db.insert(kbDocumentChunks).values(chunk).run();
    }
  }
  if (seededDocsCount > 0) {
    logger.info({ seededDocuments: seededDocsCount }, 'Seeded new documents, versions and chunks');
  }

  // Steps 4–6 below seed one-time data into independently-populated tables.
  // They run on EVERY boot (not gated on the docs-only isFirstSeed) and are
  // idempotent via onConflictDoNothing — so an interrupted first seed (process
  // died mid-document-loop) still backfills sync jobs / search gaps / governance
  // configs on the next boot instead of skipping them forever.

  // 4. Seed kb_sync_jobs (Sync logs) — must reference ids present in
  // INITIAL_KNOWLEDGE_SOURCES (kb_sync_jobs.source_id has a FK to kb_sources).
  const defaultSyncLogs = [
    {
      id: 'log_1',
      sourceId: 'src_sharepoint_kb',
      sourceName: 'SharePoint — Knowledge Base (Northwind ES)',
      type: 'Snapshot Ingestion',
      // Documents in the committed SharePoint snapshot. Keep in step with
      // src/data/sharepoint-kb-snapshot.json — the Sync board renders this
      // number, so a stale one reports an ingest that never happened.
      recordsProcessed: 118,
      duration: '--',
      status: 'Completed',
      endTime: '2026-07-17 12:00:00 UTC'
    }
  ];

  for (const log of defaultSyncLogs) {
    db.insert(kbSyncJobs).values({
      id: log.id,
      sourceId: log.sourceId,
      sourceName: log.sourceName,
      type: log.type,
      recordsProcessed: log.recordsProcessed,
      duration: log.duration,
      status: log.status,
      endTime: log.endTime,
      tenantId: 'tenant_default',
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing().run();
  }

  // 5. Seed kb_search_gaps (Search gaps)
  const defaultSearchGaps = [
    {
      id: 'init_gap_1',
      query: 'Cómo desviar llamadas desde una centralita 3CX',
      timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
      hasResults: false,
      dominantSource: 'N/A',
      escalated: true,
      confidence: 'Low',
      resolved: false
    },
    {
      id: 'init_gap_2',
      query: 'Portabilidad de número fijo a Northwind ES',
      timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
      hasResults: false,
      dominantSource: 'N/A',
      escalated: true,
      confidence: 'Low',
      resolved: false
    },
    {
      id: 'init_gap_3',
      query: '¿Qué código desactiva el desvío de llamadas en IberLink?',
      timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
      hasResults: true,
      dominantSource: 'IberLink.md',
      escalated: false,
      confidence: 'High',
      resolved: true
    }
  ];

  for (const gap of defaultSearchGaps) {
    db.insert(kbSearchGaps).values({
      id: gap.id,
      query: gap.query,
      timestamp: gap.timestamp,
      hasResults: gap.hasResults,
      dominantSource: gap.dominantSource,
      escalated: gap.escalated,
      confidence: gap.confidence,
      resolved: gap.resolved,
      tenantId: 'tenant_default',
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing().run();
  }

  // 6. Seed kb_governance_configs (AI provider config, desk settings, and review tasks)
  
  // AI Config
  // Default to Groq (key supplied via GROQ_API_KEY env var, so apiKey stays
  // empty here and is resolved at call time). This survives a db reseed without
  // silently reverting to a provider whose key isn't configured.
  const defaultAiConfig = {
    provider: 'groq',
    apiKey: '',
    model: 'llama-3.3-70b-versatile',
    temperature: 0.2,
    maxHistory: 10
  };
  db.insert(kbGovernanceConfigs).values({
    key: 'ai_provider_config',
    value: JSON.stringify(defaultAiConfig),
    tenantId: 'tenant_default',
    createdAt: now,
    updatedAt: now
  }).onConflictDoNothing().run();

  // Desk settings
  const defaultDeskSettings = {
    maxAnswerSec: 3.5,
    escalationStarLimit: 2,
    enableSlack: true,
    enableGdpr: true
  };
  db.insert(kbGovernanceConfigs).values({
    key: 'desk_settings',
    value: JSON.stringify(defaultDeskSettings),
    tenantId: 'tenant_default',
    createdAt: now,
    updatedAt: now
  }).onConflictDoNothing().run();

  // Review Tasks
  const defaultReviewTasks = [
    {
      id: 'init_task_1',
      documentName: '01_Pricing_Plans.md',
      feedbackType: 'Outdated',
      agentQuery: '¿Cuál es la tarifa del plan básico de Northwind ES?',
      messageContent: 'El agente citó una tarifa que podría no reflejar la última revisión comercial.',
      status: 'Under Review',
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      owner: 'Customer Service Operations',
      department: 'Billing & Finance',
      departmentIds: ['finance']
    },
    {
      id: 'init_task_2',
      documentName: 'Call_Forwarding_Setup es.md',
      feedbackType: 'Missing information',
      agentQuery: 'How to configure call forwarding on DemoTel devices?',
      messageContent: 'We only have standard codes for IberLink, TeleNord, and Rhonecom.',
      status: 'Feedback Received',
      createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      owner: 'Telecommunications Specialist',
      department: 'Telephony',
      departmentIds: ['it']
    }
  ];
  db.insert(kbGovernanceConfigs).values({
    key: 'review_tasks',
    value: JSON.stringify(defaultReviewTasks),
    tenantId: 'tenant_default',
    createdAt: now,
    updatedAt: now
  }).onConflictDoNothing().run();

  // 7. Seed user_directory (corporate AD user_name → EKOS identity) for OAuth
  // authentication mode. Bridge from the interim roster: corporate_username is
  // the local-part of each seeded user's email, lower-cased. Idempotent via
  // onConflictDoNothing so admins can edit/add rows without a reseed clobbering
  // them. See docs/AUTH_INTEGRATION_PLAN.md §5 and src/server/auth/identityMap.ts.
  const existingDirectory = new Set(
    db.select({ u: userDirectory.corporateUsername }).from(userDirectory).all().map((r) => r.u)
  );
  let seededDirectoryCount = 0;
  for (const u of INITIAL_USERS) {
    const corporateUsername = u.email.split('@')[0]?.toLowerCase();
    if (!corporateUsername) continue;
    if (existingDirectory.has(corporateUsername)) continue;
    db.insert(userDirectory).values({
      corporateUsername,
      ekosUserId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      departmentIds: JSON.stringify(u.departmentIds || []),
      brandIds: JSON.stringify(u.brandIds || []),
      permissions: JSON.stringify(u.permissions),
      status: u.status === 'Inactive' ? 'Inactive' : 'Active',
      tenantId: 'tenant_default',
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing().run();
    existingDirectory.add(corporateUsername);
    seededDirectoryCount++;
  }
  if (seededDirectoryCount > 0) {
    logger.info({ seededDirectoryUsers: seededDirectoryCount }, 'Seeded user directory (corporate → EKOS mapping)');
  }

  if (isFirstSeed) logger.info('Database seeding successfully completed.');
}
