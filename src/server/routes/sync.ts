/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/db.ts";
import { kbSyncJobs, kbSources, kbDocuments } from "../../db/schema.ts";
import { requireUser, requireTab } from "../middleware/auth.ts";
import { asyncHandler, badRequest } from "../middleware/errors.ts";
import { validate } from "../middleware/validate.ts";
import { logger } from "../logger.ts";
import { SyncRunSchema } from "../schemas/apiSchemas.ts";
import { getGraphConfig, crawlKnowledgeBase } from "../sharepoint/graphClient.ts";
import { upsertKbDocuments } from "../sharepoint/ingest.ts";
import { backfillEmbeddings, embeddingCoverage } from "../vectorStore.ts";

// The "sync" tab is restricted to Administrator/IT in rbac.ts — mirrored
// here so a caller can't reach sync data/actions by skipping the UI. See
// src/server/middleware/auth.ts for what this does and does not guarantee.
export const router = express.Router();
router.use('/api', requireUser);

// C. Sync Log Endpoints
router.get("/api/db/sync/status", requireTab("sync"), asyncHandler(async (_req, res) => {
  const jobs = db.select().from(kbSyncJobs).all();
  // Job ids are random (log_<rand>), so ordering by id is arbitrary. Sort by
  // createdAt so "recent syncs" is genuinely newest-first.
  const sortedJobs = jobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  // Real index telemetry (previously hardcoded 99.8 / 142500, which
  // misrepresented a ~200-doc KB as a 142k-key index). Derive it from what
  // retrieval actually uses — kb_documents.content — NOT the chunk table
  // (chunks are a sparse secondary structure here and would report a
  // misleading ~1%). A document is "indexed" when it has non-empty content:
  //   totalIndexedKeys = documents with indexable content
  //   indexIntegrity   = % of documents that are indexable
  // Exclude soft-deleted rows so telemetry reflects the live corpus (the
  // library GET and retrieval both treat deletedAt as gone).
  const allDocs = db.select().from(kbDocuments).all().filter((d: any) => !d.deletedAt);
  const indexedDocs = allDocs.filter((d) => (d.content || '').trim().length > 0).length;
  const indexIntegrity = allDocs.length > 0
    ? Math.round((indexedDocs / allDocs.length) * 1000) / 10
    : 100;

  return res.json({
    success: true,
    data: {
      syncLogs: sortedJobs.map(job => ({
        id: job.id,
        sourceId: job.sourceId,
        sourceName: job.sourceName,
        type: job.type,
        recordsProcessed: job.recordsProcessed,
        duration: job.duration,
        status: job.status,
        endTime: job.endTime || ""
      })),
      indexIntegrity,
      totalIndexedKeys: indexedDocs,
      scheduledInterval: "Every 6h",
      nextScheduledSync: "2026-06-24 12:00:00 UTC",
      isSyncing: false
    }
  });
}));

router.post(
  "/api/db/sync/run",
  requireTab("sync"),
  validate({ body: SyncRunSchema }),
  asyncHandler(async (req, res) => {
    const { sourceId, sourceName, type, recordsProcessed, duration, status, endTime } = req.body;
    const now = new Date().toISOString();
    const jobId = `log_${Math.random().toString(36).substring(2, 11)}`;

    // kb_sync_jobs.source_id is a NOT NULL FK to kb_sources.id (FK enforcement
    // is ON). The old default 'src_1' does not exist in a seeded DB, so every
    // default call threw 'FOREIGN KEY constraint failed' → 500. Resolve to the
    // real source and reject an unknown id with a clear 400 instead.
    const resolvedSourceId = sourceId || "src_sharepoint_kb";
    const sourceExists = db.select().from(kbSources).where(eq(kbSources.id, resolvedSourceId)).all()[0];
    if (!sourceExists) {
      throw badRequest(`Unknown sourceId '${resolvedSourceId}' — no matching knowledge source exists.`);
    }

    db.insert(kbSyncJobs).values({
      id: jobId,
      sourceId: resolvedSourceId,
      sourceName: sourceName || sourceExists.name || "Knowledge Base",
      type: type || "Incremental Delta Sync",
      recordsProcessed: recordsProcessed || 0,
      duration: duration || "10s",
      status: status || "Completed",
      endTime: endTime || now,
      tenantId: "tenant_default",
      createdAt: now,
      updatedAt: now
    }).run();

    return res.json({
      success: true,
      data: {
        jobId,
        status: "Started",
        estimatedDurationMs: 2500
      }
    });
  })
);

// D. Live SharePoint Knowledge Base sync (Microsoft Graph).
// Reports whether the Graph app credentials are configured, and — when they
// are — crawls the SharePoint library and upserts every document into the KB.
// Until SP_* env vars are set, the app runs on the ingested snapshot and this
// endpoint returns configured:false instead of failing. See
// docs/SHAREPOINT_SYNC.md and src/server/sharepoint/graphClient.ts.
router.get("/api/db/sync/sharepoint/status", requireTab("sync"), asyncHandler(async (_req, res) => {
  const cfg = getGraphConfig();
  return res.json({
    success: true,
    data: {
      configured: cfg !== null,
      driveId: cfg?.driveId ?? null,
      rootFolderId: cfg?.rootFolderId ?? null,
      excludeFolders: cfg?.excludeFolders ?? [],
      message: cfg
        ? "Live SharePoint sync is configured."
        : "Live SharePoint sync is not configured. Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET, SP_DRIVE_ID and SP_ROOT_FOLDER_ID to enable it. The knowledge base currently runs on the ingested snapshot."
    }
  });
}));

