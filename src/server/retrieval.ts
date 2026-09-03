/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight lexical retrieval for grounding.
 *
 * The KB grew from a handful of demo documents to the full ingested corpus
 * (214 live documents; 252 authored across the snapshots, 40 soft-deleted).
 * Concatenating every document into the LLM prompt now
 * exceeds provider token limits (e.g. Groq free tier rejects a ~114k-token
 * request), which made every grounded answer fall back to the offline stub.
 *
 * This selects only the documents most relevant to the query and caps the total
 * grounding size, so the prompt stays well within provider limits and the call
 * actually succeeds. It is intentionally dependency-free (no embeddings): BM25
 * over the document name + content, which is cheap to run per request.
 *
 * Scoring was a raw sum of term occurrences (name ×5 + body) until it was
 * measured against the real question set in eval/task-queries.json. Raw counts
 * scale with document length, so the corpus's longest file — the 60k-character
 * `Master Training.docx` — won almost every Spanish query on incidental term
 * hits: it outscored `TeleNord.md` 33 to 12 on "códigos de desvío de llamadas de
 * TeleNord", where TeleNord.md IS the document of those codes. BM25 fixes both
 * halves of that: length normalization stops long documents accumulating score
 * for being long, and IDF stops a term that appears everywhere counting as much
 * as the one that identifies the document.
 */

export interface RetrievableDoc {
  id: string;
  name: string;
  content?: string | null;
  scope?: string;
  [key: string]: any;
}

export interface RetrievalOptions {
  /** Max documents to include in the grounding context. */
  maxDocs?: number;
  /** Max total characters of document content across all selected docs. */
  maxChars?: number;
  /** Max characters kept from any single document (truncated if longer). */
  maxCharsPerDoc?: number;
}

// Sized so a grounded request stays comfortably under tight free-tier budgets
// (e.g. Groq's 12k tokens/minute): ~24k chars of context ≈ ~7k tokens, leaving
// headroom for the system prompt, query and completion. Raise these if you move
// to a provider/tier with a larger context/rate budget.
const DEFAULTS: Required<RetrievalOptions> = {
  maxDocs: 5,
  maxCharsPerDoc: 8_000,
  maxChars: 24_000,
};

// Minimal multilingual stopword set (EN/ES) so common words don't dominate the
// score. Not exhaustive by design — just enough to keep ranking meaningful.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'when',
  'where', 'which', 'who', 'are', 'can', 'does', 'has', 'have', 'you', 'your',
  'que', 'como', 'para', 'con', 'los', 'las', 'del', 'una', 'uno', 'por', 'the',
  'cual', 'donde', 'cuando', 'quien', 'este', 'esta', 'esto', 'sobre', 'desde',
]);

/** Lowercase and strip accents so "desvío" matches "desvio". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export interface RankedDoc<T extends RetrievableDoc> {
  doc: T;
  /**
   * Lexical relevance score: BM25-style, length-normalized and IDF-weighted.
   * Comparable within one result set only — do not threshold on it.
   */
  score: number;
}

/**
 * BM25 parameters, at the values the literature uses as defaults. `k1` sets how
 * fast repeated occurrences of a term stop adding score; `b` how strongly to
 * normalize for document length (1 = fully, 0 = not at all).
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;
/**
 * How much a match in the document NAME counts relative to one in the body.
 * Preserved from the previous scoring, where it was a flat ×5 per occurrence.
 */
const NAME_WEIGHT = 5;

/** BM25 term-frequency saturation with length normalization. */
function saturate(tf: number, length: number, averageLength: number): number {
  if (tf === 0) return 0;
  const norm = 1 - BM25_B + BM25_B * (averageLength > 0 ? length / averageLength : 1);
  return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm);
}

/**
 * Rank candidates by lexical relevance to the query (document name AND body —
 * name weighted higher) and return ONLY the documents that actually matched at
 * least one query term, best first. Unlike selectRelevantDocuments this never
 * pads with non-matching documents, so callers can treat the result as the
 * authoritative set of "documents related to this query" — e.g. to surface all
 * similar documents to the user instead of a single guessed source.
 */
