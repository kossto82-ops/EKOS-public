import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * Coverage for the semantic half of retrieval: the vector store and the RRF
 * fusion on top of it.
 *
 * The embedding provider is stubbed with a deterministic bag-of-concepts
 * embedder — CI must never make a network call, and a real provider would make
 * these assertions flaky. The stub maps known synonyms (including across
 * languages) onto the same dimension, which is exactly the behaviour the
 * lexical ranker cannot reproduce and therefore the thing worth testing:
 * a query that shares NO tokens with a document must still retrieve it.
 */

/** Concept id per surface form. Synonyms deliberately collide. */
const CONCEPTS: Record<string, number> = {
  refund: 0, refunds: 0, reembolso: 0, reembolsos: 0, devolucion: 0,
  cancellation: 1, cancel: 1, cancelacion: 1, baja: 1,
  availability: 2, uptime: 2, disponibilidad: 2,
  onboarding: 3, induction: 3, incorporacion: 3,
  invoice: 4, billing: 4, factura: 4, facturacion: 4,
};
const DIMENSIONS = 8;

function fakeEmbed(text: string): number[] {
  const vector = new Array(DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const token of tokens) {
    const concept = CONCEPTS[token];
    if (concept !== undefined) vector[concept] += 1;
    // Unknown tokens land in a shared bucket so unrelated text is not identical
    // to the zero vector (which would score 0 against everything).
    else vector[DIMENSIONS - 1] += 0.05;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return magnitude === 0 ? vector : vector.map((v) => v / magnitude);
}

/** Flipped by individual tests to simulate an unconfigured/failing provider. */
const providerState = { available: true };

vi.mock('../src/server/embeddings.ts', async () => {
  class EmbeddingsUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'EmbeddingsUnavailableError';
    }
  }
  const config = { provider: 'custom', model: 'test-embedder', dimensions: DIMENSIONS };
  const signature = 'custom:test-embedder:8';
  return {
    EmbeddingsUnavailableError,
    resolveEmbeddingConfig: () => (providerState.available ? config : null),
    embeddingSignature: () => signature,
    currentEmbeddingSignature: () => (providerState.available ? signature : null),
    normalizeVector: (v: number[]) => v,
    embedTexts: async (texts: string[]) => {
      if (!providerState.available) throw new EmbeddingsUnavailableError('No embedding provider configured.');
      return texts.map(fakeEmbed);
    },
    embedQuery: async (query: string) => {
      if (!providerState.available) throw new EmbeddingsUnavailableError('No embedding provider configured.');
      return fakeEmbed(query);
    },
  };
});

const { createTestApp } = await import('./testApp.ts');
const { db } = await import('../src/db/db.ts');
const { kbDocuments, kbDocumentChunks } = await import('../src/db/schema.ts');
const { upsertKbDocuments } = await import('../src/server/sharepoint/ingest.ts');
const { backfillEmbeddings, embeddingCoverage, invalidateVectorCache, searchChunks } = await import(
  '../src/server/vectorStore.ts'
);
const { hybridRetrieve } = await import('../src/server/hybridRetrieval.ts');

interface Doc { id: string; name: string; content: string; scope?: string }

// Ingested through the real SharePoint upsert path so the chunk rows under test
// are the ones production actually writes (ids, links, pending status included).
const SOURCES = [
  {
    id: 'refund',
    content: 'Customers may request a refund within 14 days. Late cancellation is handled by finance.',
  },
  {
    id: 'uptime',
    content: 'Monthly availability targets and the credits issued when uptime drops below target.',
  },
  {
    id: 'onboarding',
    content: 'New agent onboarding covers the tooling induction and the first week schedule.',
  },
];

const DOC_ID = Object.fromEntries(SOURCES.map((s) => [s.id, `sp_${s.id}`])) as Record<string, string>;
let DOCS: Doc[] = [];

