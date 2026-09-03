import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, seedTestDatabase, authHeader } from './testApp.ts';

/**
 * S4 regression coverage for Sources & Sync route fixes:
 * - POST /api/db/sync/run no longer 500s on the default/unknown sourceId
 *   (the old 'src_1' default violated the kb_sync_jobs -> kb_sources FK).
 * - GET /api/db/sync/status reports telemetry derived from the DB, not the
 *   hardcoded 99.8 / 142500 literals.
 * - Source status 'warning' round-trips instead of being silently stored as
 *   'active' and read back as 'healthy'; unknown ids 404 instead of 500;
 *   lastSync is populated so the UI never renders "Invalid Date".
 */
let app: Express;
const ADMIN = authHeader('u1'); // Administrator, departmentIds ['*']

beforeAll(async () => {
  app = createTestApp();
  await seedTestDatabase();
});

describe('POST /api/db/sync/run — sourceId FK handling', () => {
  it('succeeds with an empty body (resolves to the seeded source, no FK crash)', async () => {
    const res = await request(app).post('/api/db/sync/run').set(...ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects an unknown sourceId with a clean 400 (not a 500 FK failure)', async () => {
    const res = await request(app)
      .post('/api/db/sync/run')
      .set(...ADMIN)
      .send({ sourceId: 'src_does_not_exist' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/db/sync/status — real index telemetry', () => {
  it('derives telemetry from the DB, not the old 99.8 / 142500 constants', async () => {
    const res = await request(app).get('/api/db/sync/status').set(...ADMIN);
    expect(res.status).toBe(200);
    const { indexIntegrity, totalIndexedKeys } = res.body.data;
    expect(typeof indexIntegrity).toBe('number');
    expect(typeof totalIndexedKeys).toBe('number');
    expect(totalIndexedKeys).not.toBe(142500);
    // Derived from documents with indexable content — bounded and sane.
    expect(indexIntegrity).toBeLessThanOrEqual(100);
    expect(indexIntegrity).toBeGreaterThanOrEqual(0);
    expect(totalIndexedKeys).toBeGreaterThanOrEqual(0);
  });
});

describe('Sources status contract', () => {
  it("round-trips 'warning' instead of silently downgrading it to healthy", async () => {
    const set = await request(app)
      .post('/api/db/sources/src_sharepoint_kb/status')
      .set(...ADMIN)
      .send({ status: 'warning' });
    expect(set.status).toBe(200);

    const list = await request(app).get('/api/db/sources').set(...ADMIN);
    const src = list.body.data.find((s: any) => s.id === 'src_sharepoint_kb');
    expect(src.status).toBe('warning');

    // restore healthy so other assertions/tests see a clean state
    await request(app)
      .post('/api/db/sources/src_sharepoint_kb/status')
      .set(...ADMIN)
      .send({ status: 'healthy' });
  });

  it('returns 404 (not a 500 crash) when updating an unknown source id', async () => {
    const res = await request(app)
      .post('/api/db/sources/nope_not_real/status')
      .set(...ADMIN)
      .send({ status: 'healthy' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('exposes a valid lastSync so the UI never shows "Invalid Date"', async () => {
    const list = await request(app).get('/api/db/sources').set(...ADMIN);
    const src = list.body.data.find((s: any) => s.id === 'src_sharepoint_kb');
    expect(src.lastSync).toBeTruthy();
    expect(new Date(src.lastSync).toString()).not.toBe('Invalid Date');
  });
});
