import { describe, it, expect } from 'vitest';
import { rankDocuments, buildSnippet, selectRelevantDocuments } from '../src/server/retrieval';

/**
 * Coverage for the server-side lexical retrieval that backs POST /api/search.
 *
 * These guard the fix for a real usability bug: search used to return a single
 * (LLM-guessed) source by title, so a query whose terms live in a document's
 * BODY — or that matches several similar documents — surfaced the wrong doc or
 * only one. rankDocuments must (a) match on content, not just the name, and
 * (b) return EVERY genuine match, ranked, so the UI can show all related docs.
 */
const DOCS = [
  {
    id: 'doc_refund',
    name: 'Refund Policy and Cancellation SOP.pdf',
    content: 'Customers may request a refund within 14 days. Prorated credits apply for mid-cycle cancellations.',
  },
  {
    id: 'doc_refund_addendum',
    name: 'Billing Handbook',
    // No "refund" in the NAME — only in the body. Title-only search would miss this.
    content: 'Section 9 covers the refund workflow and how a refund is escalated to finance.',
  },
  {
    id: 'doc_sla',
    name: 'SLA Compensation Scheme',
    content: 'Service credits are issued when monthly availability drops below target.',
  },
];

describe('rankDocuments (src/server/retrieval.ts)', () => {
  it('matches on document body, not only the title', () => {
    const ranked = rankDocuments(DOCS, 'refund');
    const ids = ranked.map((r) => r.doc.id);
    // Both the titled doc AND the body-only doc must be returned.
    expect(ids).toContain('doc_refund');
    expect(ids).toContain('doc_refund_addendum');
    // The unrelated SLA doc must not appear (it never mentions refund).
    expect(ids).not.toContain('doc_sla');
  });

  it('returns ALL genuine matches ranked best-first (not just one)', () => {
    const ranked = rankDocuments(DOCS, 'refund');
    expect(ranked.length).toBeGreaterThan(1);
    // Name match is weighted higher, so the titled doc outranks the body-only one.
    expect(ranked[0].doc.id).toBe('doc_refund');
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it('returns an empty list when nothing matches (honest "no sources")', () => {
    expect(rankDocuments(DOCS, 'zzzznomatch')).toEqual([]);
  });

  it('ignores accents so "desvio" matches "desvío"', () => {
    const docs = [{ id: 'd1', name: 'Desvíos de telefonía', content: 'Configuración de desvío.' }];
    expect(rankDocuments(docs, 'desvio').map((r) => r.doc.id)).toContain('d1');
  });
});

describe('buildSnippet (src/server/retrieval.ts)', () => {
  it('centers the excerpt on the matched term so the user sees why it matched', () => {
    const snippet = buildSnippet(DOCS[1].content, 'refund', 60);
    expect(snippet.toLowerCase()).toContain('refund');
    expect(snippet.length).toBeLessThanOrEqual(62); // maxLen + ellipsis
  });

  it('falls back to the head of the document when no term is located', () => {
    const snippet = buildSnippet('A short document with no query terms here.', 'refund', 20);
    expect(snippet.startsWith('A short document')).toBe(true);
  });

  it('returns an empty string for empty content', () => {
    expect(buildSnippet('', 'refund')).toBe('');
    expect(buildSnippet(null, 'refund')).toBe('');
  });
});

describe('selectRelevantDocuments still grounds (regression)', () => {
  it('prioritizes matches and caps the set', () => {
    const selected = selectRelevantDocuments(DOCS, 'refund', { maxDocs: 2 });
    expect(selected.length).toBeLessThanOrEqual(2);
    expect(selected[0].id).toBe('doc_refund');
  });

  it('falls back to candidates when nothing matches so the model still has context', () => {
    const selected = selectRelevantDocuments(DOCS, 'zzzznomatch');
    expect(selected.length).toBeGreaterThan(0);
  });
});
