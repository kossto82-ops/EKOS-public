import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, authHeader } from './testApp.ts';

/**
 * The API's failure contract.
 *
 * Before this, two envelopes coexisted: the AI routes emitted
 * `{success:false, error:{code, message}}` while every `/api/db/*` route emitted
 * `{success:false, error:"a string"}`. The client only ever read the object form
 * (src/config/apiClient.ts reads `error.message` / `error.code`), so the real
 * reason for any `/api/db/*` 400 was silently dropped and the UI showed the
 * generic "Server returned error code: HTTP 400".
 *
 * These cases pin down what a caller can now rely on:
 *   - one envelope shape, whatever the failure,
 *   - a machine-readable `code` and, for schema failures, per-field `details`,
 *   - a correlation id that honors the client's own `X-Request-Id`,
 *   - no internal error text in a 500,
 *   - JSON (not the SPA's index.html) for an unmatched API path.
 */
let app: Express;
beforeAll(() => {
  app = createTestApp();
});

const ADMIN = authHeader('u1'); // Administrator, departmentIds: ['*']
const OPERATOR = authHeader('u_a_cs_es'); // Operator — lowest-privilege seeded role

/** Every failure, regardless of which middleware produced it, looks like this. */
function expectFailureEnvelope(body: any, code?: string) {
  expect(body.success).toBe(false);
  expect(typeof body.error).toBe('object');
  expect(typeof body.error.code).toBe('string');
  expect(typeof body.error.message).toBe('string');
  if (code) expect(body.error.code).toBe(code);
}

describe('failure envelope is the same shape everywhere', () => {
  it('401 (missing identity) carries a code and message object, not a bare string', async () => {
    const res = await request(app).get('/api/db/documents');
    expect(res.status).toBe(401);
    expectFailureEnvelope(res.body, 'ERR_UNAUTHORIZED');
  });

  it('403 (insufficient role) carries the same shape', async () => {
    const res = await request(app).post('/api/db/documents').set(...OPERATOR).send({ name: 'Blocked' });
    expect(res.status).toBe(403);
    expectFailureEnvelope(res.body, 'ERR_FORBIDDEN');
  });

  it('404 (unknown document) carries the same shape', async () => {
    const res = await request(app).delete('/api/db/documents/doc_does_not_exist').set(...ADMIN);
    expect(res.status).toBe(404);
    expectFailureEnvelope(res.body, 'ERR_NOT_FOUND');
  });

  it('an unmatched API path answers JSON 404 — never the SPA fallback', async () => {
    const res = await request(app).get('/api/db/not-a-real-endpoint').set(...ADMIN);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expectFailureEnvelope(res.body, 'ERR_NOT_FOUND');
  });

  it('a malformed JSON body is a 400 about the body, not a 500', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expectFailureEnvelope(res.body, 'ERR_MALFORMED_JSON');
  });
});

