import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, authHeader } from './testApp.ts';
import { INITIAL_USERS } from '../src/constants/users.ts';

/**
 * Exercises src/server/middleware/auth.ts end-to-end against every mutating
 * /api/db/* and /api route, per the Enterprise AI Review Board's must-fix
 * condition: coverage must be verified route-by-route, not assumed. See the
 * "SECURITY MODEL NOTE" in src/server/middleware/auth.ts for what this
 * enforcement does and does not guarantee (identity is still an unsigned id,
 * not a verified token).
 */
let app: Express;
beforeAll(() => {
  app = createTestApp();
});

const ADMIN = authHeader('u1'); // Administrator, departmentIds: ['*']
const OPERATOR = authHeader('u_a_cs_es'); // Operator, customer_service — lowest-privilege seeded role
const UNKNOWN = authHeader('not-a-real-user-id');

describe('requireUser — identity is required on every guarded route', () => {
  const routes: Array<['get' | 'post' | 'delete' | 'patch', string]> = [
    ['get', '/api/db/documents'],
    ['post', '/api/db/documents'],
    ['get', '/api/db/sources'],
    ['post', '/api/db/sources'],
    ['get', '/api/db/brands'],
    ['post', '/api/db/brands'],
    ['get', '/api/db/sync/status'],
    ['post', '/api/db/sync/run'],
    ['get', '/api/db/governance/ai-config'],
    ['post', '/api/db/governance/ai-config'],
    ['get', '/api/db/governance/desk-settings'],
    ['post', '/api/db/governance/desk-settings'],
    ['get', '/api/db/governance/gaps'],
    ['post', '/api/db/governance/gaps'],
    ['get', '/api/db/governance/tasks'],
    ['post', '/api/db/governance/tasks'],
    ['get', '/api/debug-db'],
    ['post', '/api/search'],
  ];

  it.each(routes)('rejects %s %s with 401 when no Authorization header is sent', async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it.each(routes)('rejects %s %s with 401 for an unrecognized caller id', async (method, path) => {
    const res = await (request(app) as any)[method](path).set(...UNKNOWN).send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('requireAction("upload_kb") — document create/delete', () => {
  it('blocks an Operator (not permitted to upload_kb) with 403', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...OPERATOR)
      .send({ name: 'Should Be Blocked' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('allows an Administrator through to the normal validation path', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Allowed Doc' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('requireTab("sync") — Administrator/IT only', () => {
  it('blocks an Operator (not Administrator/IT) with 403', async () => {
    const res = await request(app).get('/api/db/sync/status').set(...OPERATOR);
    expect(res.status).toBe(403);
  });

  it('allows an Administrator through', async () => {
    const res = await request(app).get('/api/db/sync/status').set(...ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('requireTab("governance") — Administrator/LocationManager only', () => {
  it('blocks an Operator with 403 on both gaps and tasks', async () => {
    const gapsRes = await request(app).get('/api/db/governance/gaps').set(...OPERATOR);
    const tasksRes = await request(app).get('/api/db/governance/tasks').set(...OPERATOR);
    expect(gapsRes.status).toBe(403);
    expect(tasksRes.status).toBe(403);
  });

  it('allows an Administrator through', async () => {
    const res = await request(app).get('/api/db/governance/gaps').set(...ADMIN);
    expect(res.status).toBe(200);
  });
});

describe('requireTab("settings") — ai-config and debug-db', () => {
  it('blocks an Operator from reading AI provider config', async () => {
    const res = await request(app).get('/api/db/governance/ai-config').set(...OPERATOR);
    expect(res.status).toBe(403);
  });

  it('blocks an Operator from the debug-db endpoint', async () => {
    const res = await request(app).get('/api/debug-db').set(...OPERATOR);
    expect(res.status).toBe(403);
  });

  it('allows an Administrator through to both', async () => {
    const configRes = await request(app).get('/api/db/governance/ai-config').set(...ADMIN);
    const debugRes = await request(app).get('/api/debug-db').set(...ADMIN);
    expect(configRes.status).toBe(200);
    expect(debugRes.status).toBe(200);
  });
});

describe('sources/brands — reads open to any identity, writes are gated', () => {
  it('an Operator can READ sources and brands', async () => {
    const sourcesRes = await request(app).get('/api/db/sources').set(...OPERATOR);
    const brandsRes = await request(app).get('/api/db/brands').set(...OPERATOR);
    expect(sourcesRes.status).toBe(200);
    expect(brandsRes.status).toBe(200);
  });

  it('blocks an Operator from WRITING brands (manage_rates) with 403', async () => {
    const res = await request(app).post('/api/db/brands').set(...OPERATOR).send({ displayName: 'X', shortCode: 'x' });
    expect(res.status).toBe(403);
  });

  it('blocks an Operator from WRITING sources (upload_kb) with 403', async () => {
    const create = await request(app).post('/api/db/sources').set(...OPERATOR).send({ name: 'X', type: 'local' });
    const status = await request(app).post('/api/db/sources/s1/status').set(...OPERATOR).send({ status: 'error' });
    expect(create.status).toBe(403);
    expect(status.status).toBe(403);
  });
});

describe('GET /api/db/documents — server enforces the caller brand/department scope', () => {
  it('never returns a document outside the caller scope, and returns no more than an Administrator sees', async () => {
    const adminDocs = (await request(app).get('/api/db/documents').set(...ADMIN)).body.data.documents;

    const u = INITIAL_USERS.find((x) => x.id === 'u_a_cs_es')!; // Operator: brand northwind_es, dept customer_service
    const res = await request(app).get('/api/db/documents').set(...OPERATOR);
    expect(res.status).toBe(200);
    const docs = res.body.data.documents as any[];

    const brandAll = u.brandIds.includes('*');
    const deptAll = u.departmentIds.includes('*');
    for (const d of docs) {
      const brandOk = brandAll || d.scope === 'global' || u.brandIds.includes(d.brandId);
      const deptOk = deptAll || d.departmentScope === 'global' || (d.departmentIds || []).some((id: string) => u.departmentIds.includes(id));
      expect(brandOk).toBe(true);
      expect(deptOk).toBe(true);
    }
    expect(docs.length).toBeLessThanOrEqual(adminDocs.length);
  });
});

describe('AI-config / desk-settings WRITE — governance roles only (not the whole settings tab)', () => {
  const TEAMLEADER = authHeader('u2'); // TeamLeader: settings tab yes, governance no

  it('lets a TeamLeader READ ai-config (settings tab) but NOT write it (403)', async () => {
    const read = await request(app).get('/api/db/governance/ai-config').set(...TEAMLEADER);
    const write = await request(app).post('/api/db/governance/ai-config').set(...TEAMLEADER).send({ provider: 'gemini', model: 'gemini-2.5-flash' });
    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
  });

  it('blocks a TeamLeader from writing desk-settings with 403', async () => {
    const res = await request(app).post('/api/db/governance/desk-settings').set(...TEAMLEADER).send({ maxAnswerSec: 3 });
    expect(res.status).toBe(403);
  });
});
