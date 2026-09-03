/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { db } from "../../db/db.ts";
import { kbDocuments, kbDocumentVersions, kbDocumentChunks } from "../../db/schema.ts";
import { eq, like } from "drizzle-orm";
import { buildChunkRows } from "../chunking.ts";
import { requireUser, requireAction } from "../middleware/auth.ts";
import { asyncHandler, badRequest, forbidden, notFound } from "../middleware/errors.ts";
import { validate } from "../middleware/validate.ts";
import {
  DocumentCreateSchema,
  DocumentPatchSchema,
  DocumentsQuerySchema,
  GovernanceDecisionSchema,
} from "../schemas/apiSchemas.ts";
import { canPerformGovernanceAction, canAccessTab } from "../../utils/rbac.ts";

// Every route below requires a recognized caller identity; create/delete
// additionally require the "upload_kb" permission. See
// src/server/middleware/auth.ts for what this does and does not guarantee.
// Request shapes are validated by src/server/schemas/apiSchemas.ts before a
// handler runs, and every failure is rendered by the central error middleware
// (src/server/middleware/errors.ts) — handlers throw instead of hand-building
// an envelope.
export const router = express.Router();
router.use('/api', requireUser);

// Parse a raw kb_documents row back into the client-facing shape: departmentIds
// is stored as JSON text, so every response (GET/PATCH/decision) must parse it
// to a string[] or the client's departmentIds.map/.includes will crash.
function parseDocRow(row: any) {
  if (!row) return row;
  let departmentIds: string[] = [];
  try { departmentIds = row.departmentIds ? JSON.parse(row.departmentIds) : []; } catch { departmentIds = []; }
  return { ...row, departmentIds };
}

// Structured minor-version bump (avoids parseFloat pitfalls like 1.9 -> 2.0 /
// 1.10 -> 1.1): "1.0" -> "1.1", "1.9" -> "1.10".
function bumpVersion(v?: string | null): string {
  const [maj, min] = String(v || "1.0").split(".");
  const M = parseInt(maj, 10) || 1;
  const m = parseInt(min, 10) || 0;
  return `${M}.${m + 1}`;
}

// A. Documents Endpoints
router.get(
  "/api/db/documents",
  validate({ query: DocumentsQuerySchema }),
  asyncHandler(async (req, res) => {
    // limit/offset arrive already parsed and clamped (1–1000 / >=0) — see
    // DocumentsQuerySchema, which preserves the previous "correct, don't reject"
    // behavior for an out-of-range page.
    const { brandId, departmentId, limit, offset } = req.valid!.query;
    const user = req.user!; // requireUser (router-wide) guarantees this
    // Exclude soft-deleted rows (deleted_at set) — a deleted document must not
    // resurface in the library. The row is kept (not hard-deleted) so the
    // boot-time seeder doesn't re-insert it; see the DELETE route below.
    const rawDocumentsList = db.select().from(kbDocuments).all().filter(d => !d.deletedAt);

    // Parse departmentIds back into a real array — SQLite stores it as JSON text.
    const documentsList = rawDocumentsList.map(d => ({
      ...d,
      departmentIds: (() => {
        try { return d.departmentIds ? JSON.parse(d.departmentIds as unknown as string) : []; }
        catch { return []; }
      })()
    }));

    // SECURITY: enforce the caller's OWN brand/department scope server-side, so a
    // scoped user can never read another brand's/department's documents (incl.
    // content) just by omitting the client filter params. A user sees: any
    // global-scope doc, plus brand/department-specific docs that intersect their
    // own brandIds/departmentIds. '*' means all (no restriction on that axis).
    // The client-supplied brandId/departmentId below can only NARROW this
    // allowed set, never widen it.
    const userBrands = user.brandIds || [];
    const userDepts = user.departmentIds || [];
    const brandUnrestricted = userBrands.includes("*");
    const deptUnrestricted = userDepts.includes("*");
    const inUserScope = documentsList.filter(d => {
      const brandOk = brandUnrestricted || d.scope === "global" || (!!d.brandId && userBrands.includes(d.brandId));
      const deptOk = deptUnrestricted || d.departmentScope === "global" || (d.departmentIds || []).some((id: string) => userDepts.includes(id));
      return brandOk && deptOk;
    });

    let filtered = inUserScope;
    if (brandId) {
      filtered = filtered.filter(d => d.scope === "global" || d.brandId === brandId);
    }
    if (departmentId) {
      filtered = filtered.filter(d =>
        d.departmentScope === "global" ||
        (d.departmentIds || []).includes(departmentId)
      );
    }

    // Counts/categories reflect what the caller may actually see, not the raw table.
    const categories = Array.from(new Set(inUserScope.map(d => d.category || "Operations Manual")));

    // Bounded page instead of always returning the full filtered set — see
    // docs/KNOWN_LIMITATIONS.md's "Chunk-Based Document Loading" item. Offset
    // is applied after brand/department filtering, so pages are relative to
    // what the caller actually asked for, not the raw table.
    const page = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;

    return res.json({
      success: true,
      data: {
        documents: page,
        totalCount: inUserScope.length,
        filteredCount: filtered.length,
        availableCategories: categories,
        hasMore,
        nextOffset: hasMore ? offset + limit : null
      }
    });
  })
);

