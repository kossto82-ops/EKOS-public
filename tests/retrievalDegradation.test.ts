import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db/db.ts';
import { kbDocuments, kbDocumentVersions, kbDocumentChunks } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import { embeddingCoverage } from '../src/server/vectorStore.ts';
import { createTestApp } from './testApp.ts';

/**
 * Two defects on the same seam: what the system knows about its own retrieval
 * quality, versus what it tells anyone.
 *
 * 1. `embeddingCoverage()` counted chunks belonging to soft-deleted documents —
 *    text retrieval excludes and will never read. On the production corpus that
 *    read 685/985 (69.5%) while every live document was fully embedded. An
 *    operator sees a gap that does not exist, runs the backfill, and the number
 *    never moves: a completion signal that cannot signal completion.
 *
 * 2. Nothing surfaced the difference between a hybrid answer and a keyword-only
 *    one. The server has always returned `retrievalMode`; the client discarded
 *    it. Measured on the labelled set, lexical-only retrieval answers hit@1 0.0%
 *    against hybrid's 63.3% (docs/RAG.md §5.8) — so the degradation the user
 *    could not see was the one that mattered most.
 */
beforeAll(() => {
  createTestApp();
});

/** Inserts a document with one chunk, embedded or not, and returns its id. */
function seedDoc(id: string, opts: { embedded: boolean; deleted: boolean }) {
  const now = new Date().toISOString();
  const versionId = `ver_${id}`;
  db.insert(kbDocuments).values({
    id, name: `${id}.md`, type: 'md', status: 'trained', scope: 'global',
    content: 'coverage probe body', uploadedAt: now, uploadedBy: 'test',
    tenantId: 'tenant_default', createdAt: now, updatedAt: now,
    deletedAt: opts.deleted ? now : null,
  }).run();
  db.insert(kbDocumentVersions).values({
    id: versionId, documentId: id, version: '1.0', content: 'coverage probe body',
    createdBy: 'test', tenantId: 'tenant_default', createdAt: now, updatedAt: now,
  }).run();
  db.insert(kbDocumentChunks).values({
    id: `chunk_${id}_0`, versionId, documentId: id, chunkIndex: 0,
    content: 'coverage probe body',
    embedding: opts.embedded ? JSON.stringify([0.1, 0.2, 0.3]) : null,
    embeddingVersion: opts.embedded ? embeddingCoverage().signature : null,
    tenantId: 'tenant_default', createdAt: now, updatedAt: now,
  }).run();
  return id;
}

function cleanup(...ids: string[]) {
  for (const id of ids) {
    db.delete(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, id)).run();
    db.delete(kbDocumentVersions).where(eq(kbDocumentVersions.documentId, id)).run();
    db.delete(kbDocuments).where(eq(kbDocuments.id, id)).run();
  }
}

describe('embeddingCoverage() counts only the live corpus', () => {
  it('ignores chunks belonging to soft-deleted documents', () => {
    const before = embeddingCoverage();

    seedDoc('doc_coverage_live', { embedded: false, deleted: false });
    const withLive = embeddingCoverage();
    expect(withLive.total, 'a live document must be counted').toBe(before.total + 1);

    seedDoc('doc_coverage_deleted', { embedded: false, deleted: true });
    const withDeleted = embeddingCoverage();
    expect(
      withDeleted.total,
      'a soft-deleted document must NOT be counted — retrieval never reads it, so it cannot be a coverage gap'
    ).toBe(withLive.total);

    cleanup('doc_coverage_live', 'doc_coverage_deleted');
    expect(embeddingCoverage().total).toBe(before.total);
  });

  it('can therefore reach 100% — the property that makes it a usable signal', () => {
    const before = embeddingCoverage();
    // A corpus whose only unembedded chunks are dead should read as complete.
    seedDoc('doc_coverage_dead_only', { embedded: false, deleted: true });
    const after = embeddingCoverage();
    expect(after.total).toBe(before.total);
    expect(after.embedded).toBe(before.embedded);
    cleanup('doc_coverage_dead_only');
  });
});

describe('/api/search reports how it retrieved', () => {
  it('always states retrievalMode, so a keyword-only answer is distinguishable', async () => {
    const request = (await import('supertest')).default;
    const { authHeader } = await import('./testApp.ts');
    const app = createTestApp();

    const res = await request(app)
      .post('/api/search')
      .set(...authHeader('u1'))
      .send({ query: 'refund policy', aiConfig: null });

    expect(res.status).toBe(200);
    // No embedding provider is configured under test, so this must report the
    // degraded mode rather than omitting the field — the client renders a warning
    // banner off exactly this value (SearchResultPanel).
    expect(res.body.data.retrievalMode).toBe('lexical');
    expect(res.body.data.indexVersion).toBe('lexical-only');
    expect(res.body.data.vectorSimilarityThreshold).toBe(0);
  });
});
