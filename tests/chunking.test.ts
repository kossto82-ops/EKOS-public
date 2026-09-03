import { describe, it, expect } from 'vitest';
import { buildChunkRows, chunkText, CHUNK_DEFAULTS } from '../src/server/chunking.ts';

/**
 * Coverage for the chunker that replaced "one chunk row per document".
 *
 * The properties that matter for retrieval quality are: chunks stay inside the
 * size ceiling (or the provider rejects them), consecutive chunks overlap (or a
 * fact spanning a boundary becomes unretrievable), and code/tables are not cut
 * in half (or the retrieved passage is unreadable).
 */

const paragraph = (word: string, times: number) => `${`${word} `.repeat(times).trim()}.`;

describe('chunkText', () => {
  it('returns nothing for blank content, so no empty chunk rows are ever written', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkText('A short policy note about refunds.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toContain('refunds');
  });

  it('splits a long document and keeps every chunk within the hard ceiling', () => {
    const body = Array.from({ length: 20 }, (_, i) => paragraph(`para${i}`, 60)).join('\n\n');
    const chunks = chunkText(body);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_DEFAULTS.maxChars + CHUNK_DEFAULTS.overlapChars);
    }
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('overlaps consecutive chunks so a fact on a boundary stays retrievable', () => {
    const body = Array.from({ length: 12 }, (_, i) => paragraph(`block${i}`, 60)).join('\n\n');
    const chunks = chunkText(body);
    expect(chunks.length).toBeGreaterThan(1);

    // The head of chunk N+1 repeats the tail of chunk N.
    const previousTail = chunks[0].content.slice(-CHUNK_DEFAULTS.overlapChars / 2);
    const overlapWord = previousTail.trim().split(/\s+/).pop()!;
    expect(chunks[1].content).toContain(overlapWord);
  });

  it('never splits a fenced code block across chunks', () => {
    const code = ['```json', ...Array.from({ length: 40 }, (_, i) => `  "key${i}": "value${i}",`), '```'].join('\n');
    const body = `${paragraph('intro', 200)}\n\n${code}\n\n${paragraph('outro', 200)}`;
    const chunks = chunkText(body);

    const withFence = chunks.filter((c) => c.content.includes('```json'));
    expect(withFence).toHaveLength(1);
    // Opening and closing fence land in the same chunk.
    expect(withFence[0].content.match(/```/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a markdown table cohesive', () => {
    const table = ['| Plan | Price |', '| --- | --- |', ...Array.from({ length: 30 }, (_, i) => `| plan${i} | ${i}0 EUR |`)].join('\n');
    const body = `${paragraph('intro', 150)}\n\n${table}\n\n${paragraph('outro', 150)}`;
    const chunks = chunkText(body);

    const withTable = chunks.filter((c) => c.content.includes('| plan0 |'));
    expect(withTable).toHaveLength(1);
    expect(withTable[0].content).toContain('| plan29 |');
  });

  it('tags each chunk with the heading it sits under', () => {
    const body = [
      '# Refunds',
      paragraph('refundtext', 300),
      '## Escalation',
      paragraph('escalationtext', 300),
    ].join('\n\n');
    const chunks = chunkText(body);
    const sections = chunks.map((c) => c.section);
    expect(sections).toContain('Refunds');
    expect(sections.some((s) => s === 'Escalation')).toBe(true);
  });

  it('splits an oversized single block rather than emitting a chunk no provider accepts', () => {
    // One unbroken paragraph, far past the ceiling, with no blank lines.
    const chunks = chunkText(paragraph('runon', 2_000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_DEFAULTS.maxChars + CHUNK_DEFAULTS.overlapChars);
    }
  });
});

describe('buildChunkRows', () => {
  it('produces deterministic ids so a re-ingest overwrites instead of duplicating', () => {
    const first = buildChunkRows('doc_1', 'ver_doc_1_1_0', 'Some content here.', '2026-08-05T00:00:00Z');
    const second = buildChunkRows('doc_1', 'ver_doc_1_1_0', 'Some content here.', '2026-08-06T00:00:00Z');
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
    expect(first[0].id).toBe('ver_doc_1_1_0_c0');
  });

  it('links every chunk to its document and marks it pending for the embedding backfill', () => {
    const body = Array.from({ length: 6 }, (_, i) => paragraph(`body${i}`, 100)).join('\n\n');
    const rows = buildChunkRows('doc_2', 'ver_doc_2_1_0', body, '2026-08-05T00:00:00Z');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.documentId).toBe('doc_2');
      expect(row.futureEmbeddingStatus).toBe('pending');
      expect(row.estimatedTokenCount).toBeGreaterThan(0);
    }
  });

  it('writes no rows for an empty document', () => {
    expect(buildChunkRows('doc_3', 'ver_doc_3_1_0', '   ', '2026-08-05T00:00:00Z')).toEqual([]);
  });
});
