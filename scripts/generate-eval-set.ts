/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generate a synthetic retrieval evaluation set from the live corpus.
 *
 *   npx tsx scripts/generate-eval-set.ts [--per-doc 1] [--docs 40] [--out eval/retrieval-queries.json]
 *
 * For each sampled document the configured chat model writes questions that the
 * document answers; the document's id becomes the ground truth.
 *
 * KNOWN BIAS, and the reason this file works the way it does. A question
 * generated from a document naturally reuses that document's wording, so a
 * naive synthetic set rewards lexical matching and hides exactly the semantic
 * failures it should be catching. Two deliberate countermeasures:
 *
 *   1. The prompt forbids reusing distinctive terminology from the source and
 *      demands the phrasing of someone who has NOT read it.
 *   2. Most questions are generated in a language OTHER than the document's, so
 *      term overlap is structurally impossible for that subset. The harness
 *      reports cross-lingual queries separately.
 *
 * This narrows the gap with real traffic. It does not close it — a synthetic set
 * still cannot tell you what your agents actually ask. Merge real queries in
 * (source: 'real') as they accumulate; the harness reports the two separately
 * precisely so the synthetic number never gets mistaken for the real one.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { initDatabase, db } from '../src/db/db.ts';
import { kbDocuments } from '../src/db/schema.ts';
import { callAI } from '../src/server/aiClient.ts';
import { isRetrievableDoc } from '../src/server/grounding.ts';
import type { LabelledQuery } from '../src/server/evaluation.ts';

interface Args {
  perDoc: number;
  docs: number;
  out: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const read = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    perDoc: Number(read('--per-doc', '1')),
    docs: Number(read('--docs', '40')),
    out: read('--out', path.join('eval', 'retrieval-queries.json')),
  };
}

/** Languages the KB serves. A question is asked in one of these. */
const LOCALES = [
  { tag: 'es', name: 'Spanish' },
  { tag: 'de', name: 'German' },
  { tag: 'en', name: 'English' },
  { tag: 'fr', name: 'French' },
  { tag: 'it', name: 'Italian' },
  { tag: 'nl', name: 'Dutch' },
];

/**
 * Crude language detection from stopwords — good enough to label the document's
 * language for the cross-lingual split, and it avoids another dependency. When
 * uncertain it returns undefined rather than guessing, and isCrossLingual()
 * treats an unknown language as "not cross-lingual" instead of assuming.
 */
function detectLocale(text: string): string | undefined {
  const sample = ` ${text.slice(0, 4_000).toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ')} `;
  const markers: Record<string, string[]> = {
    es: [' que ', ' para ', ' con ', ' los ', ' del ', ' una ', ' por '],
    de: [' der ', ' die ', ' und ', ' nicht ', ' mit ', ' für ', ' ist '],
    en: [' the ', ' and ', ' with ', ' this ', ' that ', ' from ', ' will '],
    fr: [' les ', ' des ', ' pour ', ' avec ', ' est ', ' une ', ' dans '],
    it: [' che ', ' per ', ' con ', ' della ', ' sono ', ' una ', ' nel '],
    nl: [' het ', ' een ', ' van ', ' niet ', ' voor ', ' met ', ' dat '],
  };
  let best: { tag: string; hits: number } | null = null;
  for (const [tag, words] of Object.entries(markers)) {
    let hits = 0;
    for (const w of words) hits += sample.split(w).length - 1;
    if (!best || hits > best.hits) best = { tag, hits };
  }
  // Too few markers to be confident — the document may be a table or a stub.
  return best && best.hits >= 5 ? best.tag : undefined;
}

/** Deterministic sample so re-running produces a comparable set. */
function sample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items.slice();
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

const SYSTEM = `You write evaluation questions for a knowledge-base retrieval benchmark.
Given a document, write questions that the document genuinely answers.

Hard rules:
- Write as someone who has NOT read the document and does not know its wording.
- Do NOT reuse distinctive nouns, headings, product names or phrases from the document. Paraphrase into everyday language.
- Ask about something specific the document actually answers — never a generic question that dozens of documents could answer.
- One sentence per question. No numbering, no preamble.

Respond with ONLY a JSON array of strings. No markdown fences, no explanation.`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free provider tiers cap tokens per minute (Groq: 12k), and a generation run
 * over the whole corpus blows straight through it — the first attempt lost 40
 * of 60 documents to 429s. Honour the delay the provider asks for when it names
 * one, otherwise back off exponentially.
 */