router.post(
  "/api/db/documents",
  requireAction("upload_kb"),
  validate({ body: DocumentCreateSchema }),
  asyncHandler(async (req, res) => {
    const document = req.body;
    const user = req.user!; // requireUser (router-wide) guarantees this

    // A create must not be a governance-queue bypass. Only a governance-tab role
    // (Administrator/LocationManager) may set an explicit approvalStatus;
    // everyone else with upload_kb (e.g. TeamLeader) creates documents as 'Under
    // Review'. Previously the raw client value was trusted, letting a
    // non-governance uploader create a doc as 'Approved' that immediately
    // grounded retrieval and wore a verified badge without review. (The value's
    // vocabulary is checked by DocumentCreateSchema; this decides who may set it.)
    const canDecideGovernance = canAccessTab(user.role, user.departmentIds || [], "governance");
    const approvalStatus = canDecideGovernance && document.approvalStatus !== undefined
      ? document.approvalStatus
      : "Under Review";

    const now = new Date().toISOString();
    const enriched = {
      id: document.id || `doc_${Math.random().toString(36).substring(2, 11)}`,
      name: document.name,
      type: document.type,
      status: document.status || "trained",
      scope: document.scope || "global",
      brandId: document.brandId || null,
      category: document.category || "Operations Manual",
      isImportant: document.isImportant || false,
      content: document.content || "",
      uploadedAt: document.uploadedAt || now,
      uploadedBy: document.uploadedBy || "system",
      owner: document.owner || "Customer Service Operations",
      department: document.department || "Operations",
      departmentScope: document.departmentScope || "global",
      departmentIds: document.departmentIds ? JSON.stringify(document.departmentIds) : "[]",
      reviewFrequency: "Every 90 days",
      expirationDate: "2026-12-31",
      // Governance-gated above: 'Under Review' for a normal uploader, or the
      // validated value a governance-tab role explicitly set.
      approvalStatus,
      version: "1.0",
      lastReviewDate: now.split("T")[0],
      viewsCount: 1,
      ratingUp: 0,
      ratingDown: 0,
      tenantId: "tenant_default",
      createdAt: now,
      updatedAt: now
    };

    // Insert the document, its initial version, and its chunk atomically — a
    // partial failure must never leave a live-but-inconsistent document row.
    const versionId = `ver_${enriched.id}_1_0`.replace(/\./g, "_");
    db.transaction((tx) => {
      tx.insert(kbDocuments).values(enriched).run();
      tx.insert(kbDocumentVersions).values({
        id: versionId,
        documentId: enriched.id,
        version: "1.0",
        content: enriched.content,
        changeSummary: "Initial upload",
        createdBy: enriched.uploadedBy,
        tenantId: "tenant_default",
        createdAt: now,
        updatedAt: now
      }).run();
      for (const chunk of buildChunkRows(enriched.id, versionId, enriched.content, now)) {
        tx.insert(kbDocumentChunks).values(chunk).run();
      }
    });

    return res.json({
      success: true,
      data: {
        document: parseDocRow(enriched), // departmentIds back to string[] to match GET/PATCH
        ingestionJobId: `job_${Math.random().toString(36).substring(2, 11)}`
      }
    });
  })
);

