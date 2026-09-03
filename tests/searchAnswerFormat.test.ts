import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

/**
 * The /api/search prompt used to describe the answer body as nothing more than
 * "content (markdown)". With no structure asked for, the model formatted to
 * taste — and its taste varied with the answer language: the same SOP came back
 * as headed, numbered steps in French and as a wall of prose in the other seven
 * locales. The corpus was never the cause (the documents are uniformly written
 * with `##` sections and numbered procedures) and neither was the renderer (one
 * shared react-markdown/GFM component for every language).
 *
 * So what these tests pin is not "the answer looks nice" — that is the model's
 * output, not ours — but that the SAME structural contract is stated to the
 * model on every request, in every locale, for every document. That is the part
 * that regressed, and the part we control.
 */
const captured: { systemPrompt: string; locale?: string }[] = [];

vi.mock('../src/server/aiClient.ts', () => ({
  callAI: vi.fn(async (_messages: any, systemPrompt: string) => {
    captured.push({ systemPrompt });
    return JSON.stringify({
      id: 'ans_test',
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

async function promptFor(locale?: string): Promise<string> {
  captured.length = 0;
  const res = await request(app).post('/api/search').set(...ADMIN)
    .send({ query: 'How do I configure TOTP?', ...(locale ? { locale } : {}) });
  expect(res.status).toBe(200);
  expect(captured).toHaveLength(1);
  return captured[0].systemPrompt;
}

// Every locale the UI ships (src/locales/), plus the no-locale request.
const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'th'];

describe('POST /api/search — answer formatting contract', () => {
  it('asks for the source document\'s structure, not just "markdown"', async () => {
    const prompt = await promptFor('fr');
    expect(prompt).toMatch(/numbered Markdown list/i);
    expect(prompt).toMatch(/"##" headings/);
    expect(prompt).toMatch(/bullet lists/i);
    expect(prompt).toMatch(/GFM pipe table/i);
  });

  it('sends the identical contract in every locale — formatting is not language-dependent', async () => {
    const contracts = new Set<string>();
    for (const locale of LOCALES) {
      const prompt = await promptFor(locale);
      // Everything from the contract's first sentence up to the language
      // instruction that follows it.
      const contract = prompt.slice(prompt.indexOf(' Format the "content" field'), prompt.indexOf(' Write every human-readable field'));
      expect(contract.length).toBeGreaterThan(0);
      contracts.add(contract);
    }
    expect(contracts.size).toBe(1);
  });

  it('applies the contract even when the request carries no locale at all', async () => {
    const prompt = await promptFor();
    expect(prompt).toMatch(/Format the "content" field/);
    // No locale -> no translation instruction, but the structure still stands.
    expect(prompt).not.toMatch(/Write every human-readable field/);
  });

  it('states the contract before the language instruction, so translation applies inside the structure', async () => {
    const prompt = await promptFor('ja');
    expect(prompt.indexOf('Format the "content" field')).toBeLessThan(prompt.indexOf('Write every human-readable field'));
  });

  it('forbids translating identifiers, codes and values that must be typed verbatim', async () => {
    const prompt = await promptFor('de');
    expect(prompt).toMatch(/never translate, localize, reformat or round them/i);
  });

  it('does not let the model invent structure the source does not have', async () => {
    const prompt = await promptFor('nl');
    expect(prompt).toMatch(/Never invent structure/i);
  });
});
