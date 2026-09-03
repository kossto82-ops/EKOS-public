/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Score retrieval against the labelled query set.
 *
 *   npx tsx scripts/eval-retrieval.ts [--set eval/retrieval-queries.json] [--rerank] [--json out.json]
 *
 * Runs each query through three configurations and prints them side by side:
 *
 *   lexical   — rankDocuments() alone, i.e. what the platform did before
 *               embeddings existed. The baseline any semantic work must beat.
 *   hybrid    — the shipped pipeline: lexical fused with vector search via RRF.
 *   +rerank   — hybrid plus the LLM reranker (only with --rerank; it costs an
 *               extra model call per query, so it must prove it earns that).
 *
 * Results are broken down by query source and by cross-lingual status, because
 * the aggregate hides the interesting part: synthetic questions echo their
 * source document's vocabulary and flatter the lexical baseline, while
 * cross-lingual queries are where term matching necessarily scores zero.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { initDatabase, db } from '../src/db/db.ts';
import { kbDocuments } from '../src/db/schema.ts';
import { isRetrievableDoc } from '../src/server/grounding.ts';
import { rankDocuments } from '../src/server/retrieval.ts';
import {
  hybridRetrieve,
  HYBRID_MIN_VECTOR_SCORE,
  HYBRID_VECTOR_RELATIVE_FLOOR,
  RRF_K,
} from '../src/server/hybridRetrieval.ts';
import { rerankDocuments } from '../src/server/reranker.ts';
import {
  compare,
  formatSummary,
  isCrossLingual,
  summarize,
  summarizeBy,
  type LabelledQuery,
  type QueryOutcome,
} from '../src/server/evaluation.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const TOP_K = 5;

