/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regenerate eval/baseline.json against a CLEAN, deterministic corpus.
 *
 *   npm run eval:refresh
 *
 * Why this exists: eval/baseline.json is a committed snapshot, and the retrieval
 * eval is a manual script — so the numbers quoted in README.md / docs/RAG.md and
 * shown on the Metrics tab only reflect reality when someone re-runs it. Worse,
 * running the eval against the working db.sqlite measures whatever that DB has
 * drifted to, not the committed corpus. This command removes both problems: it
 * seeds an ISOLATED throwaway database (db.eval.sqlite) from the committed
 * snapshots, backfills embeddings, runs the eval against it, and writes
 * eval/baseline.json — reproducibly, without touching the working database.
 *
 * Requires the embedding provider to be reachable (EMBEDDING_* in .env; e.g. a
 * local Ollama serving bge-m3), because both the corpus vectors and the query
 * vectors are computed through it. With no provider the hybrid column collapses
 * to lexical and the run is meaningless (the eval prints a WARNING and this
 * script exits non-zero).
 *
 * After a refresh, update the derived numbers the tests pin:
 *   - README.md retrieval line  (tests/docsDrift.test.ts)
 *   - docs/RAG.md §5 table       (honesty; narrative)
 *   - src/constants/evalResults.ts imports baseline.json directly — no edit.
 */

// Point every module that opens the DB at a throwaway file, BEFORE they load.
process.env.DATABASE_PATH = process.env.EVAL_DB_PATH || 'db.eval.sqlite';

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

// Load EMBEDDING_* etc. dotenv does not override an already-set var, so the
// DATABASE_PATH assigned above stands.
dotenv.config();

const DB = process.env.DATABASE_PATH!;
const wipe = () => { for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(DB + s); } catch { /* absent */ } } };

async function main() {
  wipe(); // always start from an empty, deterministic corpus

  const { initDatabase, closeDatabase } = await import('../src/db/db.ts');
  const { seedDatabase } = await import('../src/db/seed.ts');
  const { backfillEmbeddings, embeddingCoverage } = await import('../src/server/vectorStore.ts');

  console.log(`[eval:refresh] seeding clean corpus into ${DB} …`);
  initDatabase();
  await seedDatabase();

  console.log('[eval:refresh] backfilling embeddings (needs the embedding provider up) …');
  // Embed the WHOLE corpus — the default backfill limit (500) would leave later
  // chunks vectorless, silently understating the hybrid run (they'd be lexical-only).
  let bf = await backfillEmbeddings({ limit: 100_000 });
  // Defensive: if a limit still capped it, loop until coverage is complete.
  for (let guard = 0; guard < 20 && embeddingCoverage().embedded < embeddingCoverage().total; guard++) {
    bf = await backfillEmbeddings({ limit: 100_000 });
    if (bf.embedded === 0) break;
  }
  const cov = embeddingCoverage();
  console.log(`[eval:refresh] embeddings: ${JSON.stringify(bf)}  coverage: ${JSON.stringify(cov)}`);
  closeDatabase(); // checkpoint WAL so the child process reads a complete file

  if (cov.embedded === 0) {
    console.error('[eval:refresh] nothing embedded — is the embedding provider (EMBEDDING_ENDPOINT_URL) up? Aborting.');
    wipe();
    process.exit(1);
  }

  console.log('[eval:refresh] running retrieval eval → eval/baseline.json');
  const r = spawnSync('npx', ['tsx', 'scripts/eval-retrieval.ts', '--json', 'eval/baseline.json'], {
    stdio: 'inherit',
    env: process.env, // carries DATABASE_PATH to the child
    shell: true,
  });

  wipe(); // throwaway DB — never persisted, never committed
  process.exit(r.status ?? 0);
}

main().catch((e) => { console.error(e); wipe(); process.exit(1); });
