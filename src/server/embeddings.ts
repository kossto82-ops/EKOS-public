/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-provider text embeddings.
 *
 * This is the piece that was missing for the platform to do actual
 * retrieval-augmented generation: until now "retrieval" was lexical
 * term-frequency matching, and `kb_document_chunks.embedding` was a placeholder
 * column that nothing ever wrote.
 *
 * Shape mirrors aiClient.ts deliberately — same provider names, same stored
 * config + env-var key resolution, same withTimeout wrapper, same rule that a
 * caller-supplied endpoint never receives a server-held key. The embedding
 * provider is configured independently of the chat provider (`ai_embedding_config`)
 * because they are separate choices: a deployment may chat via Groq, which
 * serves no embedding models, while embedding via Gemini or a local Ollama.
 *
 * Vectors are L2-normalized on the way out, so downstream cosine similarity is
 * a plain dot product (see vectorStore.ts).
 */

import { GoogleGenAI } from '@google/genai';
import { withTimeout } from './aiClient.ts';
import { isMaskedKey, loadStoredProviderConfig, resolveStoredApiKey } from './providerConfig.ts';

export type EmbeddingProvider = 'gemini' | 'openai' | 'custom';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string;
  /** OpenAI-compatible base URL (e.g. an Ollama host) for 'custom'. */
  customEndpointUrl?: string;
  /** Requested output dimensionality, where the provider supports truncation. */
  dimensions?: number;
}

/** Whether the text is a document being indexed or a query being matched. */
export type EmbeddingTaskType = 'document' | 'query';

export const EMBEDDING_TIMEOUT_MS = 30_000;

/** Provider defaults. Kept small and current rather than exhaustive. */
const DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  gemini: 'gemini-embedding-001',
  openai: 'text-embedding-3-small',
  custom: 'nomic-embed-text',
};

/**
 * Per-request batch sizes. Providers cap both item count and total tokens; these
 * are conservative enough to stay under both without a tokenizer.
 */
const BATCH_SIZE: Record<EmbeddingProvider, number> = {
  gemini: 50,
  openai: 96,
  custom: 16,
};

export class EmbeddingsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingsUnavailableError';
  }
}

/**
 * Resolve the embedding configuration from (in order) the caller's overrides,
 * the stored `ai_embedding_config` row, and environment variables.
 *
 * Returns null when no embedding provider is configured at all — callers must
 * treat that as "semantic search is off" and degrade to lexical retrieval,
 * never as an error. A prototype with no key should still answer questions.
 */
