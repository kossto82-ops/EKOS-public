import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BRANDS } from '../src/constants/brands';
import { DEPARTMENTS } from '../src/constants/departments';
import { SUPPORTED_LOCALES } from '../src/context/LocaleContext';
import {
  HYBRID_MIN_VECTOR_SCORE,
  HYBRID_VECTOR_RELATIVE_FLOOR,
  RRF_K,
} from '../src/server/hybridRetrieval';

/**
 * Documentation-drift guard.
 *
 * The docs went badly stale without anything noticing: they claimed 16 brands
 * when there were 14, "103 tests across 10 files" long after that stopped being
 * true, and — worst — "Authentication: None" for months after server-side RBAC
 * shipped. A reader (or a reviewer) had no way to tell. Tests are the only thing
 * that makes a false statement in prose fail loudly, so the claims that CAN be
 * derived from code are asserted here against the code itself.
 *
 * Design note: counts that change on every commit (how many tests exist) are
 * deliberately NOT written in prose at all — see the "no hardcoded test counts"
 * case below. A number that rots on the next commit should not be in a document;
 * a number derived from a constant should be checked against that constant.
 */

const REPO = path.resolve(__dirname, '..');

/** Project documentation — excludes the seeded KB articles, which are content. */
function docFiles(): string[] {
  const out: string[] = [];
  const roots = [path.join(REPO, 'docs'), path.join(REPO, '.ai')];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'knowledge-base' || e.name === 'screenshots') continue;
        walk(p);
      } else if (e.name.endsWith('.md')) out.push(p);
    }
  };
  roots.forEach(walk);
  out.push(path.join(REPO, 'README.md'));
  return out.filter(f => fs.existsSync(f));
}

