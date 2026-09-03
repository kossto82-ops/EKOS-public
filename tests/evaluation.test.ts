import { describe, it, expect } from 'vitest';
import {
  compare,
  firstRelevantRank,
  hitAtK,
  isCrossLingual,
  recallAtK,
  summarize,
  summarizeBy,
  type LabelledQuery,
  type QueryOutcome,
} from '../src/server/evaluation.ts';

/**
 * The eval harness is the instrument every later retrieval decision is measured
 * with, so its own arithmetic has to be right — a metric that silently scores
 * high would make a regression look like an improvement.
 */

const q = (over: Partial<LabelledQuery> = {}): LabelledQuery => ({
  id: 'q1',
  query: 'how do refunds work',
  expectedDocumentIds: ['doc_a'],
  source: 'synthetic',
  ...over,
});

const outcome = (expected: string[], ranked: string[], over: Partial<LabelledQuery> = {}): QueryOutcome => ({
  query: q({ expectedDocumentIds: expected, ...over }),
  rankedDocumentIds: ranked,
});

describe('firstRelevantRank', () => {
  it('is 1-based and finds the earliest correct document', () => {
    expect(firstRelevantRank(outcome(['doc_b'], ['doc_a', 'doc_b', 'doc_c']))).toBe(2);
  });

  it('is null when nothing correct was retrieved', () => {
    expect(firstRelevantRank(outcome(['doc_z'], ['doc_a', 'doc_b']))).toBeNull();
  });

  it('is null for an empty ranking rather than throwing', () => {
    expect(firstRelevantRank(outcome(['doc_a'], []))).toBeNull();
  });
});

describe('hitAtK', () => {
  it('respects the cut-off', () => {
    const o = outcome(['doc_c'], ['doc_a', 'doc_b', 'doc_c']);
    expect(hitAtK(o, 1)).toBe(false);
    expect(hitAtK(o, 2)).toBe(false);
    expect(hitAtK(o, 3)).toBe(true);
  });
});

describe('recallAtK', () => {
  it('measures coverage of ALL correct documents, unlike hit@k', () => {
    // Three correct documents, one retrieved: a hit, but poor recall. Averaging
    // these two into one number is how a partial answer looks complete.
    const o = outcome(['doc_a', 'doc_b', 'doc_c'], ['doc_a', 'doc_x', 'doc_y']);
    expect(hitAtK(o, 5)).toBe(true);
    expect(recallAtK(o, 5)).toBeCloseTo(1 / 3);
  });

  it('is 1 when every correct document is inside k', () => {
    expect(recallAtK(outcome(['doc_a', 'doc_b'], ['doc_a', 'doc_b', 'doc_c']), 5)).toBe(1);
  });

  it('is 0 for a query with no labelled answer instead of dividing by zero', () => {
    expect(recallAtK(outcome([], ['doc_a']), 5)).toBe(0);
  });
});

describe('summarize', () => {
  it('computes MRR from the first relevant rank', () => {
    const s = summarize([
      outcome(['doc_a'], ['doc_a', 'doc_b']), // rank 1 -> 1.0
      outcome(['doc_b'], ['doc_a', 'doc_b']), // rank 2 -> 0.5
      outcome(['doc_z'], ['doc_a', 'doc_b']), // miss   -> 0.0
    ]);
    expect(s.queries).toBe(3);
    expect(s.mrr).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(s.hitAt1).toBeCloseTo(1 / 3);
    expect(s.hitAt5).toBeCloseTo(2 / 3);
    expect(s.misses).toBe(1);
  });

  it('reports zeroes for an empty run rather than NaN', () => {
    const s = summarize([]);
    expect(s.queries).toBe(0);
    expect(s.mrr).toBe(0);
    expect(s.hitAt1).toBe(0);
  });
});

describe('summarizeBy', () => {
  it('splits by facet so an aggregate cannot hide a failing subset', () => {
    const byFacet = summarizeBy(
      [
        outcome(['doc_a'], ['doc_a'], { source: 'synthetic' }),
        outcome(['doc_a'], ['doc_a'], { source: 'synthetic' }),
        outcome(['doc_a'], ['doc_z'], { source: 'real' }),
      ],
      (query) => query.source
    );
    expect(byFacet.synthetic.hitAt1).toBe(1);
    expect(byFacet.real.hitAt1).toBe(0);
    // The aggregate would read 67% and look acceptable.
    expect(summarize([
      outcome(['doc_a'], ['doc_a']),
      outcome(['doc_a'], ['doc_a']),
      outcome(['doc_a'], ['doc_z']),
    ]).hitAt1).toBeCloseTo(2 / 3);
  });
});

describe('isCrossLingual', () => {
  it('is true only when both languages are known and differ', () => {
    expect(isCrossLingual(q({ locale: 'de', documentLocale: 'en' }))).toBe(true);
    expect(isCrossLingual(q({ locale: 'en', documentLocale: 'en' }))).toBe(false);
    expect(isCrossLingual(q({ locale: 'de' }))).toBe(false); // unknown, not assumed
  });
});

describe('compare', () => {
  it('orients every metric so positive means better', () => {
    const baseline = summarize([outcome(['doc_a'], ['doc_z'])]); // miss
    const candidate = summarize([outcome(['doc_a'], ['doc_a'])]); // hit
    const deltas = Object.fromEntries(compare(baseline, candidate).map((c) => [c.metric, c.delta]));
    expect(deltas.hitAt1).toBeGreaterThan(0);
    expect(deltas.mrr).toBeGreaterThan(0);
    // Fewer misses is an improvement, so its delta must also be positive.
    expect(deltas.misses).toBeGreaterThan(0);
  });
});
