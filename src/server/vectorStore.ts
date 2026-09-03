/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vector store over `kb_document_chunks`.
 *
 * Deliberately a brute-force cosine scan, not an ANN index. The corpus is 176
 * documents / low thousands of chunks; at that size an exhaustive dot product
 * over cached Float32Arrays takes single-digit milliseconds, while an HNSW
 * index would add a native dependency, an index-rebuild lifecycle and a recall
 * cliff — for a speedup nobody can perceive. `docs/RAG.md` §2 describes HNSW as
 * the target topology; this is the honest current implementation, and the
 * threshold at which it stops being adequate is documented below.
 *
 * Swap point: brute force stays comfortable to roughly 100k chunks on a single
 * node. Past that, replace `searchChunks` with an ANN index — the interface here
 * is the seam.
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/db.ts';
import { kbDocumentChunks } from '../db/schema.ts';
import { logger } from './logger.ts';

/**
 * A chunk whose document is still live — the same `deleted_at IS NULL` rule every
 * read path applies, expressed once for the two places that were missing it.
 *
 * Written as NOT EXISTS rather than a join so that a chunk with a NULL
 * `document_id` (legacy rows predating that column) stays in scope: absence of a
 * link is not evidence the document was deleted, and dropping those silently would
 * shrink the index.
 */
const CHUNK_IS_LIVE = sql`not exists (
  select 1 from kb_documents d
  where d.id = ${kbDocumentChunks.documentId} and d.deleted_at is not null
)`;
import {
  EmbeddingsUnavailableError,
  embedTexts,
  embeddingSignature,
  resolveEmbeddingConfig,
  type EmbeddingConfig,
} from './embeddings.ts';

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  section: string | null;
  content: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  score: number;
}

interface CachedVector {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  section: string | null;
  vector: Float32Array;
}

interface VectorCache {
  signature: string;
  /** Cheap fingerprint of the underlying rows; a change invalidates the cache. */
  fingerprint: string;
  vectors: CachedVector[];
}

let cache: VectorCache | null = null;

/** Drop the in-memory vector cache (tests, and after a backfill run). */
export function invalidateVectorCache(): void {
  cache = null;
}

/**
 * Cheap change-detector for the embedded chunk set: row count plus the latest
 * updatedAt. Any ingest, edit or backfill moves one of the two, so the cache
 * cannot serve vectors for content that has since been re-indexed.
 */
function fingerprintEmbeddedChunks(signature: string): string {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      latest: sql<string | null>`max(${kbDocumentChunks.updatedAt})`,
    })
    .from(kbDocumentChunks)
    .where(and(isNotNull(kbDocumentChunks.embedding), eq(kbDocumentChunks.embeddingVersion, signature)))
    .all()[0];
  return `${row?.count ?? 0}:${row?.latest ?? ''}`;
}

function loadVectors(signature: string): CachedVector[] {
  const fingerprint = fingerprintEmbeddedChunks(signature);
  if (cache && cache.signature === signature && cache.fingerprint === fingerprint) {
    return cache.vectors;
  }

  const rows = db
    .select({
      id: kbDocumentChunks.id,
      documentId: kbDocumentChunks.documentId,
      chunkIndex: kbDocumentChunks.chunkIndex,
      section: kbDocumentChunks.section,
      embedding: kbDocumentChunks.embedding,
    })
    .from(kbDocumentChunks)
    .where(and(isNotNull(kbDocumentChunks.embedding), eq(kbDocumentChunks.embeddingVersion, signature)))
    .all();

  const vectors: CachedVector[] = [];
  for (const row of rows) {
    if (!row.documentId) continue; // an unlinked chunk can never be cited
    try {
      const parsed = JSON.parse(row.embedding as string);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      vectors.push({
        chunkId: row.id,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        section: row.section ?? null,
        vector: Float32Array.from(parsed),
      });
    } catch {
      // A corrupt vector must not take down search; it just doesn't participate.
      // The next backfill re-embeds it (the row still reads as unembedded).
      continue;
    }
  }

  cache = { signature, fingerprint, vectors };
  return vectors;
}

/**
 * Build the vector cache now, instead of leaving it to whoever searches first.
 *
 * Honest about its own size: the load is **~77 ms** for 685 vectors on this
 * corpus, not the seconds it was introduced to reclaim. The first search after a
 * boot is measurably slower than later ones (retrieval ~1.9 s against a steady
 * ~0.3 s), but that residue is NOT this cache — it survives prewarming, and the
 * most likely remaining candidate is the embedding provider's first call.
 *
 * Kept anyway, on two grounds that do not depend on the size of the number:
 * 77 ms of boot time is free, and after a backfill the cache is guaranteed cold
 * on an operation that has just spent minutes of provider calls.
 *
 * It does NOT cover every case: the fingerprint is the embedded-chunk count plus
 * their latest `updatedAt`, so a document edit, an upload or a sync also
 * invalidates it, and the next search after any of those rebuilds it lazily.
 * Warming there would mean rewarming on a hot path — a different decision, and
 * one nothing has yet measured a need for.
 *
 * Returns what it loaded so the caller can log it; never throws — a cache that
 * fails to prewarm must degrade to the lazy path, not stop the server booting.
 */
