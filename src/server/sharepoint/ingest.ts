/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Upserts crawled SharePoint documents into the relational KB tables.
 * Shared by the live Graph sync route; mirrors what src/db/seed.ts does for the
 * offline snapshot so both ingestion paths produce identical rows.
 */

import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '../../db/db.ts';
import { kbDocuments, kbDocumentVersions, kbDocumentChunks } from '../../db/schema.ts';
import { buildChunkRows } from '../chunking.ts';
import { mapRawDocToKbDocument, type RawSharePointDoc } from '../../constants/kbMapping.ts';

export interface IngestResult {
  total: number;
  inserted: number;
  updated: number;
  /** Crawled docs skipped because their body was empty after extraction. */
  skippedEmpty: number;
  /**
   * Crawled docs skipped because another file in the SAME crawl carries
   * byte-identical content (see pickCanonicalDuplicates) — the same document
   * indexed twice under two names. 0 when the crawl holds no duplicates.
   */
  skippedDuplicate: number;
  /**
   * Previously-synced documents that are no longer present in SharePoint and
   * were soft-deleted (tombstoned) by this run. 0 when tombstoning is disabled.
   */
  tombstoned: number;
}

export interface UpsertOptions {
  /**
   * Soft-delete previously-synced documents that the crawl did NOT return —
   * i.e. files deleted or archived in SharePoint. Without this, an orphaned
   * document lives on in the KB and keeps grounding answers forever.
   *
   * Only pass true for a COMPLETE crawl. A partial view (the SP_MAX_FILES cap
   * was hit, an excluded folder, a failed subtree) would otherwise tombstone
   * documents that still exist, silently deleting the knowledge base.
   */
  tombstoneMissing?: boolean;
}

/**
 * Rebuild the sync-owned version + chunk rows so the indexed content matches
 * the latest crawl. Called on insert, and on update only when the crawled
 * content actually changed.
 */
function rebuildSyncVersionAndChunk(
  tx: any,
  docId: string,
  content: string,
  now: string,
  isRefresh: boolean
): void {
  const versionId = `ver_${docId}_1_0`;
  // Delete by the deterministic PKs we are about to re-insert — NOT only by
  // document_id. The seeded chunk/version rows share these exact ids but were
  // seeded with a NULL document_id, so a document_id-keyed delete matched
  // nothing and the re-insert then collided on the PK (UNIQUE constraint
  // failed), rolling back the entire crawl. Also clear any rows still keyed on
  // document_id (populated on the upload/ingest paths) so no stragglers remain.
  // `${versionId}_c%` covers the multi-chunk ids from buildChunkRows() and
  // `chunk_<docId>_0` the pre-chunking single-row scheme.
  tx.delete(kbDocumentChunks).where(eq(kbDocumentChunks.id, `chunk_${docId}_0`)).run();
  tx.delete(kbDocumentChunks).where(like(kbDocumentChunks.id, `${versionId}_c%`)).run();
  tx.delete(kbDocumentVersions).where(eq(kbDocumentVersions.id, versionId)).run();
  tx.delete(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, docId)).run();
  tx.delete(kbDocumentVersions).where(eq(kbDocumentVersions.documentId, docId)).run();
  tx.insert(kbDocumentVersions).values({
    id: versionId,
    documentId: docId,
    version: '1.0',
    content,
    changeSummary: isRefresh ? 'Refreshed from SharePoint sync.' : 'Initial SharePoint sync.',
    createdBy: 'sharepoint-sync',
    tenantId: 'tenant_default',
    createdAt: now,
    updatedAt: now,
  }).run();
  const chunks = buildChunkRows(docId, versionId, content, now);
  for (const chunk of chunks) {
    tx.insert(kbDocumentChunks).values(chunk).run();
  }
}

