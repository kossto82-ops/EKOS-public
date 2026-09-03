/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-chunking migration for documents ingested before real chunking existed.
 *
 * Every ingestion path used to write ONE chunk row holding the document's whole
 * body. A corpus ingested under that scheme has chunks up to ~60k characters —
 * far past every embedding provider's per-input limit, so the backfill would
 * fail on them, and semantically useless even if it didn't: one vector for a
 * 60k-character document points at nothing in particular.
 *
 * The new chunker only runs at ingest time, so existing rows need this one-off
 * pass. It is idempotent: a document already chunked to the current scheme is
 * left untouched, which also makes it safe to run after every chunker change.
 */

import { eq, inArray, like, or } from 'drizzle-orm';
import { db } from '../db/db.ts';
import { kbDocuments, kbDocumentChunks, kbDocumentVersions } from '../db/schema.ts';
import { buildChunkRows, type ChunkOptions } from './chunking.ts';
import { invalidateVectorCache } from './vectorStore.ts';

export interface RechunkResult {
  documentsScanned: number;
  documentsRechunked: number;
  chunksBefore: number;
  chunksAfter: number;
  /** Documents skipped because they have no chunk row to inherit a version from. */
  skippedNoVersion: number;
}

export interface RechunkOptions extends ChunkOptions {
  /** Rebuild even documents whose chunks already match the current scheme. */
  force?: boolean;
}

/**
 * Rebuild `kb_document_chunks` from `kb_documents.content` for every document
 * whose stored chunks differ from what the current chunker would produce.
 *
 * Chunks are re-attached to an EXISTING version row, never a fabricated one:
 * inventing a version to work around a chunking change would corrupt the
 * document's history.
 *
 * Note the ownership asymmetry that this has to work around. On the real corpus
 * 199 of 203 chunk rows carry a NULL `document_id` — they predate that column
 * being populated — while `kb_document_versions.document_id` is NOT NULL and
 * always set. So the version table, not the chunk table, is the reliable way
 * from a document to its chunks; a documentId-keyed lookup silently skips
 * exactly the legacy rows this migration exists for.
 */
export function rechunkDocuments(options: RechunkOptions = {}): RechunkResult {
  const { force = false, ...chunkOptions } = options;
  const now = new Date().toISOString();

  const documents = db.select().from(kbDocuments).all() as any[];
  const result: RechunkResult = {
    documentsScanned: 0,
    documentsRechunked: 0,
    chunksBefore: 0,
    chunksAfter: 0,
    skippedNoVersion: 0,
  };

  for (const doc of documents) {
    const content = doc.content || '';
    if (!content.trim()) continue;
    result.documentsScanned++;

    const versions = db
      .select()
      .from(kbDocumentVersions)
      .where(eq(kbDocumentVersions.documentId, doc.id))
      .all() as any[];

    // Find every chunk that belongs to this document, by any of the three links
    // that exist across ingestion eras: the documentId column (current), the
    // version id (legacy rows with a NULL documentId), and the old
    // `chunk_<docId>_N` id convention.
    const versionIds = versions.map((v) => v.id);
    const existing = db
      .select()
      .from(kbDocumentChunks)
      .where(
        or(
          eq(kbDocumentChunks.documentId, doc.id),
          versionIds.length > 0 ? inArray(kbDocumentChunks.versionId, versionIds) : undefined,
          like(kbDocumentChunks.id, `chunk_${doc.id}_%`)
        )
      )
      .all() as any[];

    // Without a version row there is nothing to hang the new chunks off — the
    // FK is NOT NULL. Report it rather than guessing: a document in that state
    // has a broken ingest and should be re-synced, not patched here.
    const versionId =
      versions.find((v) => v.version === doc.version)?.id ??
      versions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id ??
      existing[0]?.versionId;
    if (!versionId) {
      result.skippedNoVersion++;
      continue;
    }
    const rebuilt = buildChunkRows(doc.id, versionId, content, now, doc.tenantId || 'tenant_default', chunkOptions);
    if (rebuilt.length === 0) continue;

    // Already current: same ids in the same order, same bodies. Leave the rows
    // (and their embeddings) alone — re-writing them would invalidate every
    // vector for no gain.
    const unchanged =
      !force &&
      existing.length === rebuilt.length &&
      rebuilt.every((row, index) => {
        const prior = existing.find((e) => e.chunkIndex === index);
        return prior && prior.id === row.id && prior.content === row.content;
      });
    if (unchanged) continue;

    result.chunksBefore += existing.length;
    result.chunksAfter += rebuilt.length;
    result.documentsRechunked++;

    const staleIds = existing.map((row) => row.id).filter((id) => !rebuilt.some((row) => row.id === id));
    db.transaction((tx) => {
      // Drop the old rows by primary key — covering NULL-documentId legacy rows
      // that a documentId-keyed delete would leave behind to collide with, or
      // worse, to keep serving stale text. Their embeddings were computed over
      // different text and must not survive the re-split.
      if (staleIds.length > 0) {
        tx.delete(kbDocumentChunks).where(inArray(kbDocumentChunks.id, staleIds)).run();
      }
      for (const row of rebuilt) {
        // A re-run over an id we are about to rewrite must not hit the PK.
        tx.delete(kbDocumentChunks).where(eq(kbDocumentChunks.id, row.id)).run();
        tx.insert(kbDocumentChunks).values(row).run();
      }
    });
  }

  if (result.documentsRechunked > 0) invalidateVectorCache();
  return result;
}
