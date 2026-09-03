import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from './testApp.ts';
import { db } from '../src/db/db.ts';
import { kbDocuments, kbDocumentChunks } from '../src/db/schema.ts';
import { upsertKbDocuments } from '../src/server/sharepoint/ingest.ts';
import { rechunkDocuments } from '../src/server/reindex.ts';
import { CHUNK_DEFAULTS } from '../src/server/chunking.ts';

/**
 * The live database was ingested before real chunking existed: 200 documents,
 * 202 chunk rows, the largest a single 60k-character blob. Every embedding
 * provider rejects an input that size, so the vector index simply cannot be
 * built until those rows are re-split. These lock in that the migration does
 * the split, keeps the version link intact, and is safe to run twice.
 */

const DOC_ID = 'sp_legacy_blob';
const LEGACY_CHUNK_ID = 'chunk_sp_legacy_blob_0';

/** A body well past the chunk ceiling, with paragraph structure to split on. */
const BIG_BODY = Array.from({ length: 30 }, (_, i) => `${`para${i} `.repeat(60).trim()}.`).join('\n\n');

beforeAll(() => {
  createTestApp();
  // Ingest normally to get valid document + version rows...
  upsertKbDocuments(
    [
      {
        id: 'legacy_blob',
        uri: 'file:///drive/legacy_blob',
        name: 'legacy_blob.md',
        folderPath: '',
        topFolder: '',
        fileType: 'md',
        content: BIG_BODY,
        truncated: false,
        frontmatter: {},
        lastModified: '2026-08-05T00:00:00Z',
      },
    ] as any,
    '2026-08-05T00:00:00Z'
  );

  // ...then force the rows back into the pre-chunking shape: one row holding
  // the whole body, under the old id scheme.
  const versionId = (db.select().from(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, DOC_ID)).all()[0] as any)
    .versionId;
  db.delete(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, DOC_ID)).run();
  db.insert(kbDocumentChunks)
    .values({
      id: LEGACY_CHUNK_ID,
      versionId,
      documentId: DOC_ID,
      chunkIndex: 0,
      content: BIG_BODY,
      tenantId: 'tenant_default',
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
    })
    .run();
});

function chunksFor(documentId: string): any[] {
  return db
    .select()
    .from(kbDocumentChunks)
    .where(eq(kbDocumentChunks.documentId, documentId))
    .all() as any[];
}

describe('rechunkDocuments', () => {
  it('splits a legacy single-blob document into provider-sized chunks', () => {
    expect(chunksFor(DOC_ID)).toHaveLength(1);

    const result = rechunkDocuments();
    expect(result.documentsRechunked).toBeGreaterThanOrEqual(1);

    const chunks = chunksFor(DOC_ID);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_DEFAULTS.maxChars + CHUNK_DEFAULTS.overlapChars);
    }
    // The oversized legacy row is gone, not left alongside the new ones.
    expect(chunks.some((c) => c.id === LEGACY_CHUNK_ID)).toBe(false);
  });

  it('keeps every new chunk linked to the document and its existing version', () => {
    const chunks = chunksFor(DOC_ID);
    const versionIds = new Set(chunks.map((c) => c.versionId));
    expect(versionIds.size).toBe(1);
    expect(chunks.every((c) => c.documentId === DOC_ID)).toBe(true);
    expect(chunks.every((c) => c.futureEmbeddingStatus === 'pending')).toBe(true);
    expect(chunks.map((c) => c.chunkIndex).sort((a, b) => a - b)).toEqual(chunks.map((_, i) => i));
  });

  it('is idempotent — a second run rewrites nothing', () => {
    const before = chunksFor(DOC_ID).map((c) => c.id);
    const result = rechunkDocuments();
    expect(result.documentsRechunked).toBe(0);
    expect(chunksFor(DOC_ID).map((c) => c.id)).toEqual(before);
  });

  it('re-chunks legacy rows whose documentId is NULL', () => {
    // The real corpus had 199 of 203 chunk rows with a NULL document_id — they
    // predate that column being populated. A documentId-keyed lookup skips
    // exactly the rows this migration exists for, so the link must be resolved
    // through kb_document_versions instead.
    const DOC = 'sp_null_link';
    upsertKbDocuments(
      [
        {
          id: 'null_link',
          uri: 'file:///drive/null_link',
          name: 'null_link.md',
          folderPath: '',
          topFolder: '',
          fileType: 'md',
          content: BIG_BODY,
          truncated: false,
          frontmatter: {},
          lastModified: '2026-08-05T00:00:00Z',
        },
      ] as any,
      '2026-08-05T00:00:00Z'
    );
    const versionId = (chunksFor(DOC)[0] as any).versionId;
    db.delete(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, DOC)).run();
    db.insert(kbDocumentChunks)
      .values({
        id: `chunk_${DOC}_0`,
        versionId,
        documentId: null, // the legacy shape
        chunkIndex: 0,
        content: BIG_BODY,
        tenantId: 'tenant_default',
        createdAt: '2026-08-05T00:00:00Z',
        updatedAt: '2026-08-05T00:00:00Z',
      } as any)
      .run();
    expect(chunksFor(DOC)).toHaveLength(0); // invisible by documentId

    const result = rechunkDocuments();
    expect(result.documentsRechunked).toBeGreaterThanOrEqual(1);

    const chunks = chunksFor(DOC);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.documentId === DOC)).toBe(true);
    // The orphaned legacy row is deleted, not left behind serving stale text.
    const leftovers = db
      .select()
      .from(kbDocumentChunks)
      .where(eq(kbDocumentChunks.id, `chunk_${DOC}_0`))
      .all();
    expect(leftovers).toHaveLength(0);
  });

  it('reports documents it could not re-chunk instead of inventing a version row', () => {
    const now = '2026-08-05T00:00:00Z';
    db.insert(kbDocuments)
      .values({
        id: 'doc_orphan',
        name: 'orphan.md',
        type: 'md',
        status: 'active',
        scope: 'global',
        content: 'Some real content that would otherwise be chunked.',
        uploadedAt: now,
        uploadedBy: 'test',
        owner: 'test',
        department: 'Operations',
        departmentScope: 'global',
        departmentIds: '[]',
        approvalStatus: 'Approved',
        version: '1.0',
        tenantId: 'tenant_default',
        createdAt: now,
        updatedAt: now,
      } as any)
      .run();

    const result = rechunkDocuments();
    expect(result.skippedNoVersion).toBeGreaterThanOrEqual(1);
    expect(chunksFor('doc_orphan')).toHaveLength(0);
  });
});
