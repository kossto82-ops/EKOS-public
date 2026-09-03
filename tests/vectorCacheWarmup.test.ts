import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp } from './testApp.ts';
import { invalidateVectorCache, warmVectorCache } from '../src/server/vectorStore.ts';
import { warmEmbeddingProvider } from '../src/server/embeddings.ts';

/**
 * The vector cache was built lazily, on whoever searched first.
 * `warmVectorCache()` moves that to startup and to the end of a backfill.
 *
 * Worth recording what the measurement actually said, since it contradicted the
 * hypothesis that motivated the change: the load is ~77ms for 685 vectors, not
 * the seconds first attributed to it. The first search after a boot really is
 * slower than later ones, but that residue survives prewarming and is something
 * else — most likely the embedding provider's first call.
 *
 * So these tests pin the contract the callers depend on, and claim nothing about
 * speed: it reports what it did, it is safe when no embedding provider exists at
 * all, and it NEVER throws — a cache that fails to prewarm must fall back to the
 * lazy path, not stop the server from booting.
 */
beforeAll(() => {
  createTestApp(); // initializes the in-memory test DB schema
});

describe('warmVectorCache', () => {
  it('reports honestly when no embedding provider is configured', () => {
    // The test database has no ai_embedding_config row, which is also the state
    // of any deployment that never set one up.
    const result = warmVectorCache();
    expect(result.warmed).toBe(false);
    expect(result.vectors).toBe(0);
    expect(result.reason).toBeTruthy();
  });

  it('never throws, and is safe to call repeatedly', () => {
    expect(() => {
      warmVectorCache();
      invalidateVectorCache();
      warmVectorCache();
    }).not.toThrow();
  });

  it('always reports a duration the caller can log', () => {
    const result = warmVectorCache();
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * The warmup that actually addresses the slow first search. Measured against the
 * configured endpoint, the provider's first embedding call took 2265ms and the
 * next four 318-383ms; that gap is the whole of it. It covers the restart case
 * only — the endpoint also unloads its model on an idle timer (7 minutes quiet
 * -> 3452ms), which is fixed where the model runs, not here.
 *
 * Same contract as above, and one property that matters more here because this
 * one leaves the machine: an unreachable or misconfigured provider must resolve
 * to a reported failure, never a rejected promise. It is invoked fire-and-forget
 * from the listen callback, where an unhandled rejection would take the process
 * down at exactly the moment the provider is already having a bad day.
 */
describe('warmEmbeddingProvider', () => {
  it('resolves (never rejects) when no embedding provider is configured', async () => {
    const result = await warmEmbeddingProvider();
    expect(result.warmed).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(typeof result.durationMs).toBe('number');
  });

  it('makes no provider call at all when nothing is configured', async () => {
    // Nothing to reach means nothing to wait for: this must be a local decision,
    // not a network timeout, or boot-time logging would stall on a dead endpoint.
    const at = Date.now();
    await warmEmbeddingProvider();
    expect(Date.now() - at).toBeLessThan(500);
  });
});
