/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retrieval evaluation metrics.
 *
 * Every retrieval parameter in this codebase — chunk size, the relative cosine
 * floor, the RRF constant, whether reranking helps at all — was chosen by
 * judgement and documented as untuned. This module is what turns those into
 * measured decisions: given a labelled set of (query → correct documents), it
 * scores a ranking so two configurations can be compared on evidence.
 *
 * Kept pure and dependency-free so it is unit-testable without a corpus, a
 * database or an embedding provider. The runner that feeds it real retrieval
 * results lives in scripts/eval-retrieval.ts.
 */

export interface LabelledQuery {
  id: string;
  query: string;
  /** Documents that genuinely answer the query. Order is irrelevant. */
  expectedDocumentIds: string[];
  /**
   * How the label was produced. Synthetic questions are generated from a
   * document and therefore echo its vocabulary, which flatters lexical
   * retrieval; keeping the provenance lets a report separate the two rather
   * than average them into a single misleading number.
   */
  source: 'synthetic' | 'real';
  /** BCP-47-ish tag of the query language, for a per-language breakdown. */
  locale?: string;
  /** Language the source document is written in, when known. */
  documentLocale?: string;
}

export interface QueryOutcome {
  query: LabelledQuery;
  /** Retrieved document ids, best first. */
  rankedDocumentIds: string[];
}

/** 1-based rank of the first correct document, or null if none was retrieved. */
export function firstRelevantRank(outcome: QueryOutcome): number | null {
  const expected = new Set(outcome.query.expectedDocumentIds);
  for (let i = 0; i < outcome.rankedDocumentIds.length; i++) {
    if (expected.has(outcome.rankedDocumentIds[i])) return i + 1;
  }
  return null;
}

/** Was at least one correct document retrieved in the top k? */
export function hitAtK(outcome: QueryOutcome, k: number): boolean {
  const rank = firstRelevantRank(outcome);
  return rank !== null && rank <= k;
}

/**
 * Fraction of the query's correct documents that appear in the top k.
 *
 * Distinct from hit@k: a query with three correct documents that retrieves one
 * of them scores 1.0 on hit@5 but 0.33 here. For a knowledge base where an
 * answer often spans several SOPs, that difference matters.
 */
export function recallAtK(outcome: QueryOutcome, k: number): number {
  const expected = new Set(outcome.query.expectedDocumentIds);
  if (expected.size === 0) return 0;
  const topK = outcome.rankedDocumentIds.slice(0, k);
  let found = 0;
  for (const id of topK) if (expected.has(id)) found++;
  return found / expected.size;
}

export interface MetricSummary {
  queries: number;
  /** Share of queries with a correct document at rank 1. */
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  /** Mean fraction of correct documents retrieved in the top 5. */
  recallAt5: number;
  /** Mean reciprocal rank — rewards ranking the right answer higher. */
  mrr: number;
  /** Queries that retrieved nothing correct at any depth. Where the bodies are. */
  misses: number;
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

export function summarize(outcomes: QueryOutcome[]): MetricSummary {
  return {
    queries: outcomes.length,
    hitAt1: mean(outcomes.map((o) => (hitAtK(o, 1) ? 1 : 0))),
    hitAt3: mean(outcomes.map((o) => (hitAtK(o, 3) ? 1 : 0))),
    hitAt5: mean(outcomes.map((o) => (hitAtK(o, 5) ? 1 : 0))),
    recallAt5: mean(outcomes.map((o) => recallAtK(o, 5))),
    mrr: mean(
      outcomes.map((o) => {
        const rank = firstRelevantRank(o);
        return rank === null ? 0 : 1 / rank;
      })
    ),
    misses: outcomes.filter((o) => firstRelevantRank(o) === null).length,
  };
}

/**
 * Split a summary by a facet of the query (source, locale, cross-lingual…).
 * An aggregate number hides the failure mode; the per-facet split is usually
 * where the actionable finding is.
 */
export function summarizeBy(
  outcomes: QueryOutcome[],
  facet: (query: LabelledQuery) => string
): Record<string, MetricSummary> {
  const groups = new Map<string, QueryOutcome[]>();
  for (const outcome of outcomes) {
    const key = facet(outcome.query);
    const list = groups.get(key);
    if (list) list.push(outcome);
    else groups.set(key, [outcome]);
  }
  const out: Record<string, MetricSummary> = {};
  for (const [key, list] of Array.from(groups.entries()).sort()) {
    out[key] = summarize(list);
  }
  return out;
}

/** True when the query is not in the language of its source document. */
export function isCrossLingual(query: LabelledQuery): boolean {
  return Boolean(query.locale && query.documentLocale && query.locale !== query.documentLocale);
}

/**
 * Compare two runs, positive meaning `candidate` is better. Used to decide
 * whether a parameter change or the reranker actually earns its cost, rather
 * than assuming it does because it sounds more sophisticated.
 */
export interface Comparison {
  metric: keyof MetricSummary;
  baseline: number;
  candidate: number;
  delta: number;
}

export function compare(baseline: MetricSummary, candidate: MetricSummary): Comparison[] {
  const metrics: Array<keyof MetricSummary> = ['hitAt1', 'hitAt3', 'hitAt5', 'recallAt5', 'mrr', 'misses'];
  return metrics.map((metric) => ({
    metric,
    baseline: baseline[metric],
    candidate: candidate[metric],
    // `misses` improves downward; every other metric improves upward.
    delta: metric === 'misses' ? baseline[metric] - candidate[metric] : candidate[metric] - baseline[metric],
  }));
}

export function formatSummary(label: string, summary: MetricSummary): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return [
    `${label.padEnd(22)}`,
    `n=${String(summary.queries).padStart(3)}`,
    `hit@1 ${pct(summary.hitAt1).padStart(6)}`,
    `hit@3 ${pct(summary.hitAt3).padStart(6)}`,
    `hit@5 ${pct(summary.hitAt5).padStart(6)}`,
    `recall@5 ${pct(summary.recallAt5).padStart(6)}`,
    `MRR ${summary.mrr.toFixed(3)}`,
    `misses ${String(summary.misses).padStart(3)}`,
  ].join('  ');
}
