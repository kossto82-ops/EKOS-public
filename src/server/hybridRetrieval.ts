/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hybrid retrieval: lexical ranking fused with semantic chunk search.
 *
 * The lexical ranker in retrieval.ts is kept, not replaced. It is genuinely
 * better than embeddings at exact-token questions — product codes, policy
 * numbers, brand names, "PIN 1234" — which is a large share of the queries this
 * KB gets. Vector search covers what it cannot: paraphrase, synonymy and
 * cross-lingual matches, where a term-frequency score is simply zero.
 *
 * Fusion is Reciprocal Rank Fusion (k = 60): each retriever contributes
 * 1/(k + rank). RRF needs no score calibration between a term-frequency count
 * and a cosine similarity — which is exactly the problem with the more obvious
 * weighted-sum approach, since those two numbers share no scale.
 *
 * Degradation is explicit and total: with no embedding provider configured, no
 * vectors backfilled, or a failing provider, this returns lexical-only results
 * and says so in `mode`. Search never fails because semantic search is off.
 */

import { trace } from '@opentelemetry/api';
import { buildSnippet, rankDocuments, type RetrievableDoc } from './retrieval.ts';
import { productsInQuery, preferProducts, type Product } from './productScope.ts';
import { EmbeddingsUnavailableError, embedQuery } from './embeddings.ts';
import { searchChunks, type ChunkHit } from './vectorStore.ts';
import { recordRetrieval } from './metrics.ts';
import { logger } from './logger.ts';

const tracer = trace.getTracer('ekos.retrieval');

/**
 * RRF damping constant. 60 is the value from the original Cormack et al. paper;
 * see docs/RAG.md §5.8 for how it measures on this corpus. Overridable per call
 * so the eval harness can sweep it.
 */
export const RRF_K = 60;

/**
 * Absolute cosine floor. Deliberately low: it is a sanity guard against a
 * degenerate vector, NOT the real filter. See HYBRID_VECTOR_RELATIVE_FLOOR.
 */
export const HYBRID_MIN_VECTOR_SCORE = 0.3;

/**
 * The real semantic filter: keep chunks scoring within this fraction of the
 * best chunk for the query.
 *
 * An absolute threshold assumes a score scale the embedding model does not
 * promise. Measured on this corpus with bge-m3, cosine similarities compress
 * into a narrow band — min 0.31, median 0.44, best 0.55-0.69 — so an absolute
 * floor of 0.3 admitted every chunk in scope and filtered nothing at all. The
 * distance between a real match and the median is what carries the signal, and
 * that ratio survives a change of embedding model where an absolute cut does not.
 *
 * 0.95 is measured, not guessed: swept over the 60-query eval set, hit@5 runs
 * 46.7% / 53.3% / 61.7% / 73.3% / 83.3% / 75.0% at floors of
 * 0.75 / 0.8 / 0.85 / 0.9 / 0.95 / 1.0. The initial hand-picked 0.9 was leaving
 * ten points of hit@5 on the table; 1.0 (best chunk only) wins hit@1 but loses
 * recall. See docs/RAG.md §5.8, including why a synthetic set makes this a
 * provisional optimum.
 */
export const HYBRID_VECTOR_RELATIVE_FLOOR = 0.95;

export type RetrievalMode = 'hybrid' | 'lexical';

export interface ScoredDoc<T extends RetrievableDoc> {
  doc: T;
  /** Fused RRF score. Comparable within one result set only. */
  score: number;
  /** Raw lexical term-frequency score; 0 when only the vector side matched. */
  lexicalScore: number;
  /** Best cosine similarity across the document's chunks; undefined if none. */
  vectorScore?: number;
  /** Match-centered excerpt, taken from the winning chunk when there is one. */
  snippet: string;
}

/** A passage handed to the model as grounding, with its provenance. */
export interface GroundingPassage {
  documentId: string;
  documentName: string;
  /** 'global' | 'brand' | undefined — mirrors kb_documents.scope. */
  scope?: string;
  /** Heading the passage sits under, when the document had any. */
  section?: string | null;
  content: string;
}