export function resolveEmbeddingConfig(overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig | null {
  const stored = loadStoredProviderConfig('ai_embedding_config') || {};

  // SECURITY: same rule as callAI — if the CALLER supplied the endpoint, never
  // resolve a server-held key into a request aimed at it.
  const callerSuppliedEndpoint =
    typeof overrides.customEndpointUrl === 'string' && overrides.customEndpointUrl.trim() !== '';

  const provider = (overrides.provider ||
    stored.provider ||
    process.env.EMBEDDING_PROVIDER) as EmbeddingProvider | undefined;
  if (!provider) return null;
  if (!['gemini', 'openai', 'custom'].includes(provider)) {
    throw new EmbeddingsUnavailableError(`Unsupported embedding provider: ${provider}`);
  }

  const model = overrides.model || stored.model || process.env.EMBEDDING_MODEL || DEFAULT_MODELS[provider];
  const customEndpointUrl = overrides.customEndpointUrl || stored.customEndpointUrl || process.env.EMBEDDING_ENDPOINT_URL;

  let apiKey = isMaskedKey(overrides.apiKey) ? '' : overrides.apiKey || '';
  if (!apiKey && !callerSuppliedEndpoint) {
    apiKey = resolveStoredApiKey(stored.apiKey) || envApiKey(provider);
  }

  const dimensions = overrides.dimensions ?? stored.dimensions ?? numberFromEnv('EMBEDDING_DIMENSIONS');

  return { provider, model, apiKey, customEndpointUrl, dimensions };
}

function envApiKey(provider: EmbeddingProvider): string {
  if (process.env.EMBEDDING_API_KEY) return process.env.EMBEDDING_API_KEY;
  // Fall back to the chat key for the same vendor — one Gemini key normally
  // covers both surfaces, and asking the operator for it twice is friction.
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || '';
  if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
  return '';
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Stable identity of the vector space a stored embedding belongs to. Vectors
 * from different models are NOT comparable — cosine similarity between them is
 * noise — so every stored embedding records this and vector search filters on
 * an exact match against the current config.
 */
export function embeddingSignature(config: EmbeddingConfig): string {
  return `${config.provider}:${config.model}${config.dimensions ? `:${config.dimensions}` : ''}`;
}

/** Signature of the configured embedding space, or null when none is set up. */
export function currentEmbeddingSignature(): string | null {
  try {
    const config = resolveEmbeddingConfig();
    return config ? embeddingSignature(config) : null;
  } catch {
    return null; // a misconfigured provider reads as "no vector index"
  }
}

/** L2-normalize so cosine similarity reduces to a dot product. */
export function normalizeVector(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  // A zero vector has no direction; return it as-is rather than dividing by 0.
  if (!Number.isFinite(magnitude) || magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function embedBatchGemini(
  texts: string[],
  config: EmbeddingConfig,
  taskType: EmbeddingTaskType
): Promise<number[][]> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new EmbeddingsUnavailableError('Missing embedding API key for Gemini.');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });

  const response = await withTimeout(
    ai.models.embedContent({
      model: config.model,
      contents: texts,
      config: {
        // Asymmetric retrieval: documents and queries are embedded with
        // different task hints, which measurably improves recall on models
        // that support it.
        taskType: taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        ...(config.dimensions ? { outputDimensionality: config.dimensions } : {}),
      },
    }),
    EMBEDDING_TIMEOUT_MS,
    'Gemini embedding request'
  );

  const embeddings = response.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Gemini returned ${embeddings.length} embeddings for ${texts.length} inputs.`);
  }
  return embeddings.map((entry) => {
    const values = entry.values;
    if (!values?.length) throw new Error('Gemini returned an empty embedding vector.');
    return values;
  });
}

/** OpenAI and any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, …). */
async function embedBatchOpenAiCompatible(
  texts: string[],
  config: EmbeddingConfig,
  baseUrl: string,
  label: string
): Promise<number[][]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await withTimeout(
    fetch(`${baseUrl.replace(/\/$/, '')}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input: texts,
        ...(config.dimensions ? { dimensions: config.dimensions } : {}),
      }),
    }),
    EMBEDDING_TIMEOUT_MS,
    `${label} embedding request`
  );

  if (!res.ok) {
    throw new Error(`${label} embedding endpoint error: ${await res.text()}`);
  }

  const data: any = await res.json();
  const rows: any[] = data?.data || [];
  if (rows.length !== texts.length) {
    throw new Error(`${label} returned ${rows.length} embeddings for ${texts.length} inputs.`);
  }
  // The API documents index-ordered output, but does not guarantee it; sort
  // defensively so a reordered response can't silently mis-pair vectors with
  // their chunks — a bug that would be invisible until retrieval quality tanked.
  return rows
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((row) => {
      const values = row?.embedding;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`${label} returned an empty embedding vector.`);
      }
      return values as number[];
    });
}

/**
 * Embed a list of texts, batching per provider limits. Returns unit-length
 * vectors in the same order as the input. Throws EmbeddingsUnavailableError
 * when no provider is configured, so callers can distinguish "not set up" from
 * "provider failed".
 */