/**
 * Content fingerprint used to recognize the SAME document crawled twice under
 * two different names.
 *
 * Whitespace-collapsed and lower-cased before hashing: the observed duplicates
 * differ only by a trailing newline (SharePoint's 8.3 short name and its long
 * name are two index entries for one file), and a byte-exact hash would miss
 * them. Deliberately no fuzzier than that — two documents that genuinely differ
 * in wording are two documents, and merging them would destroy content.
 */
function contentFingerprint(content: string): string {
  return createHash('sha256').update(content.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
}

/**
 * Given the crawl's mapped documents, decide which id to keep for each set of
 * content-identical files, and return the ids to SKIP.
 *
 * Why this exists: the SharePoint index can return one file twice — once under
 * its real name and once under the 8.3 short name (TOTP_C~1.MD alongside
 * TOTP_Configuration_Aurora.md). Each carries its own item id, so both became
 * independent kb_documents rows with the same text. Retrieval then ranked both,
 * and deleting one left the other answering identically — indistinguishable,
 * to the user, from a delete that did not stick.
 *
 * The winner is chosen from the NAME, not from crawl order, so the result is
 * stable across runs: a real name beats an 8.3-mangled one, then the more
 * descriptive (longer) name wins, and the id breaks any remaining tie.
 *
 * Skipped ids are simply absent from `seenIds`, so on a COMPLETE crawl the
 * existing tombstone pass soft-deletes the losing twin — the duplicate is
 * cleaned out of an already-populated KB, not merely kept out of a fresh one.
 */
function pickDuplicateIdsToSkip(mapped: Array<{ id: string; name: string; content: string }>): Set<string> {
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const { id, name, content } of mapped) {
    const fp = contentFingerprint(content);
    const group = groups.get(fp);
    if (group) group.push({ id, name }); else groups.set(fp, [{ id, name }]);
  }

  const isShortName = (name: string) => /~\d/.test(name);
  const skip = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [canonical] = [...group].sort((a, b) => {
      const aShort = isShortName(a.name), bShort = isShortName(b.name);
      if (aShort !== bShort) return aShort ? 1 : -1;
      if (a.name.length !== b.name.length) return b.name.length - a.name.length;
      return a.id < b.id ? -1 : 1;
    });
    for (const entry of group) if (entry.id !== canonical.id) skip.add(entry.id);
  }
  return skip;
}

/**
 * Insert or update kb_documents (+ their version and chunk rows) from a set of
 * crawled files. Keyed on the "sp_<itemId>" document id, so re-running is
 * idempotent: unchanged files stay put, edited files get refreshed content.
 */
