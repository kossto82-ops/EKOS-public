/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { db } from "../../db/db.ts";
import { kbSources } from "../../db/schema.ts";
import { eq } from "drizzle-orm";
import { requireUser, requireAction } from "../middleware/auth.ts";
import { asyncHandler, notFound } from "../middleware/errors.ts";
import { validate } from "../middleware/validate.ts";
import { SourceStatusSchema, SourcesUpsertSchema } from "../schemas/apiSchemas.ts";

// The "sources" tab is open to every role client-side (see rbac.ts), so
// these routes only require a recognized caller identity, not a specific
// role. See src/server/middleware/auth.ts for what this does and does not
// guarantee.
export const router = express.Router();
router.use('/api', requireUser);

// B. Knowledge Sources Endpoints
router.get("/api/db/sources", asyncHandler(async (_req, res) => {
  const sourcesList = db.select().from(kbSources).all();
  const mappedSources = sourcesList.map(src => {
    let configObj = {};
    try {
      configObj = JSON.parse(src.config || "{}");
    } catch {}
    return {
      id: src.id,
      name: src.name,
      type: src.type,
      status: (src.status === "active" ? "healthy" : src.status === "syncing" ? "syncing" : src.status === "warning" ? "warning" : "error"),
      lastUpdate: src.lastUpdate || "",
      // The client type/UI expect lastSync; the KB has no separate sync
      // timestamp, so surface lastUpdate as the sync time (a config.lastSync,
      // if ever persisted, still wins via the spread below). Prevents the
      // "Invalid Date" every row showed when lastSync was undefined.
      lastSync: src.lastUpdate || "",
      recordCount: src.recordCount,
      ...configObj
    };
  });
  return res.json({ success: true, data: mappedSources });
}));

router.post(
  "/api/db/sources",
  requireAction("upload_kb"),
  validate({ body: SourcesUpsertSchema }),
  asyncHandler(async (req, res) => {
    const sources = req.body;
    const now = new Date().toISOString();
    // Atomic batch: the loop previously ran one insert/update per source with no
    // transaction, so a failure partway through (bad row, constraint, disk error)
    // left the earlier sources written and the rest not — a half-applied
    // "replace my source list" that the client believes succeeded or failed whole.
    db.transaction((tx) => {
      for (const src of sources) {
        const configKeys = {
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
        };

        // Store 'warning' verbatim instead of collapsing it to 'active' — a
        // source flagged for verification is a governance-relevant state that
        // must round-trip (previously warning→active→healthy silently hid it).
        const dbStatus = src.status === "healthy" ? "active" : src.status === "syncing" ? "syncing" : src.status === "warning" ? "warning" : "inactive";
        const existing = tx.select().from(kbSources).where(eq(kbSources.id, src.id)).all()[0];

        if (existing) {
          tx.update(kbSources).set({
            name: src.name,
            type: src.type,
            status: dbStatus,
            recordCount: src.recordCount || 0,
            lastUpdate: src.lastUpdate || now,
            config: JSON.stringify(configKeys),
            updatedAt: now
          }).where(eq(kbSources.id, src.id)).run();
        } else {
          tx.insert(kbSources).values({
            id: src.id,
            name: src.name,
            type: src.type,
            status: dbStatus,
            recordCount: src.recordCount || 0,
            syncFrequency: "Every 6h",
            lastUpdate: src.lastUpdate || now,
            config: JSON.stringify(configKeys),
            tenantId: "tenant_default",
            createdAt: now,
            updatedAt: now
          }).run();
        }
      }
    });
    return res.json({ success: true });
  })
);

router.post(
  "/api/db/sources/:id/status",
  requireAction("upload_kb"),
  validate({ body: SourceStatusSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const now = new Date().toISOString();
    const dbStatus = status === "healthy" ? "active" : status === "syncing" ? "syncing" : status === "warning" ? "warning" : "inactive";
    db.update(kbSources).set({
      status: dbStatus,
      lastUpdate: now,
      updatedAt: now
    }).where(eq(kbSources.id, id)).run();

    const updated = db.select().from(kbSources).where(eq(kbSources.id, id)).all()[0];
    if (!updated) {
      // Update matched no row — a clean 404 instead of dereferencing undefined
      // below and surfacing an opaque 500.
      throw notFound(`No knowledge source with id '${id}'.`);
    }
    let configObj = {};
    try {
      configObj = JSON.parse(updated.config || "{}");
    } catch {}

    return res.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        status: status,
        lastUpdate: updated.lastUpdate,
        lastSync: updated.lastUpdate || "",
        recordCount: updated.recordCount,
        ...configObj
      }
    });
  })
);
