import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, seedTestDatabase, authHeader } from './testApp.ts';

/**
 * S5 data-layer regression coverage:
 * - POST /api/db/documents must not be a governance-queue bypass: a non-
 *   governance uploader's client-supplied approvalStatus is forced to
 *   'Under Review'; a governance role may set a valid value; garbage is 400.
 * - Brand writes validate vatRate (a fraction in [0,1]) so a bad rate can't
 *   flow into AI pricing answers.
 * - /sync/status telemetry excludes soft-deleted documents.
 */
let app: Express;
const ADMIN = authHeader('u1');       // Administrator (governance + manage_rates)
const TEAMLEAD = authHeader('u2');    // TeamLeader: upload_kb but NOT governance

beforeAll(async () => {
  app = createTestApp();
  await seedTestDatabase();
});

describe('POST /api/db/documents — approvalStatus governance gate', () => {
  it("forces a non-governance uploader's 'Approved' down to 'Under Review'", async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...TEAMLEAD)
      .send({ name: 'TL Upload', content: 'body', approvalStatus: 'Approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.document.approvalStatus).toBe('Under Review');
  });

  it('lets a governance role (Administrator) set an explicit valid approvalStatus', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Admin Approved', content: 'body', approvalStatus: 'Approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.document.approvalStatus).toBe('Approved');
  });

  it('rejects a garbage approvalStatus from a governance role with 400', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Bad Status', content: 'body', approvalStatus: 'Approved!!!' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/db/brands — vatRate validation', () => {
  it('rejects a vatRate outside [0,1] with 400 (would poison AI pricing)', async () => {
    const res = await request(app)
      .post('/api/db/brands')
      .set(...ADMIN)
      .send({ displayName: 'Bad VAT', shortCode: 'BV', vatRate: 5, currency: 'EUR', vatLabel: 'VAT' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric vatRate with 400', async () => {
    const res = await request(app)
      .post('/api/db/brands')
      .set(...ADMIN)
      .send({ displayName: 'NaN VAT', shortCode: 'NV', vatRate: 'abc', currency: 'EUR', vatLabel: 'VAT' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid fractional vatRate', async () => {
    const res = await request(app)
      .post('/api/db/brands')
      .set(...ADMIN)
      .send({ id: 'brand_test_vat', displayName: 'Good VAT', shortCode: 'GV', vatRate: 0.19, currency: 'EUR', vatLabel: 'VAT' });
    expect(res.status).toBe(200);
    expect(res.body.data.vatRate).toBe(0.19);
  });
});

describe('GET /api/db/sync/status — telemetry excludes soft-deleted docs', () => {
  it('drops a document from the indexed count once it is soft-deleted', async () => {
    const count = async () => {
      const r = await request(app).get('/api/db/sync/status').set(...ADMIN);
      return r.body.data.totalIndexedKeys as number;
    };
    const before = await count();

    const created = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ id: 'doc_softdel_probe', name: 'Soft Delete Probe', content: 'has indexable content' });
    expect(created.status).toBe(200);
    expect(await count()).toBe(before + 1);

    const del = await request(app).delete('/api/db/documents/doc_softdel_probe').set(...ADMIN);
    expect(del.status).toBe(200);
    expect(await count()).toBe(before);
  });
});