async function callWithRetry(prompt: string, attempts = 5): Promise<string> {
  let lastError: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await callAI([{ role: 'user', content: prompt }], SYSTEM, { temperature: 0.4 });
    } catch (err: any) {
      lastError = err;
      const message = String(err?.message || '');
      if (!/rate.?limit|429|tokens per minute/i.test(message)) throw err;
      const asked = message.match(/try again in ([\d.]+)(ms|s)/i);
      const waitMs = asked
        ? Math.ceil(Number(asked[1]) * (asked[2].toLowerCase() === 's' ? 1000 : 1)) + 250
        : 2_000 * 2 ** attempt;
      await sleep(Math.min(waitMs, 30_000));
    }
  }
  throw lastError;
}

async function questionsFor(doc: any, count: number, locale: { tag: string; name: string }): Promise<string[]> {
  // 3k characters is enough to ground a question and halves the token spend per
  // document, which is what the per-minute cap actually bites on.
  const body = String(doc.content || '').slice(0, 3_000);
  const raw = await callWithRetry(
    `Write ${count} question(s) in ${locale.name}, whatever language the document is written in.\n\nDocument title: ${doc.name}\n\nDocument:\n${body}`
  );

  let text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    // Models routinely overshoot the requested count. Truncate rather than
    // accept it, or one verbose document silently dominates the set and skews
    // every aggregate toward whatever that document is about.
    return parsed.filter((q) => typeof q === 'string' && q.trim().length > 10).slice(0, count);
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs();
  initDatabase();

  const all = (db.select().from(kbDocuments).all() as any[]).filter(isRetrievableDoc);
  const chosen = sample(all, args.docs);
  console.log(`corpus: ${all.length} groundable documents -> sampling ${chosen.length}`);

  const queries: LabelledQuery[] = [];
  let failed = 0;

  for (let i = 0; i < chosen.length; i++) {
    const doc = chosen[i];
    const documentLocale = detectLocale(doc.content || '');
    // Ask in a different language than the document roughly 2 times in 3, so
    // the set cannot be solved by term overlap alone. Deterministic by index.
    const crossLingual = i % 3 !== 0;
    const candidates = LOCALES.filter((l) => (crossLingual ? l.tag !== documentLocale : l.tag === documentLocale));
    const locale = candidates.length > 0 ? candidates[i % candidates.length] : LOCALES[i % LOCALES.length];

    try {
      const generated = await questionsFor(doc, args.perDoc, locale);
      if (generated.length === 0) { failed++; continue; }
      generated.forEach((query, n) => {
        queries.push({
          id: `syn_${doc.id}_${n}`,
          query: query.trim(),
          expectedDocumentIds: [doc.id],
          source: 'synthetic',
          locale: locale.tag,
          documentLocale,
        });
      });
    } catch (err: any) {
      failed++;
      console.warn(`  ${doc.name}: ${err?.message || err}`);
    }
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${chosen.length} documents (${queries.length} questions)`);
  }

  // Merge with any hand-labelled real queries already on disk — regenerating
  // the synthetic half must never discard the real half, which is the valuable
  // part and the only part that cannot be rebuilt by rerunning this script.
  const outPath = path.resolve(args.out);
  let preserved: LabelledQuery[] = [];
  if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8')) as LabelledQuery[];
      preserved = existing.filter((q) => q.source === 'real');
    } catch {
      console.warn('existing eval set unreadable — leaving it alone and writing nothing');
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify([...preserved, ...queries], null, 2)}\n`, 'utf8');

  const crossCount = queries.filter((q) => q.documentLocale && q.locale !== q.documentLocale).length;
  console.log(
    `\nwrote ${queries.length} synthetic + ${preserved.length} preserved real -> ${args.out}` +
      `\ncross-lingual: ${crossCount}/${queries.length}   documents that produced nothing: ${failed}`
  );
}

await main();