export interface HybridOptions {
  /** Max documents represented in the grounding context. */
  maxDocs?: number;
  /** Max total characters across all grounding passages. */
  maxChars?: number;
  /** Max characters taken from any single document. */
  maxCharsPerDoc?: number;
  /** Chunk hits to pull from the vector index before fusion. */
  vectorLimit?: number;
  /** Absolute cosine floor — a degenerate-vector guard, not the real filter. */
  minVectorScore?: number;
  /** Keep chunks scoring at least this fraction of the query's best chunk. */
  vectorRelativeFloor?: number;
  /** RRF damping constant. Higher flattens the contribution of rank position. */
  rrfK?: number;
  /**
   * When nothing matches, fill the grounding context with the head of the first
   * candidates so the model still has something to work from. `ranked` stays
   * empty either way, so this padding never leaks into displayed citations —
   * the same internal-only fallback the doc-level retriever had.
   */
  padWhenEmpty?: boolean;
  /**
   * Optional reordering applied to the fused results BEFORE the grounding
   * passages are assembled — so a reranker changes what the model reads, not
   * just the order of the citations. Must only reorder or drop; returning a
   * document that wasn't in the input would bypass the caller's scoping.
   */
  rerank?: (ranked: ScoredDoc<any>[]) => Promise<ScoredDoc<any>[]>;
}

/** Options with every budget resolved; `rerank` stays optional by nature. */
type ResolvedHybridOptions = Required<Omit<HybridOptions, 'rerank'>> & Pick<HybridOptions, 'rerank'>;

// Same budget as the previous doc-level retrieval so provider limits are
// unchanged — chunking just spends it on relevant passages instead of on the
// heads of whole documents.
const DEFAULTS: Required<Omit<HybridOptions, 'rerank'>> = {
  maxDocs: 5,
  maxChars: 24_000,
  maxCharsPerDoc: 8_000,
  vectorLimit: 30,
  minVectorScore: HYBRID_MIN_VECTOR_SCORE,
  vectorRelativeFloor: HYBRID_VECTOR_RELATIVE_FLOOR,
  rrfK: RRF_K,
  padWhenEmpty: false,
};

export interface HybridResult<T extends RetrievableDoc> {
  /** Documents that matched, best first. Empty means no match — never padded. */
  ranked: ScoredDoc<T>[];
  /** Passages to concatenate into the prompt, already within budget. */
  passages: GroundingPassage[];
  /** Which retrievers actually contributed. */
  mode: RetrievalMode;
  /** Why the semantic side was skipped, when it was. Surfaced in diagnostics. */
  degradedReason?: string;
  /** Products the query explicitly named, if any — the ranking was biased toward them. */
  matchedProducts?: Product[];
}

/**
 * Order fused results, breaking RRF ties deterministically.
 *
 * RRF scores collide constantly: a document ranked 1st by ONLY the lexical side
 * and a document ranked 1st by ONLY the vector side both score exactly
 * 1/(k+1). Left to `sort`'s stability that tie resolves by insertion order —
 * i.e. lexical always wins, for no reason. Observed on this corpus: the query
 * "¿Cuánto tiempo tengo para cancelar y que me devuelvan el dinero?" put a
 * telephony FAQ (4 incidental term hits, no semantic match) above the Refund
 * Policy SOP (cosine 0.686, zero term overlap).
 *
 * Ties break first on how many retrievers found the document — agreement is
 * the strongest signal RRF has — and then on cosine similarity, which is at
 * least a calibrated quantity, unlike a raw term count that scales with
 * document length.
 *
 * PROVISIONAL: this orders ties, it does not weight the retrievers against each
 * other. Choosing a real weighting needs a labelled query set, which does not
 * exist yet — see docs/RAG.md §5.5.
 */
function compareFused<T extends RetrievableDoc>(a: ScoredDoc<T>, b: ScoredDoc<T>): number {
  if (b.score !== a.score) return b.score - a.score;
  const retrievers = (entry: ScoredDoc<T>) =>
    (entry.lexicalScore > 0 ? 1 : 0) + (entry.vectorScore !== undefined ? 1 : 0);
  const byAgreement = retrievers(b) - retrievers(a);
  if (byAgreement !== 0) return byAgreement;
  return (b.vectorScore ?? 0) - (a.vectorScore ?? 0);
}

/**
 * Run the semantic side. Returns null (rather than throwing) for every
 * "semantic search isn't available" condition, so the caller degrades instead
 * of failing.
 */
async function semanticHits(
  query: string,
  documentIds: Set<string>,
  options: ResolvedHybridOptions
): Promise<{ hits: ChunkHit[] } | { reason: string }> {
  try {
    const queryVector = await embedQuery(query);
    if (!queryVector?.length) return { reason: 'Embedding provider returned an empty query vector.' };
    const hits = searchChunks(queryVector, {
      limit: options.vectorLimit,
      documentIds,
      minScore: options.minVectorScore,
    });
    if (hits.length === 0) return { reason: 'No chunks are embedded for the current embedding model.' };
    // Cut relative to the best chunk for THIS query. searchChunks returns hits
    // best-first, so the head is the reference point.
    const cutoff = hits[0].score * options.vectorRelativeFloor;
    return { hits: hits.filter((hit) => hit.score >= cutoff) };
  } catch (err: any) {
    if (err instanceof EmbeddingsUnavailableError) {
      return { reason: err.message };
    }
    // A provider outage must not take search down with it.
    logger.warn({ err }, 'Semantic retrieval failed, falling back to lexical');
    return { reason: `Embedding provider error: ${err?.message || 'unknown'}` };
  }
}

