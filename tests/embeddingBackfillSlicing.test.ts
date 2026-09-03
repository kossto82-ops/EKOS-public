import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * The backfill's slice size.
 *
 * It was a hardcoded 50, and a failed slice wrote off all 50 chunks as `failed`.
 * On a CPU-bound local provider (Ollama serving bge-m3) fifty long chunks cannot
 * be embedded inside EMBEDDING_TIMEOUT_MS, so every slice timed out — a corpus
 * could sit permanently short of full coverage while a single-chunk request to the
 * same endpoint returned instantly, which read as a misconfigured provider rather
 * than an oversized batch.
 *
 * The starting size is now smaller and configurable, and a failing slice is halved
 * and retried down to a single chunk. These tests pin the halving specifically,
 * because the happy path passes on any provider fast enough for the default size
 * and would therefore prove nothing about slow ones.
 */

/** Sizes embedTexts was asked for, in order — the halving is visible here. */
const requestedSizes: number[] = [];
/** Slices larger than this "time out", standing in for a slow provider. */
let failAbove = Number.POSITIVE_INFINITY;

class FakeUnavailable extends Error {}

vi.mock('../src/server/embeddings.ts', () => ({
  EmbeddingsUnavailableError: FakeUnavailable,
  embeddingSignature: () => 'test:fake-model',
  resolveEmbeddingConfig: () => ({ provider: 'custom', model: 'fake-model' }),
  embedTexts: async (texts: string[]) => {
    requestedSizes.push(texts.length);
    if (texts.length > failAbove) throw new Error(`Custom embedding request timed out after 30000ms`);
    return texts.map(() => [0.1, 0.2, 0.3]);
  },
  warmEmbeddingProvider: async () => undefined,
  currentEmbeddingSignature: () => 'test:fake-model',
}));

const { createTestApp } = await import('./testApp.ts');
const { backfillEmbeddings } = await import('../src/server/vectorStore.ts');
const { db } = await import('../src/db/db.ts');
const { kbDocuments, kbDocumentVersions, kbDocumentChunks } = await import('../src/db/schema.ts');

const DOC_ID = 'doc_slice_probe';
const VERSION_ID = 'ver_slice_probe';

/** Create `count` unembedded chunks on one live document. */
function seedChunks(count: number) {
  const now = new Date().toISOString();
  db.delete(kbDocumentChunks).run();
  db.delete(kbDocumentVersions).run();
  db.delete(kbDocuments).run();
  db.insert(kbDocuments).values({
    id: DOC_ID, name: 'Slice Probe.md', type: 'txt', status: 'trained', scope: 'global',
    content: 'probe', uploadedAt: now, uploadedBy: 'test', tenantId: 'tenant_default',
    createdAt: now, updatedAt: now,
  }).run();
  db.insert(kbDocumentVersions).values({
    id: VERSION_ID, documentId: DOC_ID, version: '1.0', content: 'probe', createdBy: 'test',
    tenantId: 'tenant_default', createdAt: now, updatedAt: now,
  }).run();
  for (let i = 0; i < count; i++) {
    db.insert(kbDocumentChunks).values({
      id: `${VERSION_ID}_c${i}`, versionId: VERSION_ID, documentId: DOC_ID, chunkIndex: i,
      content: `chunk body number ${i}`, tenantId: 'tenant_default', createdAt: now, updatedAt: now,
    }).run();
  }
}

beforeAll(() => {
  createTestApp(); // initializes the in-memory test DB schema
});

beforeEach(() => {
  requestedSizes.length = 0;
  failAbove = Number.POSITIVE_INFINITY;
  delete process.env.EMBEDDING_BACKFILL_SLICE;
});

describe('backfillEmbeddings slicing', () => {
  it('embeds everything when the provider keeps up', async () => {
    seedChunks(20);
    const result = await backfillEmbeddings();
    expect(result.embedded).toBe(20);
    expect(result.failed).toBe(0);
  });

  it('halves a timing-out slice instead of writing it off', async () => {
    seedChunks(8);
    process.env.EMBEDDING_BACKFILL_SLICE = '8';
    failAbove = 2; // only slices of 1-2 succeed

    const result = await backfillEmbeddings();

    // The whole point: a slow provider makes the run longer, not failed.
    expect(result.failed).toBe(0);
    expect(result.embedded).toBe(8);
    // 8 was attempted, then 4, then 2 — visible proof it narrowed rather than gave up.
    expect(requestedSizes[0]).toBe(8);
    expect(requestedSizes).toContain(4);
    expect(requestedSizes).toContain(2);
    // Nothing below the provider's real limit was ever needed.
    expect(Math.min(...requestedSizes)).toBeGreaterThanOrEqual(1);
  });

  it('narrows to a single chunk before marking anything failed', async () => {
    seedChunks(4);
    process.env.EMBEDDING_BACKFILL_SLICE = '4';
    failAbove = 0; // nothing succeeds, not even one chunk

    const result = await backfillEmbeddings();

    // Only genuinely unembeddable chunks are failed, and each is failed alone —
    // the old code marked all 50 of a slice as failed for one timeout.
    expect(result.failed).toBe(4);
    expect(result.embedded).toBe(0);
    expect(requestedSizes).toContain(1);
  });

  it('honours EMBEDDING_BACKFILL_SLICE, capped so it cannot be set absurdly high', async () => {
    seedChunks(12);
    process.env.EMBEDDING_BACKFILL_SLICE = '3';
    await backfillEmbeddings();
    expect(requestedSizes).toEqual([3, 3, 3, 3]);

    requestedSizes.length = 0;
    seedChunks(5);
    process.env.EMBEDDING_BACKFILL_SLICE = '99999';
    await backfillEmbeddings();
    // Capped at 100, so the single slice is just "all five".
    expect(requestedSizes).toEqual([5]);
  });

  it('aborts rather than retrying when the provider itself is unavailable', async () => {
    seedChunks(4);
    failAbove = -1;
    const embeddings = await import('../src/server/embeddings.ts');
    vi.spyOn(embeddings, 'embedTexts').mockRejectedValue(new FakeUnavailable('no provider'));

    // A provider outage is not a batch-size problem, so halving it would only
    // multiply the failed calls.
    await expect(backfillEmbeddings()).rejects.toBeInstanceOf(FakeUnavailable);
    vi.restoreAllMocks();
  });
});
