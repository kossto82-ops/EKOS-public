import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

/**
 * `/api/search` measured its own wall clock from the start and reported it as
 * `retrievalLatencyMs` — a name that describes a third of what it counts — and
 * the client threw even that away. So "search feels slow" had no evidence
 * behind it and no way to separate a slow provider from slow retrieval, which
 * are two problems with completely different fixes.
 *
 * The response now carries a per-stage breakdown. These tests pin that it is
 * present, internally consistent, and — the case that matters most — still
 * reported when the provider call FAILS, because the slowest searches a user
 * ever experiences are the ones that end in the fallback.
 */
const LLM_DELAY_MS = 40;
/**
 * Timers do not guarantee they slept AT LEAST the requested time as measured by
 * a different clock: a 40ms setTimeout measured 39ms on the CI runner and failed
 * a `>= 40` assertion. What these tests are actually about is ATTRIBUTION — that
 * the provider call lands in llmMs rather than in another stage — so the floor
 * only has to be far enough above the other stages to prove that, and pinning it
 * to the exact sleep buys nothing but a flake.
 */
const LLM_FLOOR_MS = LLM_DELAY_MS / 2;
let failNext = false;

vi.mock('../src/server/aiClient.ts', () => ({
  callAI: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, LLM_DELAY_MS));
    if (failNext) throw new Error('Simulated provider outage');
    return JSON.stringify({
      id: 'ans_timing',
      title: 'T',
      summary: 'S',
      content: '## Section\n\n1. Step one',
      confidenceScore: 90,
      sources: [],
      status: 'verified',
      answerType: 'procedure',
      businessDomain: 'Operations',
      lastUpdated: '2026-08-07T00:00:00.000Z',
      reviewOwner: 'Ops',
    });
  }),
}));

const { createTestApp, authHeader } = await import('./testApp.ts');
const ADMIN = authHeader('u1');
let app: any;

beforeAll(() => {
  app = createTestApp();
});

async function search() {
  const res = await request(app).post('/api/search').set(...ADMIN).send({ query: 'How do I configure TOTP?' });
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('POST /api/search — timing breakdown', () => {
  it('reports every stage of the request', async () => {
    failNext = false;
    const { timings } = await search();
    for (const key of ['candidatesMs', 'retrievalMs', 'llmMs', 'totalMs']) {
      expect(typeof timings[key]).toBe('number');
      expect(timings[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it('attributes the provider call to llmMs, and keeps the total above it', async () => {
    failNext = false;
    const { timings, retrievalLatencyMs } = await search();
    // The mocked provider sleeps, so this stage cannot be mistaken for the others.
    expect(timings.llmMs).toBeGreaterThanOrEqual(LLM_FLOOR_MS);
    expect(timings.llmMs).toBeGreaterThan(timings.candidatesMs);
    expect(timings.totalMs).toBeGreaterThanOrEqual(timings.llmMs);
    expect(timings.totalMs).toBeGreaterThanOrEqual(timings.candidatesMs + timings.retrievalMs);
    // retrievalLatencyMs is the same whole-handler number, kept for older clients.
    expect(retrievalLatencyMs).toBe(timings.totalMs);
  });

  it('still reports how long a FAILED provider call took', async () => {
    failNext = true;
    const data = await search();
    // The fallback answer, honestly labelled — and still timed.
    expect(data.retrievalSource).toBe('local_fallback');
    expect(data.timings.llmMs).toBeGreaterThanOrEqual(LLM_FLOOR_MS);
    expect(data.timings.totalMs).toBeGreaterThanOrEqual(data.timings.llmMs);
    failNext = false;
  });
});