describe('correlation id', () => {
  it('honors the client-supplied X-Request-Id and echoes it back', async () => {
    const res = await request(app)
      .get('/api/db/documents')
      .set(...ADMIN)
      .set('X-Request-Id', 'req_get_abc123');
    expect(res.headers['x-request-id']).toBe('req_get_abc123');
  });

  it('mints one when the caller sends none, and reports it in a failure envelope', async () => {
    const res = await request(app).get('/api/db/documents');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
    expect(res.body.metadata.requestId).toBe(res.headers['x-request-id']);
  });

  it('refuses to echo a caller-controlled id that is not a plain token', async () => {
    const res = await request(app)
      .get('/api/db/documents')
      .set(...ADMIN)
      .set('X-Request-Id', 'not a valid <id> at all');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('schema validation at the boundary', () => {
  it('reports the offending field, not just "bad request"', async () => {
    const res = await request(app).post('/api/db/documents').set(...ADMIN).send({ name: '   ' });
    expect(res.status).toBe(400);
    expectFailureEnvelope(res.body, 'ERR_VALIDATION');
    expect(res.body.error.details.map((d: any) => d.path)).toContain('name');
  });

  it('rejects an out-of-range vatRate instead of storing it', async () => {
    const res = await request(app)
      .post('/api/db/brands')
      .set(...ADMIN)
      .send({ displayName: 'Bad VAT Brand', shortCode: 'BVB', vatRate: 19 });
    expect(res.status).toBe(400);
    expectFailureEnvelope(res.body, 'ERR_VALIDATION');
  });

  it('keeps a null vatRate null rather than coercing it to 0% VAT', async () => {
    const res = await request(app)
      .post('/api/db/brands')
      .set(...ADMIN)
      .send({ id: 'brand_null_vat_test', displayName: 'Null VAT Brand', shortCode: 'NVB', vatRate: null });
    expect(res.status).toBe(200);
    expect(res.body.data.vatRate).toBeNull();
  });

  it('rejects an unknown document scope that would land in an enum column', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Bad Scope Doc', scope: 'whatever-i-want' });
    expect(res.status).toBe(400);
    expectFailureEnvelope(res.body, 'ERR_VALIDATION');
  });

  /**
   * Caught by driving the real UI, not by the suite: the Assistant sends
   * `aiConfig: null` whenever no provider config is stored (src/api/searchApi.ts
   * initializes it to null), and the handler has always treated null and absent
   * identically. A schema that accepted only `undefined` turned every search from
   * a fresh browser into a 400. Optional fields the routes coalesce with `||` must
   * therefore accept an explicit null.
   */
  it('accepts an explicit null for optional fields the client really sends', async () => {
    const res = await request(app)
      .post('/api/search')
      .set(...ADMIN)
      .send({ query: 'call forwarding setup', aiConfig: null, brandId: null, departmentId: null, locale: null });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('still corrects (not rejects) an out-of-range page, as before', async () => {
    const res = await request(app).get('/api/db/documents').set(...ADMIN).query({ limit: 99999, offset: -5 });
    expect(res.status).toBe(200);
    expect(res.body.data.documents.length).toBeLessThanOrEqual(1000);
  });

  /**
   * The provider config is the highest-value payload on the API: it decides which
   * endpoint and key every /search and /kb-chat call resolves. This route used to
   * store whatever JSON it was handed.
   */
  it('refuses a provider config the settings form would have refused', async () => {
    const unknownProvider = await request(app)
      .post('/api/db/governance/ai-config')
      .set(...ADMIN)
      .send({ provider: 'definitely-not-a-provider', model: 'x', temperature: 0.2, maxHistory: 10 });
    expect(unknownProvider.status).toBe(400);
    expectFailureEnvelope(unknownProvider.body, 'ERR_VALIDATION');

    const badTemperature = await request(app)
      .post('/api/db/governance/ai-config')
      .set(...ADMIN)
      .send({ provider: 'gemini', model: 'gemini-2.5-flash', temperature: 'hot', maxHistory: 10 });
    expect(badTemperature.status).toBe(400);

    // A numeric apiKey used to reach `configVal.apiKey.trim()` and surface as a 500.
    const nonStringKey = await request(app)
      .post('/api/db/governance/ai-config')
      .set(...ADMIN)
      .send({ provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.2, maxHistory: 10, apiKey: 12345 });
    expect(nonStringKey.status).toBe(400);
  });

  it('accepts the config the settings form actually sends', async () => {
    const res = await request(app)
      .post('/api/db/governance/ai-config')
      .set(...ADMIN)
      .send({ provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.2, maxHistory: 10, apiKey: '' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects a desk policy outside the range the TeamManager form enforces', async () => {
    const res = await request(app)
      .post('/api/db/governance/desk-settings')
      .set(...ADMIN)
      .send({ maxAnswerSec: 900, escalationStarLimit: 2, enableSlack: true, enableGdpr: true });
    expect(res.status).toBe(400);
    expectFailureEnvelope(res.body, 'ERR_VALIDATION');
  });
});

/**
 * Regression guard for a dead configuration value rather than a behavior: a second,
 * earlier `express.json()` registration meant body-parser had already consumed the
 * request by the time the 20mb limit was declared, so the effective upload ceiling
 * was body-parser's 100kb default — well under the 20MB the client accepts
 * (MAX_UPLOAD_BYTES in src/components/tabs/kb/DocList.tsx). Nothing observable in a
 * single-parser app can catch the duplicate coming back, so assert the source.
 */
describe('server.ts body parser', () => {
  it('registers express.json exactly once, so the declared 20mb limit is the one in force', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.ts'), 'utf8');
    const registrations = source.match(/app\.use\(express\.json\(/g) ?? [];
    expect(registrations).toHaveLength(1);
    expect(source).toMatch(/app\.use\(express\.json\(\{ limit: '20mb' \}\)\)/);
  });
});