/**
 * Retrieve against a pre-scoped candidate set.
 *
 * `candidates` MUST already be filtered for the caller's brand/department scope
 * and the groundability gate — this function scopes the vector index to exactly
 * those document ids, and nothing else prevents a banned or soft-deleted
 * document's chunks from surfacing.
 */
export async function hybridRetrieve<T extends RetrievableDoc>(
  candidates: T[],
  query: string,
  options: HybridOptions = {}
): Promise<HybridResult<T>> {
  return tracer.startActiveSpan('retrieval.hybrid', async (span) => {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await runHybridRetrieve(candidates, query, options);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      recordRetrieval({ mode: result.mode, durationMs, results: result.ranked.length });
      span.setAttributes({
        'ekos.retrieval.mode': result.mode,
        'ekos.retrieval.candidates': candidates.length,
        'ekos.retrieval.results': result.ranked.length,
        // The reason the semantic side was skipped, when it was. This is the field
        // that turns "the answers got worse" into a diagnosable event: `mode` alone
        // says semantic search did not run, this says why, and neither was visible
        // outside a debug-level log line nobody was collecting.
        ...(result.degradedReason ? { 'ekos.retrieval.degraded_reason': result.degradedReason } : {}),
      });
      // Deliberately NOT recorded: the query text. It is user input against a
      // corporate corpus and spans leave the network.
      return result;
    } finally {
      span.end();
    }
  });
}

async function runHybridRetrieve<T extends RetrievableDoc>(
  candidates: T[],
  query: string,
  options: HybridOptions = {}
): Promise<HybridResult<T>> {
  const opts = { ...DEFAULTS, ...options };
  const trimmed = (query || '').trim();
  if (candidates.length === 0 || trimmed === '') {
    return { ranked: [], passages: [], mode: 'lexical' };
  }

  const byId = new Map(candidates.map((doc) => [doc.id, doc]));
  const lexical = rankDocuments(candidates, trimmed);
  const semantic = await semanticHits(trimmed, new Set(byId.keys()), opts);

  const hits = 'hits' in semantic ? semantic.hits : [];
  const mode: RetrievalMode = hits.length > 0 ? 'hybrid' : 'lexical';
  const degradedReason = 'reason' in semantic ? semantic.reason : undefined;

  // Collapse chunk hits to document level, keeping each document's best chunk
  // and every chunk it contributed (ordered) for the grounding context.
  const chunksByDoc = new Map<string, ChunkHit[]>();
  for (const hit of hits) {
    if (!byId.has(hit.documentId)) continue; // out of scope; belt and braces
    const list = chunksByDoc.get(hit.documentId);
    if (list) list.push(hit);
    else chunksByDoc.set(hit.documentId, [hit]);
  }
  // Rank documents semantically by their single best chunk.
  const vectorDocOrder = Array.from(chunksByDoc.entries())
    .map(([documentId, docHits]) => ({
      documentId,
      best: Math.max(...docHits.map((hit) => hit.score)),
    }))
    .sort((a, b) => b.best - a.best);

  // --- Reciprocal Rank Fusion -------------------------------------------
  const fused = new Map<string, { score: number; lexicalScore: number; vectorScore?: number }>();
  const bump = (documentId: string, rank: number, patch: Partial<{ lexicalScore: number; vectorScore: number }>) => {
    const entry = fused.get(documentId) || { score: 0, lexicalScore: 0 };
    entry.score += 1 / (opts.rrfK + rank);
    Object.assign(entry, patch);
    fused.set(documentId, entry);
  };
  lexical.forEach(({ doc, score }, index) => bump(doc.id, index + 1, { lexicalScore: score }));
  vectorDocOrder.forEach(({ documentId, best }, index) => bump(documentId, index + 1, { vectorScore: best }));

  let ranked: ScoredDoc<T>[] = Array.from(fused.entries())
    .map(([documentId, entry]) => {
      const doc = byId.get(documentId)!;
      const bestChunk = (chunksByDoc.get(documentId) || [])
        .slice()
        .sort((a, b) => b.score - a.score)[0];
      return {
        doc,
        score: entry.score,
        lexicalScore: entry.lexicalScore,
        vectorScore: entry.vectorScore,
        // Excerpt the winning chunk when semantics found the document, so the
        // user sees the passage that actually matched rather than the document's
        // first paragraph.
        snippet: buildSnippet(bestChunk?.content || doc.content, trimmed),
      };
    })
    .filter((entry) => byId.has(entry.doc.id))
    .sort(compareFused);

  if (opts.rerank && ranked.length > 1) {
    const reranked = (await opts.rerank(ranked)) as ScoredDoc<T>[];
    // Re-assert scoping on the way back: only documents from the original
    // candidate set survive, whatever the reranker returned.
    ranked = reranked.filter((entry) => byId.has(entry.doc.id));
  }

  // Product preference is the OUTERMOST ordering, applied after the reranker: a
  // caller naming a product ("in Helios…") is a stronger, explicit intent than
  // either the fused score or an LLM reorder, so it wins the top of the list. It
  // only reorders — never drops — so an out-of-product match still reaches the
  // model below, and a query naming no product leaves `ranked` untouched. Applied
  // before buildPassages so it changes what the model READS, not just the citations.
  const matchedProducts = productsInQuery(trimmed);
  ranked = preferProducts(ranked, matchedProducts);

  // Padding is built from unranked candidates so it can never be mistaken for
  // a match: `ranked` (and therefore the user-facing sources) stays empty.
  const padding: ScoredDoc<T>[] =
    ranked.length === 0 && opts.padWhenEmpty
      ? candidates.slice(0, opts.maxDocs).map((doc) => ({ doc, score: 0, lexicalScore: 0, snippet: '' }))
      : ranked;

  return {
    ranked,
    passages: buildPassages(padding, chunksByDoc, opts),
    mode,
    degradedReason,
    ...(matchedProducts.length ? { matchedProducts } : {}),
  };
}