// Partial update of a document. Three permission tiers flow through here:
//   1. Governance decision (approvalStatus) — governance-queue roles only
//      (Administrator/LocationManager via canAccessTab('governance')), matching
//      the /governance-decision route. NOT upload_kb (that includes TeamLeader).
//      The assigned owner must NOT be able to self-approve.
//   2. Content body (content) — KB managers OR the document's assigned
//      responsible owner (ownerId === caller), so a responsible person can
//      maintain their own document's text in the app.
//   3. Classification & assignment (owner, ownerId, category, department,
//      departmentScope, departmentIds, scope, brandId, version, lastReviewDate)
//      — KB managers only; this is how a wrongly-"global" doc gets re-scoped and
//      its department/owner reassigned.
// Only DocumentPatchSchema's fields are writable; anything else in the body is
// ignored. Authorization is enforced per-tier below rather than with a blanket
// route middleware, since the tiers have different permission bars — and the
// schema deliberately validates only shape, never who may write what.
router.patch(
  "/api/db/documents/:id",
  validate({ body: DocumentPatchSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    const user = req.user!; // requireUser (router-wide) guarantees this

    const existing = db.select().from(kbDocuments).where(eq(kbDocuments.id, id)).all()[0];
    if (!existing) {
      throw notFound(`Document "${id}" not found`);
    }

    const canManageKB = canPerformGovernanceAction(user.role, user.departmentIds || [], "upload_kb");
    // Approve/ban is a governance-queue decision — must match who may act on the
    // queue (Administrator / Location Manager), NOT the broader upload_kb (which
    // includes TeamLeader). This keeps this PATCH path in lockstep with the
    // /governance-decision route; gating it on upload_kb previously let a
    // TeamLeader approve/ban directly despite being kept out of the governance area.
    const canDecideGovernance = canAccessTab(user.role, user.departmentIds || [], "governance");
    const isOwner = !!existing.ownerId && existing.ownerId === user.id;

    const patch: Record<string, unknown> = {};

    // Tier 1 — governance decision (approvalStatus): Administrator / LocationManager only.
    if (body.approvalStatus !== undefined) {
      if (!canDecideGovernance) {
        throw forbidden(`Role "${user.role}" is not permitted to change a document's approval status`);
      }
      patch.approvalStatus = body.approvalStatus;
    }

    // Tier 2 — content body: the assigned responsible owner OR a KB manager.
    if (body.content !== undefined) {
      if (!canManageKB && !isOwner) {
        throw forbidden("Only the document's responsible owner or a knowledge-base manager can edit its content");
      }
      patch.content = body.content;
    }

    // Tier 3 — classification & assignment (department/region/owner/category):
    // KB managers only (Administrator / Team Leader / Location Manager). This is
    // where a wrongly-"global" document gets re-scoped and its owner/department
    // reassigned.
    const CLASSIFICATION_FIELDS = ["owner", "ownerId", "category", "department", "departmentScope", "departmentIds", "scope", "brandId", "version", "lastReviewDate"];
    const editsClassification = CLASSIFICATION_FIELDS.some((f) => body[f] !== undefined);
    if (editsClassification) {
      if (!canManageKB) {
        throw forbidden("Only a knowledge-base manager (Administrator, Team Leader or Location Manager) can change a document's department, region, owner or category");
      }
      // departmentIds is the one field whose column shape differs from the wire
      // shape: string[] in, JSON text out.
      if (body.departmentIds !== undefined) {
        patch.departmentIds = JSON.stringify(body.departmentIds);
      }
      for (const f of ["owner", "ownerId", "brandId", "category", "department", "departmentScope", "scope", "version", "lastReviewDate"]) {
        if (body[f] === undefined) continue;
        patch[f] = body[f];
      }
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest("No writable fields supplied");
    }

    const now = new Date().toISOString();
    patch.updatedAt = now;

    // A content edit re-versions the document and sends it back for review
    // (unless the same request explicitly sets a status — a manager re-approving
    // inline). Never leave Approved grounding text silently overwritten, and keep
    // the version/chunk history in step. Done in one transaction.
    const contentChanged = body.content !== undefined;
    if (contentChanged) {
      patch.version = bumpVersion(existing.version);
      if (body.approvalStatus === undefined) patch.approvalStatus = "Under Review";
    }

    db.transaction((tx) => {
      tx.update(kbDocuments).set(patch).where(eq(kbDocuments.id, id)).run();
      if (contentChanged) {
        const versionId = `ver_${id}_${patch.version}`.replace(/\./g, "_");
        tx.insert(kbDocumentVersions).values({
          id: versionId,
          documentId: id,
          version: patch.version as string,
          content: body.content,
          changeSummary: "In-app content edit",
          createdBy: user.id,
          tenantId: "tenant_default",
          createdAt: now,
          updatedAt: now,
        }).run();
        // Retire the previous version's chunks before indexing the new ones.
        // Retrieval now reads chunks directly, so leaving them behind would keep
        // superseded text searchable — and citable — forever. The LIKE clause
        // also catches legacy rows that predate documentId being populated.
        tx.delete(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, id)).run();
        tx.delete(kbDocumentChunks).where(like(kbDocumentChunks.id, `chunk_${id}_%`)).run();
        for (const chunk of buildChunkRows(id, versionId, body.content, now)) {
          tx.insert(kbDocumentChunks).values(chunk).run();
        }
      }
    });

    const updated = db.select().from(kbDocuments).where(eq(kbDocuments.id, id)).all()[0];
    return res.json({ success: true, data: { document: parseDocRow(updated) } });
  })
);