export function rankDocuments<T extends RetrievableDoc>(
  candidates: T[],
  query: string
): RankedDoc<T>[] {
  const terms = Array.from(new Set(tokenize(query)));
  if (terms.length === 0) return [];

  // Normalize once per document, not once per (document, term).
  const prepared = candidates.map((doc) => {
    const nameNorm = normalize(doc.name || '');
    const contentNorm = normalize(doc.content || '');
    return { doc, nameNorm, contentNorm };
  });

  // Length in characters rather than tokens: a deliberate approximation. It
  // needs no second tokenization pass over the whole corpus per query, and for
  // length NORMALIZATION (a ratio against the mean) the two track each other
  // closely enough that the ranking does not change.
  const averageContentLength =
    prepared.reduce((sum, p) => sum + p.contentNorm.length, 0) / (prepared.length || 1);
  const averageNameLength =
    prepared.reduce((sum, p) => sum + p.nameNorm.length, 0) / (prepared.length || 1);

  // Occurrence counts, plus the document frequency each term's IDF needs.
  const counts = prepared.map((p) => {
    const perTerm = terms.map((term) => ({
      name: countOccurrences(p.nameNorm, term),
      content: countOccurrences(p.contentNorm, term),
    }));
    return perTerm;
  });
  const documentFrequency = terms.map((_, termIndex) =>
    counts.reduce((n, perTerm) => n + (perTerm[termIndex].name + perTerm[termIndex].content > 0 ? 1 : 0), 0)
  );

  const total = prepared.length;
  // Standard BM25 IDF, in the form that stays positive for every df — the
  // classic (N - df + 0.5)/(df + 0.5) goes negative once a term appears in more
  // than half the corpus, which would let a common word subtract score.
  const idf = documentFrequency.map((df) => Math.log(1 + (total - df + 0.5) / (df + 0.5)));

  return prepared
    .map((p, docIndex) => {
      let score = 0;
      for (let t = 0; t < terms.length; t++) {
        const { name, content } = counts[docIndex][t];
        if (name === 0 && content === 0) continue;
        score +=
          idf[t] *
          (saturate(content, p.contentNorm.length, averageContentLength) +
            NAME_WEIGHT * saturate(name, p.nameNorm.length, averageNameLength));
      }
      return { doc: p.doc, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Build a short, human-readable excerpt of a document's content centered on the
 * first matched query term, so the user can see WHY a document was retrieved
 * (and disambiguate between several similar matches). Falls back to the head of
 * the document when no term is located. Matching preserves accents/length so
 * the returned excerpt reads naturally.
 */
export function buildSnippet(
  content: string | null | undefined,
  query: string,
  maxLen = 180
): string {
  const text = (content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  const rawTerms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((tk) => tk.length >= 3 && !STOPWORDS.has(tk))
    )
  );

  let pos = -1;
  for (const term of rawTerms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }

  if (pos === -1) {
    return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
  }

  const start = Math.max(0, pos - Math.floor(maxLen / 3));
  const end = Math.min(text.length, start + maxLen);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

/**
 * Rank candidate documents against the query and return the top matches,
 * bounded by maxDocs and total maxChars. Per-document content is truncated to
 * maxCharsPerDoc. If no document scores above zero, the first maxDocs
 * candidates are returned so the model still has something to ground on.
 */
export function selectRelevantDocuments<T extends RetrievableDoc>(
  candidates: T[],
  query: string,
  options: RetrievalOptions = {}
): T[] {
  const { maxDocs, maxChars, maxCharsPerDoc } = { ...DEFAULTS, ...options };

  const matched = rankDocuments(candidates, query);
  const ranked = matched.length > 0
    ? matched
    : candidates.map((doc) => ({ doc, score: 0 })); // no lexical hits → weak fallback

  const selected: T[] = [];
  let usedChars = 0;
  for (const { doc } of ranked) {
    if (selected.length >= maxDocs) break;
    const full = doc.content || '';
    if (usedChars >= maxChars) break;
    const remaining = maxChars - usedChars;
    const budget = Math.min(maxCharsPerDoc, remaining);
    const clipped = full.length > budget ? full.slice(0, budget) : full;
    usedChars += clipped.length;
    selected.push({ ...doc, content: clipped });
  }
  return selected;
}