async function main() {
  const setPath = path.resolve(value('--set', path.join('eval', 'retrieval-queries.json')));
  if (!fs.existsSync(setPath)) {
    console.error(`No eval set at ${setPath}. Generate one with scripts/generate-eval-set.ts.`);
    process.exit(1);
  }
  const queries = JSON.parse(fs.readFileSync(setPath, 'utf8')) as LabelledQuery[];

  initDatabase();
  const docs = (db.select().from(kbDocuments).all() as any[]).filter(isRetrievableDoc);
  console.log(`corpus: ${docs.length} groundable documents`);
  console.log(`queries: ${queries.length} (${queries.filter((q) => q.source === 'real').length} real, ` +
    `${queries.filter((q) => q.source === 'synthetic').length} synthetic)\n`);

  const lexical: QueryOutcome[] = [];
  const hybrid: QueryOutcome[] = [];
  const reranked: QueryOutcome[] = [];
  const withRerank = flag('--rerank');
  let modeLexicalCount = 0;

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    lexical.push({
      query,
      rankedDocumentIds: rankDocuments(docs, query.query).slice(0, TOP_K).map((r) => r.doc.id),
    });

    const h = await hybridRetrieve(docs, query.query, { maxDocs: TOP_K });
    if (h.mode === 'lexical') modeLexicalCount++;
    hybrid.push({ query, rankedDocumentIds: h.ranked.slice(0, TOP_K).map((r) => r.doc.id) });

    if (withRerank) {
      // Force the reranker on regardless of deployment config — the point of
      // the run is to find out whether it helps, not to honour the flag.
      const r = await rerankDocuments(h.ranked, query.query, undefined, {
        enabled: true,
        topK: 8,
        minScore: 2,
      });
      reranked.push({ query, rankedDocumentIds: r.ranked.slice(0, TOP_K).map((e) => e.doc.id) });
    }

    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${queries.length}`);
  }

  if (modeLexicalCount > 0) {
    console.log(
      `\nWARNING: ${modeLexicalCount}/${queries.length} queries fell back to lexical-only ` +
        `(no embedding provider, or nothing embedded). The hybrid column below is not measuring semantics.`
    );
  }

  const runs: Array<[string, QueryOutcome[]]> = [['lexical', lexical], ['hybrid', hybrid]];
  if (withRerank) runs.push(['hybrid+rerank', reranked]);

  console.log('\n=== overall ===');
  for (const [label, outcomes] of runs) console.log(formatSummary(label, summarize(outcomes)));

  console.log('\n=== by query source ===');
  for (const [label, outcomes] of runs) {
    for (const [facet, s] of Object.entries(summarizeBy(outcomes, (q) => q.source))) {
      console.log(formatSummary(`${label} / ${facet}`, s));
    }
  }

  console.log('\n=== cross-lingual vs same-language ===');
  for (const [label, outcomes] of runs) {
    for (const [facet, s] of Object.entries(
      summarizeBy(outcomes, (q) => (isCrossLingual(q) ? 'cross-lingual' : 'same-language'))
    )) {
      console.log(formatSummary(`${label} / ${facet}`, s));
    }
  }

  console.log('\n=== hybrid vs lexical ===');
  for (const c of compare(summarize(lexical), summarize(hybrid))) {
    const sign = c.delta > 0 ? '+' : '';
    console.log(`  ${c.metric.padEnd(10)} ${c.baseline.toFixed(3)} -> ${c.candidate.toFixed(3)}  (${sign}${c.delta.toFixed(3)})`);
  }
  if (withRerank) {
    console.log('\n=== +rerank vs hybrid ===');
    for (const c of compare(summarize(hybrid), summarize(reranked))) {
      const sign = c.delta > 0 ? '+' : '';
      console.log(`  ${c.metric.padEnd(10)} ${c.baseline.toFixed(3)} -> ${c.candidate.toFixed(3)}  (${sign}${c.delta.toFixed(3)})`);
    }
  }

  // The misses are the actionable output — an aggregate tells you nothing about
  // what to fix next.
  const byId = new Map(docs.map((d: any) => [d.id, d.name]));
  const misses = hybrid.filter((o) => !o.rankedDocumentIds.some((id) => o.query.expectedDocumentIds.includes(id)));
  console.log(`\n=== hybrid misses (${misses.length}) ===`);
  for (const miss of misses.slice(0, 15)) {
    console.log(`  [${miss.query.locale ?? '??'}→${miss.query.documentLocale ?? '??'}] ${miss.query.query}`);
    console.log(`      want: ${miss.query.expectedDocumentIds.map((id) => byId.get(id) ?? id).join(', ')}`);
    console.log(`      got : ${miss.rankedDocumentIds.slice(0, 3).map((id) => byId.get(id) ?? id).join(', ') || '(nothing)'}`);
  }
  if (misses.length > 15) console.log(`  … and ${misses.length - 15} more`);

  const jsonOut = value('--json', '');
  if (jsonOut) {
    // The stamped `config` is not decoration. eval/baseline.json sat at the
    // as-first-shipped relative floor of 0.9 (16 misses) for the whole period
    // after the sweep moved the shipped constant to 0.95 (10 misses), and
    // nothing could detect it: a file of bare metrics cannot be checked against
    // the code that produced it. With the configuration recorded alongside the
    // numbers, tests/docsDrift.test.ts fails the moment a retrieval constant
    // moves without the baseline being re-run.
    const config = {
      vectorRelativeFloor: HYBRID_VECTOR_RELATIVE_FLOOR,
      minVectorScore: HYBRID_MIN_VECTOR_SCORE,
      rrfK: RRF_K,
      topK: TOP_K,
      reranked: withRerank,
      querySet: path.relative(process.cwd(), setPath).replace(/\\/g, '/'),
    };
    fs.writeFileSync(
      path.resolve(jsonOut),
      `${JSON.stringify(
        { config, runs: Object.fromEntries(runs.map(([l, o]) => [l, summarize(o)])), misses },
        null,
        2
      )}\n`,
      'utf8'
    );
    console.log(`\nwrote ${jsonOut}`);
  }
}

await main();