// Governance decision on a document BY NAME (approve / needs-fix / ban). The
// review queue joins tasks to documents by name, and the client only holds a
// paginated/brand-scoped page — so resolving the target here, server-side,
// fixes the bug where approving/banning a doc that wasn't on the loaded page
// silently did nothing while the task was marked resolved. Gated to the roles
// that may act on the governance queue (Administrator / Location Manager),
// matching canAccessTab('governance') — NOT the broader upload_kb.
router.post(
  "/api/db/documents/governance-decision",
  validate({ body: GovernanceDecisionSchema }),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (!canAccessTab(user.role, user.departmentIds || [], "governance")) {
      throw forbidden(`Role "${user.role}" is not permitted to make governance decisions on documents`);
    }
    const { documentName, decision } = req.body;

    const now = new Date().toISOString();
    const today = now.split("T")[0];
    const targets = db.select().from(kbDocuments).where(eq(kbDocuments.name, documentName)).all()
      .filter((d: any) => !d.deletedAt);

    // A governance decision is a status transition, NOT a content revision — so
    // it must NOT bump the version (that would advertise a version with no
    // matching kb_document_versions history row; content revisions bump+record
    // in the PATCH content path instead). All matched rows update atomically.
    db.transaction((tx) => {
      for (const doc of targets) {
        const patch: Record<string, unknown> = { updatedAt: now };
        if (decision === "approved") {
          patch.approvalStatus = "Approved";
          patch.lastReviewDate = today;
        } else if (decision === "rejected") {
          patch.approvalStatus = "Under Review";
        } else {
          patch.approvalStatus = "Banned";
        }
        tx.update(kbDocuments).set(patch).where(eq(kbDocuments.id, doc.id)).run();
      }
    });

    const refreshed = db.select().from(kbDocuments).where(eq(kbDocuments.name, documentName)).all()
      .filter((d: any) => !d.deletedAt)
      .map(parseDocRow);
    return res.json({ success: true, data: { updated: targets.length, documents: refreshed } });
  })
);

router.delete(
  "/api/db/documents/:id",
  requireAction("upload_kb"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    // SOFT delete: flag deleted_at instead of removing the row. A hard delete
    // let the boot-time seeder re-insert the document on the next restart (it
    // re-adds any INITIAL_KB_DOCS id not present in the table), so deletions
    // "came back". Keeping the flagged row means its id still exists, the
    // seeder skips it, and the deletion sticks. GET filters these out.
    const existing = db.select().from(kbDocuments).where(eq(kbDocuments.id, id)).all()[0];
    if (!existing) {
      throw notFound(`Document "${id}" not found`);
    }
    const now = new Date().toISOString();
    db.update(kbDocuments).set({ deletedAt: now, updatedAt: now }).where(eq(kbDocuments.id, id)).run();
    return res.json({
      success: true,
      data: {
        documentId: id,
        deleted: true
      }
    });
  })
);
