import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, authHeader } from './testApp.ts';

let app: Express;
beforeAll(() => {
  app = createTestApp();
});

// u1 is the seeded Administrator (departmentIds: ['*']) — every rbac.ts rule
// allows it, so existing functional tests below stay focused on behavior
// rather than authorization by acting as this user.
const ADMIN = authHeader('u1');

describe('POST /api/search', () => {
  // Rejecting a bad payload is a validation failure, not a search failure: every
  // schema rejection across the API now reports ERR_VALIDATION with per-field
  // details, instead of each route inventing its own code for the same class of
  // error (this one used to answer ERR_SEARCH_FAILED — the code it also used when
  // the upstream AI call died, so a caller couldn't tell the two apart).
  it('returns 400 with ERR_VALIDATION and field details when query is empty', async () => {
    const res = await request(app).post('/api/search').set(...ADMIN).send({ query: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ERR_VALIDATION');
    expect(res.body.error.details[0].path).toBe('query');
  });

  it('returns 400 when query is missing entirely', async () => {
    const res = await request(app).post('/api/search').set(...ADMIN).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when query is not a string', async () => {
    const res = await request(app).post('/api/search').set(...ADMIN).send({ query: 123 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET/POST/DELETE /api/db/documents', () => {
  it('lists documents with the expected envelope shape', async () => {
    const res = await request(app).get('/api/db/documents').set(...ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('documents');
    expect(res.body.data).toHaveProperty('totalCount');
    expect(res.body.data).toHaveProperty('filteredCount');
    expect(res.body.data).toHaveProperty('availableCategories');
    expect(Array.isArray(res.body.data.documents)).toBe(true);
  });

  it('creates a document and returns it with defaults applied', async () => {
    const res = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Test Policy Doc', content: 'Some policy content' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.document.name).toBe('Test Policy Doc');
    expect(res.body.data.document.status).toBe('trained');
    expect(res.body.data.document.scope).toBe('global');
    expect(res.body.data.document).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('ingestionJobId');
  });

  it('created document is retrievable via GET and filterable by brandId', async () => {
    await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Brand-Scoped Doc', scope: 'brand', brandId: 'northwind_es', content: 'x' });

    const resAll = await request(app).get('/api/db/documents').set(...ADMIN);
    const names = resAll.body.data.documents.map((d: any) => d.name);
    expect(names).toContain('Brand-Scoped Doc');

    const resFiltered = await request(app).get('/api/db/documents').set(...ADMIN).query({ brandId: 'northwind_de' });
    const filteredNames = resFiltered.body.data.documents.map((d: any) => d.name);
    expect(filteredNames).not.toContain('Brand-Scoped Doc');
  });

  it('deletes a document by id', async () => {
    const created = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Doc To Delete', content: 'temp' });
    const id = created.body.data.document.id;

    const res = await request(app).delete(`/api/db/documents/${id}`).set(...ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);

    const listRes = await request(app).get('/api/db/documents').set(...ADMIN);
    const ids = listRes.body.data.documents.map((d: any) => d.id);
    expect(ids).not.toContain(id);
  });

  it('paginates with limit/offset and reports hasMore/nextOffset', async () => {
    const full = await request(app).get('/api/db/documents').set(...ADMIN);
    const totalFiltered = full.body.data.filteredCount;

    const page1 = await request(app).get('/api/db/documents').set(...ADMIN).query({ limit: 2, offset: 0 });
    expect(page1.body.data.documents).toHaveLength(2);
    expect(page1.body.data.hasMore).toBe(totalFiltered > 2);
    if (totalFiltered > 2) {
      expect(page1.body.data.nextOffset).toBe(2);

      const page2 = await request(app).get('/api/db/documents').set(...ADMIN).query({ limit: 2, offset: page1.body.data.nextOffset });
      const page1Ids = page1.body.data.documents.map((d: any) => d.id);
      const page2Ids = page2.body.data.documents.map((d: any) => d.id);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    } else {
      expect(page1.body.data.nextOffset).toBeNull();
    }
  });

  it('defaults to a bounded page (not the entire table) when no limit is given', async () => {
    const res = await request(app).get('/api/db/documents').set(...ADMIN);
    expect(res.body.data.documents.length).toBeLessThanOrEqual(200);
  });
});

describe('GET /api/db/sources', () => {
  it('returns a success envelope with a sources array', async () => {
    const res = await request(app).get('/api/db/sources').set(...ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('Governance bulk-approve eligibility (server-side validation)', () => {
  it('blocks re-approving a Rejected task and reverts its status', async () => {
    await request(app)
      .post('/api/db/governance/tasks')
      .set(...ADMIN)
      .send([{ id: 'test_task_rejected', status: 'Rejected' }]);

    const res = await request(app)
      .post('/api/db/governance/tasks')
      .set(...ADMIN)
      .send([{ id: 'test_task_rejected', status: 'Grounded & Updated' }]);

    expect(res.status).toBe(200);
    expect(res.body.blockedCount).toBe(1);

    const listRes = await request(app).get('/api/db/governance/tasks').set(...ADMIN);
    const task = listRes.body.data.find((t: any) => t.id === 'test_task_rejected');
    expect(task.status).toBe('Rejected');
  });

  it('does not count an idempotent re-submit of an already-approved task as blocked', async () => {
    // Start from a neutral status so the first approval isn't itself blocked,
    // then resubmit the same "Grounded & Updated" status unchanged.
    await request(app)
      .post('/api/db/governance/tasks')
      .set(...ADMIN)
      .send([{ id: 'test_task_idempotent', status: 'Under Review' }]);
    const approveRes = await request(app)
      .post('/api/db/governance/tasks')
      .set(...ADMIN)
      .send([{ id: 'test_task_idempotent', status: 'Grounded & Updated' }]);
    expect(approveRes.body.blockedCount).toBe(0);

    const res = await request(app)
      .post('/api/db/governance/tasks')
      .set(...ADMIN)
      .send([{ id: 'test_task_idempotent', status: 'Grounded & Updated' }]);

    expect(res.body.blockedCount).toBe(0);
  });

  it('rejects a malformed request body with 400', async () => {
    const res = await request(app)
      .post('/api/db/governance/tasks')
      .set(...ADMIN)
      .send([{ id: 'missing_status' }]);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
