/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boundary-aware document chunking.
 *
 * Until now every ingestion path wrote exactly ONE chunk row per document
 * holding the document's entire body, which made `kb_document_chunks` a copy of
 * `kb_documents.content` rather than a retrieval unit. Embedding a whole
 * document into a single vector washes out every specific passage in it, so
 * semantic search needs real chunks first.
 *
 * The splitter is structural rather than token-exact: it groups the text into
 * blocks (fenced code, tables, paragraphs, lines) and packs whole blocks into
 * chunks, only falling back to sentence / word / hard slicing when a single
 * block is itself oversized. Fenced code blocks and markdown tables are kept
 * cohesive, as `docs/RAG.md` §1 requires.
 *
 * Sizes are in characters, not tokens: a tokenizer would be another dependency
 * and the ~4 chars/token heuristic is accurate enough to size a budget.
 */

export interface ChunkOptions {
  /** Preferred chunk size in characters (~500 tokens at 4 chars/token). */
  targetChars?: number;
  /**
   * Hard ceiling for a chunk. A block larger than this is split internally;
   * below it, an oversized-but-cohesive block is kept whole.
   */
  maxChars?: number;
  /** Characters of the previous chunk repeated at the head of the next one. */
  overlapChars?: number;
}

export const CHUNK_DEFAULTS: Required<ChunkOptions> = {
  targetChars: 2_000,
  maxChars: 3_000,
  overlapChars: 200,
};

export interface TextChunk {
  /** 0-based position of the chunk within the document. */
  index: number;
  /** Chunk body, including any overlap carried from the previous chunk. */
  content: string;
  /** Nearest preceding markdown heading, if the document has any. */
  section?: string;
  /** ~4 chars per token. Approximate by design — see module comment. */
  estimatedTokenCount: number;
}

interface Block {
  text: string;
  /** Heading in effect when this block starts. */
  section?: string;
  /** Never split internally and never merged with a neighbour. */
  atomic: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const TABLE_ROW_RE = /^\s*\|/;

/**
 * Group the raw text into structural blocks, tracking the heading in effect so
 * each chunk can report the section it came from.
 */
function toBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let section: string | undefined;
  let buffer: string[] = [];

  const flushParagraph = () => {
    const joined = buffer.join('\n').trim();
    buffer = [];
    if (joined) blocks.push({ text: joined, section, atomic: false });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      flushParagraph();
      // Consume through the closing fence (or EOF for an unterminated block).
      const fence = line.trim().slice(0, 3);
      const collected = [line];
      i++;
      while (i < lines.length) {
        collected.push(lines[i]);
        if (lines[i].trim().startsWith(fence)) break;
        i++;
      }
      blocks.push({ text: collected.join('\n'), section, atomic: true });
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      flushParagraph();
      const collected: string[] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        collected.push(lines[i]);
        i++;
      }
      i--; // the loop's i++ re-reads the first non-table line
      blocks.push({ text: collected.join('\n'), section, atomic: true });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      section = heading[2];
      blocks.push({ text: line.trim(), section, atomic: false });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    buffer.push(line);
  }
  flushParagraph();
  return blocks;
}

/**
 * Split a single oversized block into pieces of at most maxChars, preferring
 * sentence ends, then line breaks, then whitespace, and hard-slicing only when
 * the text offers no break at all (e.g. a base64 blob).
 */
function splitOversized(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // Look for a break in the last third of the window, so pieces stay large.
    const floor = Math.floor(maxChars * 0.6);
    let cut = -1;
    for (const re of [/[.!?…](?=\s|$)/g, /\n/g, /\s/g]) {
      let m: RegExpExecArray | null;
      let last = -1;
      while ((m = re.exec(window)) !== null) {
        if (m.index >= floor) last = m.index + m[0].length;
      }
      if (last > 0) { cut = last; break; }
    }
    if (cut <= 0) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  const tail = rest.trim();
  if (tail) pieces.push(tail);
  return pieces.filter(Boolean);
}

/** Tail of `text` of about `chars` characters, snapped to a word boundary. */
function overlapTail(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return text.trim();
  const tail = text.slice(text.length - chars);
  const boundary = tail.search(/\s/);
  return (boundary === -1 ? tail : tail.slice(boundary + 1)).trim();
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split a document body into overlapping, boundary-aware chunks. Returns an
 * empty array for blank content so callers never persist empty chunk rows.
 */
export function chunkText(content: string, options: ChunkOptions = {}): TextChunk[] {
  const { targetChars, maxChars, overlapChars } = { ...CHUNK_DEFAULTS, ...options };
  const text = (content || '').trim();
  if (!text) return [];

  // Pre-split blocks that exceed the hard ceiling, so packing only ever deals
  // with blocks that can fit in a chunk on their own.
  const blocks: Block[] = [];
  for (const block of toBlocks(text)) {
    if (block.text.length <= maxChars) {
      blocks.push(block);
      continue;
    }
    // An atomic block over the ceiling can't be kept whole; splitting it is
    // the lesser evil versus emitting a chunk no provider will accept.
    for (const piece of splitOversized(block.text, maxChars)) {
      blocks.push({ text: piece, section: block.section, atomic: block.atomic });
    }
  }

  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let currentSection: string | undefined;
  let carry = '';

  const flush = () => {
    const body = current.join('\n\n').trim();
    current = [];
    currentLen = 0;
    if (!body) return;
    const withCarry = carry ? `${carry}\n\n${body}` : body;
    chunks.push({
      index: chunks.length,
      content: withCarry,
      section: currentSection,
      estimatedTokenCount: estimateTokens(withCarry),
    });
    carry = overlapTail(body, overlapChars);
    currentSection = undefined;
  };

  for (const block of blocks) {
    // Adding this block would overflow the target — close the current chunk
    // first, unless it is still empty (a single block always gets a chunk).
    if (currentLen > 0 && currentLen + block.text.length + 2 > targetChars) flush();
    if (currentSection === undefined) currentSection = block.section;
    current.push(block.text);
    currentLen += block.text.length + 2;
  }
  flush();

  return chunks;
}

export interface ChunkRow {
  id: string;
  versionId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  section: string | null;
  estimatedTokenCount: number;
  futureEmbeddingStatus: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Build the `kb_document_chunks` rows for a document body. Ids stay
 * deterministic (`<versionId>_c<index>`) so a re-ingest of the same version
 * overwrites its own rows instead of accumulating duplicates.
 *
 * Chunks are written with `futureEmbeddingStatus: 'pending'`; the embedding
 * backfill (src/server/embeddings.ts) picks them up from there, so ingestion
 * never blocks on a provider call.
 */
export function buildChunkRows(
  documentId: string,
  versionId: string,
  content: string,
  now: string,
  tenantId = 'tenant_default',
  options: ChunkOptions = {}
): ChunkRow[] {
  return chunkText(content, options).map((chunk) => ({
    id: `${versionId}_c${chunk.index}`,
    versionId,
    documentId,
    chunkIndex: chunk.index,
    content: chunk.content,
    section: chunk.section ?? null,
    estimatedTokenCount: chunk.estimatedTokenCount,
    futureEmbeddingStatus: 'pending',
    tenantId,
    createdAt: now,
    updatedAt: now,
  }));
}