router.post("/api/db/sync/sharepoint", requireTab("sync"), asyncHandler(async (req, res) => {
  const cfg = getGraphConfig();
  if (!cfg) {
    // Deliberately 200: "not configured" is a state the Sync board renders, not a
    // failed request. The envelope matches every other failure shape so a caller
    // reads error.code/error.message the same way everywhere.
    return res.status(200).json({
      success: false,
      configured: false,
      error: {
        code: "ERR_SHAREPOINT_NOT_CONFIGURED",
        message: "Live SharePoint sync is not configured. Set the SP_* environment variables (see docs/SHAREPOINT_SYNC.md) to enable it. The knowledge base is currently served from the ingested snapshot."
      }
    });
  }

  const startedAt = Date.now();
  // Claim the run in the log BEFORE crawling. The log previously only ever
  // gained a row at the END, so a crawl that was in flight — or that died
  // without reaching the catch (process restart, timeout, OOM) — left no trace
  // at all, and the Sync board looked idle while a sync was running.
  const jobId = `log_${Math.random().toString(36).substring(2, 11)}`;
  const startedIso = new Date().toISOString();
  try {
    db.insert(kbSyncJobs).values({
      id: jobId,
      sourceId: "src_sharepoint_kb",
      sourceName: "SharePoint — Knowledge Base",
      type: "SharePoint Graph Sync",
      recordsProcessed: 0,
      duration: "—",
      status: "Started",
      endTime: null,
      tenantId: "tenant_default",
      createdAt: startedIso,
      updatedAt: startedIso
    }).run();
  } catch (logErr) {
    logger.error({ err: logErr, jobId }, "Failed to write the in-progress SharePoint sync row");
  }

  try {
    const crawl = await crawlKnowledgeBase(cfg);
    const crawledAt = new Date().toISOString();
    // Only reconcile deletions when the crawl saw the WHOLE library: a capped or
    // partially-failed crawl is not evidence that a missing document is gone.
    const isCompleteView = !crawl.capped && crawl.failed === 0;
    const result = upsertKbDocuments(crawl.docs, crawledAt, { tombstoneMissing: isCompleteView });

    // Vectorize what the crawl just wrote. Without this every newly synced
    // document sits at future_embedding_status='pending' and is reachable only
    // by lexical matching until somebody remembers to call the backfill by
    // hand — so semantic coverage decays silently after each sync while the
    // status endpoint still reports the mode as 'hybrid'.
    //
    // Deliberately non-fatal: the documents ARE ingested and answerable either
    // way, so an embedding provider being down must not fail the sync. It is
    // reported instead, and the coverage numbers make a shortfall visible.
    let embedding: { embedded: number; failed: number; pending: number; skippedReason?: string; coverage?: unknown } | undefined;
    if (process.env.EMBED_AFTER_SYNC !== 'false') {
      try {
        const backfill = await backfillEmbeddings({ limit: 5_000 });
        embedding = { ...backfill, coverage: embeddingCoverage() };
        const cov = embeddingCoverage();
        if (backfill.skippedReason) {
          logger.warn({ jobId, reason: backfill.skippedReason }, 'Sync: embeddings skipped');
        } else if (cov.embedded < cov.total) {
          logger.warn({ jobId, embedded: cov.embedded, total: cov.total }, 'Sync: incomplete embedding coverage — run POST /api/embeddings/backfill');
        }
      } catch (embedErr: any) {
        logger.error({ err: embedErr, jobId }, 'Sync: embedding backfill failed');
        embedding = { embedded: 0, failed: 0, pending: 0, skippedReason: embedErr?.message || 'Embedding backfill failed.' };
      }
    }

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    const now = new Date().toISOString();

    // Warning (not Completed) when the run could not see or read everything —
    // the operator must be able to tell a clean sync from a partial one.
    const finalStatus = crawl.capped || crawl.failed > 0 ? "Warning" : "Completed";

    db.update(kbSyncJobs).set({
      recordsProcessed: result.total,
      duration: `${durationSec}s`,
      status: finalStatus,
      endTime: now,
      updatedAt: now
    }).where(eq(kbSyncJobs.id, jobId)).run();

    return res.json({
      success: true,
      configured: true,
      data: {
        ...result,
        durationSec: Number(durationSec),
        filesCrawled: crawl.docs.length,
        filesSeen: crawl.filesSeen,
        skippedUnsupportedOrEmpty: crawl.skippedEmpty + result.skippedEmpty,
        failedToExtract: crawl.failed,
        truncated: crawl.truncated,
        capped: crawl.capped,
        reconciled: isCompleteView,
        embedding,
        status: finalStatus
      }
    });
  } catch (e: any) {
    logger.error({ err: e, jobId }, "SharePoint sync failed");
    // Close out the row this run already claimed (see the 'Started' insert
    // above) rather than adding a second row for the same attempt. Never relay
    // the raw upstream error to the client.
    const now = new Date().toISOString();
    try {
      db.update(kbSyncJobs).set({
        duration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        status: "Halted",
        endTime: now,
        updatedAt: now
      }).where(eq(kbSyncJobs.id, jobId)).run();
    } catch (logErr) {
      logger.error({ err: logErr, jobId }, "Failed to close out the SharePoint sync row as Halted");
    }
    return res.status(500).json({
      success: false,
      configured: true,
      error: {
        code: "ERR_SHAREPOINT_SYNC_FAILED",
        message: "SharePoint sync failed. See server logs for details."
      },
      metadata: { timestamp: now, requestId: req.id ?? null }
    });
  }
}));