/**
 * Assemble the grounding context within budget: for each document, its matched
 * chunks in document order (so the passages read continuously), or the head of
 * the document when only the lexical side matched it.
 */
function buildPassages<T extends RetrievableDoc>(
  ranked: ScoredDoc<T>[],
  chunksByDoc: Map<string, ChunkHit[]>,
  opts: ResolvedHybridOptions
): GroundingPassage[] {
  const passages: GroundingPassage[] = [];
  let usedChars = 0;
  let docsUsed = 0;

  for (const { doc } of ranked) {
    if (docsUsed >= opts.maxDocs || usedChars >= opts.maxChars) break;
    let docChars = 0;
    let contributed = false;

    const hits = (chunksByDoc.get(doc.id) || [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 4) // enough context per document without crowding out the others
      .sort((a, b) => a.chunkIndex - b.chunkIndex); // then read in document order

    const units: Array<{ content: string; section?: string | null }> = hits.length
      ? hits.map((hit) => ({ content: hit.content, section: hit.section }))
      : [{ content: doc.content || '', section: null }];

    for (const unit of units) {
      const budget = Math.min(opts.maxCharsPerDoc - docChars, opts.maxChars - usedChars);
      if (budget <= 0) break;
      const body = unit.content.length > budget ? unit.content.slice(0, budget) : unit.content;
      if (!body.trim()) continue;
      passages.push({
        documentId: doc.id,
        documentName: doc.name,
        scope: doc.scope,
        section: unit.section ?? null,
        content: body,
      });
      docChars += body.length;
      usedChars += body.length;
      contributed = true;
    }
    if (contributed) docsUsed++;
  }

  return passages;
}

/**
 * Render passages as the grounding block for a system prompt. Each passage
 * carries its source document (and section) so the model can attribute claims,
 * per docs/RAG.md §4 "Citation Aggregation".
 */
export function renderGroundingBlock(passages: GroundingPassage[]): string {
  if (passages.length === 0) return '';
  let block = '\n\nKnowledge Base Documents (answer exclusively from these):\n';
  for (const passage of passages) {
    const scopeLabel = passage.scope === 'global' ? 'Global' : 'Brand';
    const sectionLabel = passage.section ? ` › ${passage.section}` : '';
    block += `\n--- ${scopeLabel} Document: ${passage.documentName}${sectionLabel} ---\n${passage.content || 'No content available.'}\n`;
  }
  block +=
    '\n\nWhen more than one document is relevant, synthesize across all of them and make clear which document each part of the answer comes from. If the answer is not found in the documents above, say so explicitly. Do not invent information.';
  return block;
}
