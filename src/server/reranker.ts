/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LLM-as-reranker over the fused candidate set.
 *
 * `docs/RAG.md` §3 names a cross-encoder. There is no cross-encoder model here
 * and pretending otherwise is what got the previous RAG documentation into
 * trouble: this asks the configured chat model to score query/passage pairs
 * instead. That is a real reranking stage with a real quality effect, but it is
 * slower and costlier per query than a dedicated cross-encoder, which is why it
 * is OFF by default and gated behind `ai_reranker_config.enabled`.
 *
 * It is also strictly a re-ORDERING of candidates that retrieval already found:
 * it can promote a buried-but-relevant document, and it can drop an irrelevant
 * one, but it can never introduce a document the scoped retrievers didn't
 * return — so it cannot widen what a caller is allowed to see.
 */

import { callAI } from './aiClient.ts';
import { loadStoredProviderConfig } from './providerConfig.ts';
import { logger } from './logger.ts';
import type { ScoredDoc } from './hybridRetrieval.ts';
import type { RetrievableDoc } from './retrieval.ts';

/** Passages sent to the reranker are clipped so the judging prompt stays small. */
const RERANK_EXCERPT_CHARS = 1_200;

/** Beyond this, one rerank call gets long enough to hurt latency more than it helps. */
const MAX_RERANK_CANDIDATES = 12;

export interface RerankerConfig {
  enabled: boolean;
  /** Candidates to submit for judging. */
  topK: number;
  /** Drop candidates the model scores below this (0–10). */
  minScore: number;
}

const DEFAULTS: RerankerConfig = { enabled: false, topK: 8, minScore: 2 };

/**
 * Reranking is opt-in per deployment: it adds an LLM round-trip to every
 * search, so it must never switch itself on because a key happens to exist.
 */
export function resolveRerankerConfig(): RerankerConfig {
  const stored = loadStoredProviderConfig('ai_reranker_config') || {};
  const envEnabled = process.env.RERANKER_ENABLED === 'true';
  const topK = Number(stored.topK);
  const minScore = Number(stored.minScore);
  return {
    enabled: stored.enabled === true || envEnabled,
    topK: Number.isFinite(topK) && topK > 0 ? Math.min(topK, MAX_RERANK_CANDIDATES) : DEFAULTS.topK,
    minScore: Number.isFinite(minScore) ? minScore : DEFAULTS.minScore,
  };
}

const SYSTEM_PROMPT = `You are a search reranker. For each numbered passage, judge how well it answers the user's query.
Score 0-10: 10 = directly and completely answers it, 5 = related but partial, 0 = irrelevant.
Judge ONLY relevance to the query. Ignore how well-written, recent or authoritative a passage is.
Respond with ONLY a JSON array of objects [{"i": <passage number>, "score": <0-10>}] — one entry per passage, no prose, no markdown fences.`;

/** Parse the model's array, tolerating fences and surrounding prose. */
function parseScores(raw: string, count: number): Map<number, number> {
  const scores = new Map<number, number>();
  let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return scores;
  text = text.slice(start, end + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return scores;
  }
  if (!Array.isArray(parsed)) return scores;

  for (const entry of parsed) {
    const index = Number(entry?.i);
    const score = Number(entry?.score);
    if (!Number.isInteger(index) || index < 1 || index > count) continue;
    if (!Number.isFinite(score)) continue;
    scores.set(index, Math.max(0, Math.min(10, score)));
  }
  return scores;
}

export interface RerankResult<T extends RetrievableDoc> {
  ranked: ScoredDoc<T>[];
  /** True when the model's judgment was actually applied. */
  applied: boolean;
  /** Why it wasn't, when it wasn't. */
  reason?: string;
}

/**
 * Reorder `ranked` by model-judged relevance. Any failure — disabled, provider
 * error, unparseable output, or a response that scored nothing — returns the
 * input order untouched. A reranker that can break search is worse than no
 * reranker.
 */
export async function rerankDocuments<T extends RetrievableDoc>(
  ranked: ScoredDoc<T>[],
  query: string,
  aiConfig?: any,
  config: RerankerConfig = resolveRerankerConfig()
): Promise<RerankResult<T>> {
  if (!config.enabled) return { ranked, applied: false, reason: 'Reranking is disabled.' };
  if (ranked.length < 2) return { ranked, applied: false, reason: 'Nothing to reorder.' };

  const candidates = ranked.slice(0, Math.min(config.topK, MAX_RERANK_CANDIDATES));
  const tail = ranked.slice(candidates.length);

  const passages = candidates
    .map((entry, index) => {
      // Prefer the matched excerpt — it is the passage retrieval actually hit,
      // and it keeps the judging prompt an order of magnitude smaller than the
      // full document would.
      const body = (entry.snippet || entry.doc.content || '').slice(0, RERANK_EXCERPT_CHARS);
      return `[${index + 1}] ${entry.doc.name}\n${body}`;
    })
    .join('\n\n');

  let raw: string;
  try {
    raw = await callAI(
      [{ role: 'user', content: `Query: ${query}\n\nPassages:\n\n${passages}` }],
      SYSTEM_PROMPT,
      // Judging must be deterministic; a sampled reranker reorders results
      // differently on identical repeat queries.
      { ...(aiConfig || {}), temperature: 0 }
    );
  } catch (err: any) {
    logger.warn({ err }, 'Reranking failed, keeping fused order');
    return { ranked, applied: false, reason: `Reranker call failed: ${err?.message || 'unknown'}` };
  }

  const scores = parseScores(raw || '', candidates.length);
  if (scores.size === 0) {
    return { ranked, applied: false, reason: 'Reranker returned no usable scores.' };
  }

  const reordered = candidates
    .map((entry, index) => ({ entry, index, score: scores.get(index + 1) }))
    // An unscored candidate is kept, not dropped — a truncated model response
    // must not silently delete valid results. It sorts after the scored ones,
    // in its original fused order, so the outcome stays deterministic.
    .filter(({ score }) => score === undefined || score >= config.minScore)
    .sort((a, b) => {
      if (a.score === undefined && b.score === undefined) return a.index - b.index;
      if (a.score === undefined) return 1;
      if (b.score === undefined) return -1;
      return b.score - a.score || a.index - b.index;
    })
    .map(({ entry }) => entry);

  // Everything the model judged irrelevant is gone; anything past topK keeps
  // its fused order behind the reranked head.
  return { ranked: [...reordered, ...tail], applied: true };
}
