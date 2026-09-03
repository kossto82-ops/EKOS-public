import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, seedTestDatabase, authHeader } from './testApp.ts';

/**
 * Tier-2 backlog regression: the bulk-upsert routes (POST /api/db/sources and
 * POST /api/db/governance/gaps) looped one insert/update per row with NO
 * transaction, so a failure partway through left the earlier rows written and
 * the rest not — a half-applied "replace my list" that the caller sees only as
 * a 500. Both batches are now wrapped in db.transaction().
 */
let app: Express;
const ADMIN = authHeader('u1'); // Administrator, brandIds/departmentIds ['*']

beforeAll(async () => {
  app = createTestApp();
  await seedTestDatabase();
});

describe('POST /api/db/sources — batch atomicity', () => {
  it('rolls the whole batch back when a later row fails, leaving no partial write', async () => {
    // First row is valid; second passes the route's id/name check but violates
    // the NOT NULL `type` column, so the insert throws mid-batch.
    const res = await request(app)
      .post('/api/db/sources')
      .set(...ADMIN)
      .send([
        { id: 'atomic_ok', name: 'Atomic Canary A', type: 'mcp', status: 'healthy' },
        { id: 'atomic_bad', name: 'Atomic Canary B' /* no type -> NOT NULL violation */ },
      ]);

    expect(res.status).toBe(500);

    // Neither row may be present: the valid first row must have been rolled back.
    const list = await request(app).get('/api/db/sources').set(...ADMIN);
    expect(list.status).toBe(200);
    const ids = (list.body.data ?? list.body).map((s: any) => s.id);
    expect(ids).not.toContain('atomic_ok');
    expect(ids).not.toContain('atomic_bad');
  });

  it('still commits a fully valid batch', async () => {
    const res = await request(app)
      .post('/api/db/sources')
      .set(...ADMIN)
      .send([
        { id: 'atomic_two_a', name: 'Valid A', type: 'mcp', status: 'healthy' },
        { id: 'atomic_two_b', name: 'Valid B', type: 'mcp', status: 'warning' },
      ]);
    expect(res.status).toBe(200);

    const list = await request(app).get('/api/db/sources').set(...ADMIN);
    const ids = (list.body.data ?? list.body).map((s: any) => s.id);
    expect(ids).toContain('atomic_two_a');
    expect(ids).toContain('atomic_two_b');
  });
});

describe('POST /api/db/governance/gaps — batch atomicity', () => {
  it('rolls back the batch when a later gap row fails', async () => {
    // `hasResults`/`confidence`/`dominantSource` are NOT NULL; the second row
    // omits them, so it throws after the first row was already written.
    const res = await request(app)
      .post('/api/db/governance/gaps')
      .set(...ADMIN)
      .send([
        {
          id: 'gap_atomic_ok', query: 'atomic canary', timestamp: new Date().toISOString(),
          hasResults: false, dominantSource: 'N/A', escalated: false, confidence: 'Low', resolved: false,
        },
        { id: 'gap_atomic_bad', query: 'missing required fields' },
      ]);

    expect(res.status).toBe(500);

    const list = await request(app).get('/api/db/governance/gaps').set(...ADMIN);
    expect(list.status).toBe(200);
    const ids = (list.body.data ?? list.body).map((g: any) => g.id);
    expect(ids).not.toContain('gap_atomic_ok');
    expect(ids).not.toContain('gap_atomic_bad');
  });
});