const docs = docFiles().map(f => ({ file: path.relative(REPO, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));

/** Collects "<n> <unit>" claims across the docs, with their file for a useful failure. */
function claims(unit: string): { file: string; n: number }[] {
  // The lookbehind rejects a number that is part of a section or version number,
  // so a heading like "### 2.6 Brands" is not read as a claim of "6 brands".
  const re = new RegExp(`(?<![.\\d])(\\d+)\\s+${unit}\\b`, 'gi');
  const found: { file: string; n: number }[] = [];
  for (const { file, text } of docs) {
    for (const m of text.matchAll(re)) found.push({ file, n: Number(m[1]) });
  }
  return found;
}

describe('docs drift — counts stated in prose match the code', () => {
  it('every "N brands" claim matches the brand roster', () => {
    const actual = BRANDS.length;
    const wrong = claims('brands').filter(c => c.n !== actual);
    expect({ actual, wrong }).toEqual({ actual, wrong: [] });
  });

  it('every "N departments" claim matches the department list', () => {
    const actual = DEPARTMENTS.length;
    const wrong = claims('departments').filter(c => c.n !== actual);
    expect({ actual, wrong }).toEqual({ actual, wrong: [] });
  });

  it('every "N languages/locales" claim matches SUPPORTED_LOCALES', () => {
    const actual = SUPPORTED_LOCALES.length;
    const wrong = [...claims('languages'), ...claims('locales')].filter(c => c.n !== actual);
    expect({ actual, wrong }).toEqual({ actual, wrong: [] });
  });
});

describe('docs drift — no statements that contradict the implementation', () => {
  it('no document still claims the API has no authentication', () => {
    // requireUser has guarded every /api route since S3; API_SPECIFICATION said
    // "Authentication: None." long after that shipped.
    const offenders = docs
      .filter(d => /Authentication\*{0,2}:\s*\*{0,2}None/i.test(d.text))
      .map(d => d.file);
    expect(offenders).toEqual([]);
  });

  it('no document references a deleted brand', () => {
    // The brand cleanup left "Vorzimmer" hardcoded in a route and nothing caught
    // it. These names must never reappear anywhere in the docs.
    const deleted = [
      'Recepta', 'Standély', 'Standely', 'Vorzimmer', 'Alloflex', 'Centralino',
      'Frontdesk', 'Uketsuke', 'Baliewerk', 'Kanzleiruf', 'WorkSuite', 'AlpDesk',
      'BüroLink', 'Ringly', 'SnapLine', 'Servibüro', 'Vocaya',
    ];
    const offenders: string[] = [];
    for (const { file, text } of docs) {
      for (const name of deleted) {
        if (new RegExp(`\\b${name}\\b`).test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no document points at a port the app does not serve', () => {
    const offenders: string[] = [];
    for (const { file, text } of docs) {
      for (const m of text.matchAll(/localhost:(\d+)/g)) {
        if (m[1] !== '3000') offenders.push(`${file}: localhost:${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no document denies a retrieval capability the code has', () => {
    // README.md's "what's real vs. simulated" box — the one section whose entire
    // job is to mark the credibility line — still said "no vector store or
    // embedding search" and "grounded-but-not-RAG" long after chunking,
    // embeddings, a cosine index and RRF fusion all shipped. Forty-seven lines
    // later the same file described the cosine scan over chunk vectors. Every
    // other doc had been updated; the claim that mattered most was the stale one,
    // and it undersold the product rather than overselling it.
    //
    // Keyed to the code, not to a date: if the vector half is ever removed, these
    // denials become true again and the guard stops objecting on its own.
    const vectorHalfExists = ['vectorStore.ts', 'embeddings.ts', 'hybridRetrieval.ts'].every(f =>
      fs.existsSync(path.join(REPO, 'src', 'server', f))
    );
    expect(vectorHalfExists).toBe(true);

    const denials = [
      /no vector (store|search|index)/i,
      /grounded-but-not-RAG/i,
      /\bnot\s+(a\s+)?real\s+RAG\b/i,
      /no embedding search/i,
      /vector search is (not implemented|modeled|simulated)/i,
      /embedding\s+column\s+(that\s+)?nothing\s+ever\s+writes/i,
    ];
    const offenders: string[] = [];
    for (const { file, text } of docs) {
      for (const line of text.split('\n')) {
        // A sentence about the *absence of vectors in a given deployment* is true
        // and must stay sayable — what is forbidden is denying the capability.
        if (/backfill|never run|has no vectors at all|lexical-only/i.test(line)) continue;
        for (const re of denials) {
          if (re.test(line)) offenders.push(`${file}: "${line.trim().slice(0, 80)}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the committed eval baseline was produced by the shipped retrieval config', () => {
    // eval/baseline.json recorded metrics and nothing else, so when the floor
    // sweep moved HYBRID_VECTOR_RELATIVE_FLOOR from 0.9 to 0.95 the committed
    // baseline silently became the numbers of a configuration that no longer
    // ships (16 misses, where the shipped one has 10) — and no test could tell,
    // because bare metrics carry no provenance. scripts/eval-retrieval.ts now
    // stamps the config it ran under; this pins that stamp to the code.
    const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'eval', 'baseline.json'), 'utf8'));
    expect(baseline.config, 'eval/baseline.json predates config stamping — re-run scripts/eval-retrieval.ts --json eval/baseline.json').toBeDefined();
    expect({
      vectorRelativeFloor: baseline.config.vectorRelativeFloor,
      minVectorScore: baseline.config.minVectorScore,
      rrfK: baseline.config.rrfK,
    }).toEqual({
      vectorRelativeFloor: HYBRID_VECTOR_RELATIVE_FLOOR,
      minVectorScore: HYBRID_MIN_VECTOR_SCORE,
      rrfK: RRF_K,
    });
  });

  it('the retrieval numbers quoted in README.md match the committed baseline', () => {
    // The README quotes hit@1/hit@5/MRR as the headline credibility claim. A
    // number in prose that no test derives from its source is a number that rots
    // — the same failure mode as the "16 brands" and "103 tests" claims this file
    // already guards. Re-running the eval now forces the README to be updated
    // with it, or CI fails.
    const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'eval', 'baseline.json'), 'utf8'));
    const readme = docs.find(d => d.file === 'README.md')!.text;
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const required = [
      `hit@1 ${pct(baseline.runs.hybrid.hitAt1)}`,
      `hit@5 ${pct(baseline.runs.hybrid.hitAt5)}`,
      `MRR ${baseline.runs.hybrid.mrr.toFixed(3)}`,
      `hit@1 ${pct(baseline.runs.lexical.hitAt1)}`,
      `hit@5 ${pct(baseline.runs.lexical.hitAt5)}`,
    ];
    const missing = required.filter(s => !readme.includes(s));
    expect(missing, 'README.md quotes retrieval metrics that no longer match eval/baseline.json').toEqual([]);
  });

  it('no document hardcodes a test count (it rots on the next commit)', () => {
    // "103 tests across 10 files" was already wrong; "133 tests across 14 files"
    // went stale the same day it was written. Describe the suite, don't count it.
    const offenders: string[] = [];
    for (const { file, text } of docs) {
      for (const m of text.matchAll(/\b\d+\s+tests\b|across\s+\d+\s+files/gi)) {
        offenders.push(`${file}: "${m[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('docs drift — the deleted-brand guard also covers shipped code', () => {
  it('no deleted brand name survives in src/ or tests/', () => {
    const names = ['Recepta', 'recepta_es', 'Vorzimmer', 'vorzimmer_de', 'Standély', 'Standely', 'standely_fr'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'data') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        if (e.name === 'docsDrift.test.ts') continue; // this guard necessarily names them
        const text = fs.readFileSync(p, 'utf8');
        for (const n of names) {
          if (new RegExp(`\\b${n}\\b`).test(text)) offenders.push(`${path.relative(REPO, p).replace(/\\/g, '/')}: ${n}`);
        }
      }
    };
    walk(path.join(REPO, 'src'));
    walk(path.join(REPO, 'tests'));
    expect(offenders).toEqual([]);
  });
});
