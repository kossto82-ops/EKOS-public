/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Measured retrieval quality, surfaced to the UI.
 *
 * These are not runtime telemetry. They are the committed results of the
 * offline retrieval-evaluation harness (`scripts/eval-retrieval.ts`, metrics in
 * `src/server/evaluation.ts`), imported here at build time so the Metrics tab
 * can show what the pipeline actually scores on labelled query sets rather than
 * the invented "Operational Outcomes" numbers that used to sit there.
 *
 * The JSON files are the eval runner's own output — the single source of truth.
 * Every figure below is DERIVED from them; nothing is hand-typed, so a re-run of
 * `npm run eval` (which rewrites those files) followed by a rebuild moves these
 * numbers with it and they cannot silently drift from the measurement.
 *
 * Imported by relative path (the eval sets live at the repo root, beside the
 * runner) exactly as `src/constants/kb.ts` imports the committed corpus
 * snapshots from `src/data/` — a plain relative import resolves identically
 * under tsc, the Vite build and Vitest, whereas the `@` root alias is only wired
 * into the app build.
 */
import baselineResults from '../../eval/baseline.json';
import setAResults from '../../eval/kb-test-set-a-results.json';
import setBResults from '../../eval/kb-test-set-b-results.json';

/** The subset of the eval runner's per-run summary the UI reads. */
interface RunSummary {
  queries: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  recallAt5: number;
  mrr: number;
  misses: number;
}

interface EvalResultFile {
  config: { querySet: string; topK: number; reranked: boolean };
  runs: { lexical: RunSummary; hybrid: RunSummary };
}

/** One labelled query set, with its lexical-only and hybrid scores. */
export interface EvalSet {
  id: string;
  /** Short label for a chart axis. */
  label: string;
  /** What kind of queries this set holds — shown as a caption. */
  description: string;
  queries: number;
  hybrid: RunSummary;
  lexical: RunSummary;
}

interface EvalSetSource {
  id: string;
  label: string;
  description: string;
  file: EvalResultFile;
}

// Order is narrative: the original synthetic sweep first (where lexical-only
// collapses to 5% and the case for hybrid is starkest), then the two hand-built
// KB sets — own-wording, then paraphrase / Spanish / cross-product.
const SOURCES: EvalSetSource[] = [
  {
    id: 'baseline',
    label: 'Synthetic',
    description: '60 generated queries across the corpus',
    file: baselineResults as EvalResultFile,
  },
  {
    id: 'kb-set-a',
    label: 'KB Set A',
    description: "30 queries in the documents' own terms",
    file: setAResults as EvalResultFile,
  },
  {
    id: 'kb-set-b',
    label: 'KB Set B',
    description: '30 paraphrased, Spanish & cross-product queries',
    file: setBResults as EvalResultFile,
  },
];

export const EVAL_SETS: EvalSet[] = SOURCES.map(({ id, label, description, file }) => ({
  id,
  label,
  description,
  queries: file.runs.hybrid.queries,
  hybrid: file.runs.hybrid,
  lexical: file.runs.lexical,
}));

/** Query-weighted mean of a metric across every set, for a single-number KPI. */
function weightedMean(pick: (run: RunSummary) => number, retriever: 'hybrid' | 'lexical'): number {
  const totalQueries = EVAL_SETS.reduce((sum, set) => sum + set.queries, 0);
  if (totalQueries === 0) return 0;
  const weighted = EVAL_SETS.reduce((sum, set) => sum + pick(set[retriever]) * set.queries, 0);
  return weighted / totalQueries;
}

/**
 * Headline figures, weighted by query count so a 60-query set counts for twice a
 * 30-query one. `lift` is the whole reason semantic retrieval is switched on: how
 * many more of the same queries hybrid lands in the top 5 versus keyword-only.
 */
export const EVAL_AGGREGATE = {
  totalQueries: EVAL_SETS.reduce((sum, set) => sum + set.queries, 0),
  hybridHitAt5: weightedMean((r) => r.hitAt5, 'hybrid'),
  hybridHitAt1: weightedMean((r) => r.hitAt1, 'hybrid'),
  hybridMrr: weightedMean((r) => r.mrr, 'hybrid'),
  lexicalHitAt5: weightedMean((r) => r.hitAt5, 'lexical'),
  get lift() {
    return this.hybridHitAt5 - this.lexicalHitAt5;
  },
};