export function upsertKbDocuments(
  rawDocs: RawSharePointDoc[],
  crawledAt?: string,
  options: UpsertOptions = {}
): IngestResult {
  const now = new Date().toISOString();
  const stamp = crawledAt || now;
  let inserted = 0;
  let updated = 0;
  let skippedEmpty = 0;
  let skippedDuplicate = 0;
  let tombstoned = 0;
  const seenIds = new Set<string>();

  // Map once, up front: the duplicate pass needs every document's final content
  // (frontmatter already stripped) before the first row is written.
  const mapped = rawDocs.map((raw) => mapRawDocToKbDocument(raw, stamp));
  const duplicateIds = pickDuplicateIdsToSkip(
    mapped.map((doc) => ({ id: doc.id, name: doc.name, content: doc.content || '' }))
  );

  db.transaction((tx) => {
    for (const doc of mapped) {
      const content = doc.content || '';
      // Skip empty files — they only dilute grounding.
      if (content.trim().length === 0) { skippedEmpty++; continue; }
      // Skip the losing twin of a content-identical pair. NOT added to seenIds,
      // so a complete crawl tombstones it if it is already in the KB.
      if (duplicateIds.has(doc.id)) { skippedDuplicate++; continue; }
      seenIds.add(doc.id);

      const existing = tx.select().from(kbDocuments).where(eq(kbDocuments.id, doc.id)).all()[0];

      if (existing) {
        // A re-sync must refresh ONLY content-derived fields and must NEVER
        // reset in-app governance/user state. Previously it overwrote the whole
        // row, so every 6-hour sync silently un-banned banned docs, reset
        // approvalStatus to 'Approved', wiped departmentIds/brandId/owner and
        // zeroed ratings/views. Governance decisions and edits are authoritative
        // over the crawl and are preserved here.
        const contentChanged = (existing.content || '').trim() !== content.trim();
        const wasBanned = existing.approvalStatus === 'Banned';
        // A banned document stays banned. Otherwise a genuine content change
        // drops it back to 'Under Review' for re-approval; unchanged content
        // keeps whatever status governance already assigned.
        const nextApprovalStatus = wasBanned
          ? 'Banned'
          : (contentChanged ? 'Under Review' : existing.approvalStatus);

        tx.update(kbDocuments).set({
          // content-derived fields refreshed from the crawl
          name: doc.name,
          type: doc.type,
          status: doc.status,
          scope: doc.scope,
          content,
          approvalStatus: nextApprovalStatus,
          updatedAt: now,
        }).where(eq(kbDocuments.id, doc.id)).run();
        updated++;

        // Only re-index (rebuild the sync-owned version + chunk) when the
        // crawled content actually changed — avoids churn and, when unchanged,
        // leaves any in-app version history untouched.
        if (contentChanged) {
          rebuildSyncVersionAndChunk(tx, doc.id, content, now, true);
        }
      } else {
        const row = {
          id: doc.id,
          name: doc.name,
          type: doc.type,
          status: doc.status,
          scope: doc.scope,
          brandId: doc.brandId || null,
          category: doc.category || 'Operations Manual',
          isImportant: doc.isImportant || false,
          content,
          uploadedAt: doc.uploadedAt,
          uploadedBy: doc.uploadedBy,
          owner: doc.owner || 'Customer Service Operations',
          department: doc.department || 'Operations',
          departmentScope: doc.departmentScope || 'global',
          departmentIds: doc.departmentIds ? JSON.stringify(doc.departmentIds) : '[]',
          reviewFrequency: doc.reviewFrequency || 'Every 90 days',
          expirationDate: doc.expirationDate || '2026-12-31',
          approvalStatus: doc.approvalStatus || 'Approved',
          version: doc.version || '1.0',
          lastReviewDate: doc.lastReviewDate || stamp.split('T')[0],
          viewsCount: doc.viewsCount || 0,
          ratingUp: doc.ratingUp || 0,
          ratingDown: doc.ratingDown || 0,
          tenantId: 'tenant_default',
          updatedAt: now,
        };
        tx.insert(kbDocuments).values({ ...row, createdAt: now }).run();
        inserted++;
        rebuildSyncVersionAndChunk(tx, doc.id, content, now, false);
      }
    }

    // Reconciliation: a file deleted or archived in SharePoint used to linger in
    // the KB forever and keep grounding answers (an orphan the crawl can never
    // correct, because a crawl only ever adds/updates what it finds). Tombstone
    // = soft-delete, so the row is retained (governance history, and the boot
    // seeder won't re-insert it) while every read path, aggregate and grounding
    // predicate already treats deletedAt as gone.
    //
    // Guarded by the caller: only a COMPLETE crawl may tombstone. Sync-owned
    // documents are identified by the 'sp_' id prefix, so in-app uploads and the
    // other snapshot's rm_ documents are never touched.
    if (options.tombstoneMissing) {
      const syncOwned = tx.select().from(kbDocuments).all()
        .filter((d: any) => typeof d.id === 'string' && d.id.startsWith('sp_') && !d.deletedAt);
      for (const row of syncOwned) {
        if (seenIds.has(row.id)) continue;
        tx.update(kbDocuments)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(kbDocuments.id, row.id))
          .run();
        tombstoned++;
      }
    }
  });

  return { total: inserted + updated, inserted, updated, skippedEmpty, skippedDuplicate, tombstoned };
}