export function warmVectorCache(): { warmed: boolean; vectors: number; durationMs: number; reason?: string } {
  const startedAt = Date.now();
  try {
    const config = resolveEmbeddingConfig();
    if (!config) {
      return { warmed: false, vectors: 0, durationMs: 0, reason: 'No embedding provider configured.' };
    }
    const vectors = loadVectors(embeddingSignature(config));
    return { warmed: true, vectors: vectors.length, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    return { warmed: false, vectors: 0, durationMs: Date.now() - startedAt, reason: err?.message || 'Vector cache warmup failed.' };
  }
}

/** Both operands are stored unit-length, so the dot product IS the cosine. */
function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

export interface VectorSearchOptions {
  /** Max chunk hits to return. */
  limit?: number;
  /** Restrict the scan to these document ids (RBAC / groundability scoping). */
  documentIds?: Set<string>;
  /** Drop hits below this cosine similarity. */
  minScore?: number;
}

/**
 * Rank chunks against a query vector. Returns [] when nothing has been embedded
 * yet — a KB with no vectors is a normal state, not an error, and the caller
 * falls back to lexical retrieval.
 *
 * `documentIds` must be applied by the caller for every scoped request: the
 * vector index holds every chunk regardless of brand/department scope or
 * groundability, so filtering here is what keeps a non-groundable document from
 * reaching an answer.
 */
export function searchChunks(
  queryVector: number[],
  options: VectorSearchOptions = {},
  config?: EmbeddingConfig | null
): ChunkHit[] {
  const resolved = config ?? resolveEmbeddingConfig();
  if (!resolved) return [];
  const { limit = 20, documentIds, minScore = 0 } = options;

  const vectors = loadVectors(embeddingSignature(resolved));
  if (vectors.length === 0) return [];

  const query = Float32Array.from(queryVector);
  const scored: Array<{ entry: CachedVector; score: number }> = [];
  for (const entry of vectors) {
    if (documentIds && !documentIds.has(entry.documentId)) continue;
    // Dimensionality is pinned by the signature filter, but a provider that
    // changed a model's width without changing its name would slip through.
    if (entry.vector.length !== query.length) continue;
    const score = dot(entry.vector, query);
    if (score < minScore) continue;
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  if (top.length === 0) return [];

  // Fetch bodies only for the winners — keeping chunk text out of the cache is
  // what lets the whole index live in memory.
  const byId = new Map(top.map((hit) => [hit.entry.chunkId, hit]));
  const bodies = db
    .select({ id: kbDocumentChunks.id, content: kbDocumentChunks.content })
    .from(kbDocumentChunks)
    .where(inArray(kbDocumentChunks.id, Array.from(byId.keys())))
    .all();
  const contentById = new Map(bodies.map((row) => [row.id, row.content]));

  return top.map(({ entry, score }) => ({
    chunkId: entry.chunkId,
    documentId: entry.documentId,
    chunkIndex: entry.chunkIndex,
    section: entry.section,
    content: contentById.get(entry.chunkId) || '',
    score,
  }));
}

export interface BackfillResult {
  /** Chunks that needed a vector when the run started. */
  pending: number;
  embedded: number;
  failed: number;
  /** Set when embeddings are not configured; nothing was attempted. */
  skippedReason?: string;
}

export interface BackfillOptions {
  /** Cap the number of chunks processed in one run. */
  limit?: number;
  /** Re-embed everything, not just chunks missing a current-signature vector. */
  force?: boolean;
}

/**
 * Embed chunks that have no vector for the CURRENT embedding signature.
 *
 * Changing the embedding model changes the signature, which makes every stored
 * vector stale in one step — that is intentional: silently mixing vector spaces
 * would degrade retrieval in a way that looks like a quality regression with no
 * obvious cause. A model switch simply means a re-run of this backfill.
 *
 * Runs out of band (boot, sync, or the admin route) so no user request ever
 * waits on embedding the corpus.
 */
export async function backfillEmbeddings(options: BackfillOptions = {}): Promise<BackfillResult> {
  const { limit = 500, force = false } = options;
  const config = resolveEmbeddingConfig();
  if (!config) {
    return { pending: 0, embedded: 0, failed: 0, skippedReason: 'No embedding provider configured.' };
  }
  const signature = embeddingSignature(config);

  // Scoped to live documents: embedding a soft-deleted document's chunks spends
  // provider calls on text retrieval will never read, and leaves the coverage
  // figure permanently short of 100% (see embeddingCoverage below).
  const stale = db
    .select({ id: kbDocumentChunks.id, content: kbDocumentChunks.content })
    .from(kbDocumentChunks)
    .where(
      and(
        CHUNK_IS_LIVE,
        force
          ? sql`1 = 1`
          : sql`${kbDocumentChunks.embedding} is null or ${kbDocumentChunks.embeddingVersion} is null or ${kbDocumentChunks.embeddingVersion} != ${signature}`
      )
    )
    .limit(limit)
    .all();

  const targets = stale.filter((row) => (row.content || '').trim().length > 0);
  if (targets.length === 0) {
    return { pending: stale.length, embedded: 0, failed: 0 };
  }

  const now = new Date().toISOString();
  let embedded = 0;
  let failed = 0;

  /** Persist one slice's vectors. Extracted so the retry path reuses it. */
  const store = (slice: typeof targets, vectors: number[][] | Float32Array[]) => {
    db.transaction((tx) => {
      slice.forEach((row, index) => {
        tx.update(kbDocumentChunks)
          .set({
            embedding: JSON.stringify(Array.from(vectors[index])),
            embeddingModel: config.model,
            embeddingVersion: signature,
            embeddingDate: now,
            futureEmbeddingStatus: 'generated',
            updatedAt: now,
          })
          .where(eq(kbDocumentChunks.id, row.id))
          .run();
      });
    });
  };

  const markFailed = (slice: typeof targets) => {
    db.transaction((tx) => {
      for (const row of slice) {
        tx.update(kbDocumentChunks)
          .set({ futureEmbeddingStatus: 'failed', updatedAt: now })
          .where(eq(kbDocumentChunks.id, row.id))
          .run();
      }
    });
  };

  /**
   * Embed one slice, halving it and retrying on failure down to a single chunk.
   *
   * The slice size used to be a hardcoded 50 and a failure wrote off all 50. On a
   * local CPU-bound provider (Ollama serving bge-m3) fifty long chunks cannot be
   * embedded inside EMBEDDING_TIMEOUT_MS, so EVERY slice timed out and a corpus
   * could sit at ~300 permanently unvectorized chunks while a single-chunk request
   * to the same endpoint returned instantly — which made it look like a
   * configuration problem rather than a batch-size one.
   *
   * Halving turns provider speed into a run that takes longer instead of a run
   * that fails, and bottoms out at one chunk so only a genuinely unembeddable
   * chunk is ever marked failed. A whole-provider outage still aborts, because
   * EmbeddingsUnavailableError is rethrown rather than retried.
   */
  const embedSlice = async (slice: typeof targets): Promise<void> => {
    try {
      store(slice, await embedTexts(slice.map((row) => row.content), 'document'));
      embedded += slice.length;
    } catch (err) {
      if (err instanceof EmbeddingsUnavailableError) throw err;
      if (slice.length === 1) {
        logger.error({ err, chunkId: slice[0].id }, 'Embedding failed for a single chunk');
        failed += 1;
        markFailed(slice);
        return;
      }
      const half = Math.ceil(slice.length / 2);
      logger.warn(
        { err, sliceSize: slice.length, retryingWith: half },
        'Embedding slice failed, halving and retrying'
      );
      await embedSlice(slice.slice(0, half));
      await embedSlice(slice.slice(half));
    }
  };

  // Starting size. Deliberately far below the previous 50: a slice that is too
  // small only costs extra round-trips, while one that is too large costs a
  // timeout plus the halving retries needed to get back under it. Overridable for
  // deployments whose provider is faster or slower than the local default.
  const configured = Number(process.env.EMBEDDING_BACKFILL_SLICE);
  const SLICE = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 100) : 8;
  for (let i = 0; i < targets.length; i += SLICE) {
    await embedSlice(targets.slice(i, i + SLICE));
  }

  invalidateVectorCache();
  // Rebuild it right here rather than leaving the bill for the next searcher: a
  // backfill is exactly the operation that guarantees a cold cache, and it is
  // administrative, so the seconds are already the operator's and not a user's.
  const warm = warmVectorCache();
  if (warm.warmed) {
    logger.info({ vectors: warm.vectors, durationMs: warm.durationMs }, 'Vector cache rebuilt after backfill');
  }
  return { pending: stale.length, embedded, failed };
}

/**
 * Counts for the admin/status surface: how much of the **live** KB is vectorized.
 *
 * This used to count every row in kb_document_chunks, including chunks belonging
 * to soft-deleted documents — which retrieval excludes and will never read. On the
 * production corpus that reported 685/985 = 69.5% while every live document was in
 * fact fully embedded: the 300-chunk shortfall was entirely dead text. An operator
 * reading that number sees a gap that does not exist, re-runs the backfill, and
 * watches it stay at 69.5% forever, because the figure can never reach 100%. A
 * completion signal that cannot signal completion is worse than none.
 */
export function embeddingCoverage(): { total: number; embedded: number; signature: string | null } {
  const config = resolveEmbeddingConfig();
  const signature = config ? embeddingSignature(config) : null;
  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(kbDocumentChunks)
    .where(CHUNK_IS_LIVE)
    .all()[0]?.count ?? 0;
  const embedded = signature
    ? db
        .select({ count: sql<number>`count(*)` })
        .from(kbDocumentChunks)
        .where(and(CHUNK_IS_LIVE, isNotNull(kbDocumentChunks.embedding), eq(kbDocumentChunks.embeddingVersion, signature)))
        .all()[0]?.count ?? 0
    : 0;
  return { total, embedded, signature };
}