export async function embedTexts(
  texts: string[],
  taskType: EmbeddingTaskType = 'document',
  overrides: Partial<EmbeddingConfig> = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const config = resolveEmbeddingConfig(overrides);
  if (!config) {
    throw new EmbeddingsUnavailableError(
      'No embedding provider configured. Set one in Settings → AI Provider, or EMBEDDING_PROVIDER.'
    );
  }

  const results: number[][] = [];
  for (const batch of chunkArray(texts, BATCH_SIZE[config.provider])) {
    let vectors: number[][];
    switch (config.provider) {
      case 'gemini':
        vectors = await embedBatchGemini(batch, config, taskType);
        break;
      case 'openai': {
        if (!config.apiKey) throw new EmbeddingsUnavailableError('Missing embedding API key for OpenAI.');
        const baseUrl = config.customEndpointUrl || 'https://api.openai.com';
        vectors = await embedBatchOpenAiCompatible(batch, config, baseUrl, 'OpenAI');
        break;
      }
      case 'custom':
        vectors = await embedBatchOpenAiCompatible(
          batch,
          config,
          config.customEndpointUrl || 'http://localhost:11434',
          'Custom'
        );
        break;
    }
    for (const vector of vectors) results.push(normalizeVector(vector));
  }

  // Mixed dimensionality means the provider silently served more than one model;
  // storing that would poison the index. Refuse rather than corrupt.
  const width = results[0]?.length;
  if (results.some((vector) => vector.length !== width)) {
    throw new Error('Embedding provider returned vectors of inconsistent dimensionality.');
  }
  return results;
}

/** Convenience wrapper for the single-query path. */
export async function embedQuery(
  query: string,
  overrides: Partial<EmbeddingConfig> = {}
): Promise<number[]> {
  const [vector] = await embedTexts([query], 'query', overrides);
  return vector;
}

/**
 * Spend the provider's first-call penalty at startup instead of on a user.
 *
 * Every search embeds its query before it can retrieve anything, and the FIRST
 * embedding call a process makes is far slower than the rest — connection setup,
 * TLS, and for a self-hosted model the load into memory. Measured against the
 * configured endpoint, five consecutive calls:
 *
 *     call 1: 2265 ms      calls 2-5: 318-383 ms
 *
 * That ~1.9s gap is the entire reason the first search after a restart feels
 * slow. It is not the vector cache (77ms, see warmVectorCache) and it is not the
 * model answering; in steady state, retrieval's ~350ms is essentially this call
 * and nothing else.
 *
 * IMPORTANT — this only fixes the FIRST SEARCH AFTER A RESTART, and the problem
 * is bigger than that. The penalty belongs to the endpoint, not to this process:
 * a fresh process found the provider warm at 276ms because an earlier process
 * had already loaded the model. Left alone for seven minutes it goes cold again:
 *
 *     warm 599ms  ->  7 min idle  ->  3452ms  ->  immediately after: 278ms
 *
 * So every time the desk goes a few minutes without searching, the next person
 * pays ~3s. That is a provider-side setting (a self-hosted model server
 * unloading on an idle timer — Ollama's default `keep_alive` is 5 minutes), and
 * the real fix is to keep the model resident there. An interval ping from here
 * would paper over it at the cost of a call every few minutes, forever,
 * including all night. Not done: it is not this process's decision to make.
 *
 * Deliberately fire-and-forget AFTER the server is listening, unlike the vector
 * cache which is warmed before: this is asynchronous network I/O, so it occupies
 * no event-loop time and blocking boot on a provider that might hang would trade
 * a slow first search for a server that never starts. A search issued during the
 * warmup is no worse off than it is today.
 *
 * Costs one embedding of one short string per process start. Never throws: an
 * unreachable provider is already handled on the retrieval path, which degrades
 * to lexical and says so.
 */
export async function warmEmbeddingProvider(): Promise<{ warmed: boolean; durationMs: number; reason?: string }> {
  const startedAt = Date.now();
  try {
    if (!resolveEmbeddingConfig()) {
      return { warmed: false, durationMs: 0, reason: 'No embedding provider configured.' };
    }
    await embedQuery('warmup');
    return { warmed: true, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    return { warmed: false, durationMs: Date.now() - startedAt, reason: err?.message || 'Embedding warmup failed.' };
  }
}