beforeAll(async () => {
  createTestApp(); // initializes the in-memory test DB schema
  upsertKbDocuments(
    SOURCES.map((source) => ({
      id: source.id,
      uri: `file:///drive/${source.id}`,
      name: `${source.id}.md`,
      folderPath: '',
      topFolder: '',
      fileType: 'md',
      content: source.content,
      truncated: false,
      frontmatter: {},
      lastModified: '2026-08-05T00:00:00Z',
    })) as any,
    '2026-08-05T00:00:00Z'
  );
  DOCS = db
    .select()
    .from(kbDocuments)
    .all()
    .filter((row: any) => Object.values(DOC_ID).includes(row.id)) as unknown as Doc[];
  expect(DOCS).toHaveLength(SOURCES.length);
  await backfillEmbeddings({ force: true });
});

beforeEach(() => {
  providerState.available = true;
  invalidateVectorCache();
});

describe('backfillEmbeddings', () => {
  it('writes a vector, model and signature for every chunk', () => {
    const rows = db.select().from(kbDocumentChunks).all() as any[];
    expect(rows.length).toBe(DOCS.length);
    for (const row of rows) {
      expect(row.futureEmbeddingStatus).toBe('generated');
      expect(row.embeddingVersion).toBe('custom:test-embedder:8');
      expect(row.embeddingModel).toBe('test-embedder');
      expect(JSON.parse(row.embedding)).toHaveLength(8);
    }
  });

  it('reports honest coverage', () => {
    const coverage = embeddingCoverage();
    expect(coverage.total).toBe(DOCS.length);
    expect(coverage.embedded).toBe(DOCS.length);
    expect(coverage.signature).toBe('custom:test-embedder:8');
  });

  it('re-embeds nothing on a second run when the signature is unchanged', async () => {
    const result = await backfillEmbeddings();
    expect(result.embedded).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('searchChunks', () => {
  it('ranks the semantically closest chunk first', async () => {
    const { embedQuery } = await import('../src/server/embeddings.ts');
    const hits = searchChunks(await embedQuery('reembolso'), { limit: 3 });
    expect(hits[0].documentId).toBe(DOC_ID.refund);
  });

  it('honours the documentIds scope — an out-of-scope chunk is never returned', async () => {
    const { embedQuery } = await import('../src/server/embeddings.ts');
    const hits = searchChunks(await embedQuery('reembolso'), {
      documentIds: new Set([DOC_ID.uptime, DOC_ID.onboarding]),
    });
    expect(hits.every((hit) => hit.documentId !== DOC_ID.refund)).toBe(true);
  });
});

describe('hybridRetrieve', () => {
  it('retrieves a document that shares NO tokens with the query', async () => {
    // "reembolso" appears nowhere in the corpus — lexical scoring is 0 for
    // every document, so only the semantic side can find this.
    const lexicalOnly = (await import('../src/server/retrieval.ts')).rankDocuments(DOCS, 'reembolso');
    expect(lexicalOnly).toHaveLength(0);

    const result = await hybridRetrieve(DOCS, 'reembolso');
    expect(result.mode).toBe('hybrid');
    expect(result.ranked[0]?.doc.id).toBe(DOC_ID.refund);
    expect(result.ranked[0]?.lexicalScore).toBe(0);
    expect(result.ranked[0]?.vectorScore).toBeGreaterThan(0);
  });

  it('drops weak semantic hits relative to the best chunk for the query', async () => {
    // An absolute cosine floor is worthless when a model compresses its scores
    // (measured with bge-m3: min 0.31, median 0.44, best 0.69 — a 0.3 floor
    // admitted every chunk). The cut has to be relative to the query's best hit.
    // minVectorScore: 0 in both, so the relative floor is the only filter under
    // test — which is the point: it must work without an absolute threshold.
    const loose = await hybridRetrieve(DOCS, 'reembolso', { minVectorScore: 0, vectorRelativeFloor: 0 });
    const tight = await hybridRetrieve(DOCS, 'reembolso', { minVectorScore: 0, vectorRelativeFloor: 0.9 });
    expect(tight.ranked.length).toBeLessThan(loose.ranked.length);
    expect(tight.ranked[0]?.doc.id).toBe(DOC_ID.refund);
    // The unrelated documents that scraped in on residual similarity are gone.
    expect(tight.ranked.some((entry) => entry.doc.id === DOC_ID.onboarding)).toBe(false);
  });

  it('breaks an RRF tie on evidence, not on insertion order', async () => {
    // Both documents are rank 1 in exactly one retriever, so their RRF scores
    // are identical. Before the explicit tie-break, `sort` stability handed the
    // win to whichever list was merged first — always the lexical one — which
    // on the real corpus put a 4-term incidental match above a 0.686 cosine hit.
    const lexicalOnlyDoc: Doc = {
      id: 'doc_rare_token',
      name: 'Rare Token Register.pdf',
      // 'zebracode7' is unknown to the embedder, so this document is reachable
      // lexically but carries no semantic signal for the query.
      content: 'The identifier zebracode7 is recorded here with no other context.',
    };
    const candidates = [...DOCS, lexicalOnlyDoc];

    const result = await hybridRetrieve(candidates, 'zebracode7 reembolso');
    const rare = result.ranked.find((entry) => entry.doc.id === 'doc_rare_token');
    const refund = result.ranked.find((entry) => entry.doc.id === DOC_ID.refund);
    expect(rare).toBeDefined();
    expect(refund).toBeDefined();
    // Identical fused score...
    expect(refund!.score).toBeCloseTo(rare!.score, 10);
    // ...resolved toward the calibrated signal, not the arbitrary one.
    expect(result.ranked[0].doc.id).toBe(DOC_ID.refund);
    expect(rare!.lexicalScore).toBeGreaterThan(0);
    expect(rare!.vectorScore).toBeUndefined();
  });

  it('still ranks exact lexical matches, fusing both signals', async () => {
    const result = await hybridRetrieve(DOCS, 'onboarding induction');
    expect(result.ranked[0]?.doc.id).toBe(DOC_ID.onboarding);
    expect(result.ranked[0]?.lexicalScore).toBeGreaterThan(0);
  });

  it('grounds on the matched passages, tagged with their source document', async () => {
    const result = await hybridRetrieve(DOCS, 'reembolso');
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.passages[0].documentId).toBe(DOC_ID.refund);
    expect(result.passages[0].content).toContain('refund');
  });

  it('never returns a document outside the candidate set', async () => {
    const result = await hybridRetrieve(DOCS.filter((doc) => doc.id !== DOC_ID.refund), 'reembolso');
    expect(result.ranked.every((entry) => entry.doc.id !== DOC_ID.refund)).toBe(true);
    expect(result.passages.every((p) => p.documentId !== DOC_ID.refund)).toBe(true);
  });

  it('degrades to lexical-only — and says so — when the provider is unavailable', async () => {
    providerState.available = false;
    const result = await hybridRetrieve(DOCS, 'refund');
    expect(result.mode).toBe('lexical');
    expect(result.degradedReason).toContain('No embedding provider configured');
    // Search still works: the lexical side alone found the document.
    expect(result.ranked[0]?.doc.id).toBe(DOC_ID.refund);
    expect(result.passages.length).toBeGreaterThan(0);
  });

  it('returns nothing — not padding — when nothing matches and padding is off', async () => {
    providerState.available = false;
    const result = await hybridRetrieve(DOCS, 'zzzznonexistentterm');
    expect(result.ranked).toHaveLength(0);
    expect(result.passages).toHaveLength(0);
  });

  it('pads the grounding context without inventing citations when asked', async () => {
    providerState.available = false;
    const result = await hybridRetrieve(DOCS, 'zzzznonexistentterm', { padWhenEmpty: true });
    // Padding feeds the model, but `ranked` stays empty so no source is cited.
    expect(result.ranked).toHaveLength(0);
    expect(result.passages.length).toBeGreaterThan(0);
  });

  it('applies a reranker before assembling passages, and re-asserts scoping', async () => {
    const result = await hybridRetrieve(DOCS, 'refund availability', {
      rerank: async (ranked) => [
        // Reverse the order, and try to smuggle in an unscoped document.
        ...ranked.slice().reverse(),
        { doc: { id: 'doc_secret', name: 'Secret.pdf', content: 'leaked' }, score: 99, lexicalScore: 99, snippet: '' },
      ],
    });
    expect(result.ranked.some((entry) => entry.doc.id === 'doc_secret')).toBe(false);
    expect(result.passages.every((p) => p.documentId !== 'doc_secret')).toBe(true);
    // The reranked order drives grounding, not just the citation list.
    expect(result.passages[0].documentId).toBe(result.ranked[0].doc.id);
  });
});
