import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, seedTestDatabase, authHeader } from './testApp.ts';
import { API_ROUTES, type RouteSpec } from '../src/server/apiRegistry.ts';
import { buildOpenApiDocument } from '../src/server/openapi.ts';
import { failureEnvelope } from '../src/server/schemas/responseSchemas.ts';

import { router as aiRoutes } from '../src/server/routes/ai.ts';
import { router as documentsRoutes } from '../src/server/routes/documents.ts';
import { router as sourcesRoutes } from '../src/server/routes/sources.ts';
import { router as syncRoutes } from '../src/server/routes/sync.ts';
import { router as governanceRoutes } from '../src/server/routes/governance.ts';
import { router as brandsRoutes } from '../src/server/routes/brands.ts';
import { router as healthRoutes } from '../src/server/routes/health.ts';
import { router as authRoutes } from '../src/server/routes/auth.ts';

/**
 * The API's surface, checked against itself.
 *
 * `tests/api.test.ts` was 179 lines against ~2.2k lines of handlers, and what it
 * asserted was mostly `toHaveProperty`. So a response field could change type, a
 * route could be added and documented nowhere, or `docs/API_SPECIFICATION.md` could
 * describe an endpoint that no longer exists — and every test would still pass. The
 * docs had in fact already drifted twice in ways a reader could not detect.
 *
 * Three things are pinned here:
 *   1. the registry and the real Express routers describe the same set of routes;
 *   2. each route's response actually validates against its declared schema;
 *   3. the committed OpenAPI document matches what the code generates.
 */
let app: Express;
beforeAll(async () => {
  app = createTestApp();
  await seedTestDatabase();
});

const ADMIN = authHeader('u1'); // Administrator — passes every rbac.ts rule

/** Walks an Express router's layer stack for the routes it actually mounts. */
function mountedRoutes(router: any): Array<{ method: string; path: string }> {
  const found: Array<{ method: string; path: string }> = [];
  for (const layer of router.stack ?? []) {
    if (!layer.route) continue; // middleware (e.g. the router-wide requireUser), not a route
    for (const method of Object.keys(layer.route.methods ?? {})) {
      if (layer.route.methods[method]) found.push({ method, path: layer.route.path });
    }
  }
  return found;
}

const ACTUAL_ROUTES = [
  healthRoutes, authRoutes, aiRoutes, documentsRoutes, sourcesRoutes, syncRoutes, governanceRoutes, brandsRoutes,
].flatMap(mountedRoutes);

const key = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;

describe('registry ⇄ Express parity', () => {
  it('registers every route the routers mount', () => {
    const registered = new Set(API_ROUTES.map(key));
    const missing = ACTUAL_ROUTES.filter((r) => !registered.has(key(r))).map(key);
    expect(
      missing,
      'these routes are mounted but absent from src/server/apiRegistry.ts — add them so they reach the OpenAPI document'
    ).toEqual([]);
  });

  it('does not register routes that no longer exist', () => {
    const actual = new Set(ACTUAL_ROUTES.map(key));
    const stale = API_ROUTES.filter((r) => !actual.has(key(r))).map(key);
    expect(stale, 'these routes are registered but not mounted anywhere').toEqual([]);
  });

  it('leaves only the operational probes and the login handshake unauthenticated', () => {
    const open = API_ROUTES.filter((r) => r.guard === 'none').map((r) => r.path).sort();
    // The OAuth login handshake (login/callback) and idempotent logout cannot
    // carry a caller identity yet; /auth/me is guarded. Everything else stays closed.
    expect(open).toEqual(['/auth/callback', '/auth/login', '/auth/logout', '/healthz', '/readyz']);
  });

  it('describes every route with a summary and a response schema', () => {
    for (const route of API_ROUTES) {
      expect(route.summary.length, `${key(route)} needs a summary`).toBeGreaterThan(10);
      expect(route.response, `${key(route)} needs a response schema`).toBeTruthy();
    }
  });
});

/**
 * Live response validation.
 *
 * `probe` supplies whatever a route needs to reach a success path. Routes that
 * cannot succeed without an external provider or Graph credentials are listed in
 * SKIPPED with the reason — better an explicit, visible gap than a test that
 * pretends to cover them. `/api/search` is NOT skipped: it degrades to a
 * documented content-grounded fallback when no provider is configured, which is
 * exactly the shape the schema declares.
 */
const SKIPPED: Record<string, string> = {
  'POST /api/kb-chat': 'needs a live LLM provider; no fallback path',
  'POST /api/copilot-generate': 'needs a live LLM provider',
  'POST /api/copilot-draft': 'needs a live LLM provider',
  'POST /api/test-ai-connection': 'makes a real, billable provider call',
  'POST /api/embeddings/backfill': 'needs a live embedding provider',
  'POST /api/db/sync/sharepoint': 'needs Microsoft Graph credentials',
  'GET /auth/login': 'redirects to the corporate auth server; exercised in authFlow.test.ts',
  'GET /auth/callback': 'needs a live OAuth code exchange; exercised in authFlow.test.ts',
};

const PROBES: Record<string, { body?: unknown; query?: Record<string, string>; path?: string }> = {
  'POST /api/db/documents': { body: { name: 'Surface Probe Doc', content: 'probe content' } },
  'PATCH /api/db/documents/:id': { body: { category: 'Operations Manual' } },
  'POST /api/db/documents/governance-decision': { body: { documentName: 'Surface Probe Doc', decision: 'approved' } },
  'DELETE /api/db/documents/:id': {},
  'POST /api/db/sources': { body: [{ id: 'src_surface_probe', name: 'Surface Probe Source', type: 'sharepoint', status: 'healthy' }] },
  'POST /api/db/sources/:id/status': { body: { status: 'warning' }, path: '/api/db/sources/src_surface_probe/status' },
  'POST /api/db/sync/run': { body: { sourceId: 'src_sharepoint_kb' } },
  'POST /api/db/governance/ai-config': { body: { provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.2, maxHistory: 10, apiKey: '' } },
  'POST /api/db/governance/desk-settings': { body: { maxAnswerSec: 3.5, escalationStarLimit: 2, enableSlack: true, enableGdpr: true } },
  'POST /api/db/governance/gaps': { body: [{ id: 'gap_surface_probe', query: 'probe', timestamp: '2026-08-05T00:00:00.000Z', hasResults: false, dominantSource: 'N/A', escalated: false, confidence: 'Low', resolved: false }] },
  'POST /api/db/governance/tasks': { body: [{ id: 'task_surface_probe', status: 'Under Review' }] },
  'POST /api/db/governance/report': { body: { id: 'task_surface_report_probe', documentName: 'Surface Probe Doc' } },
  'POST /api/db/brands': { body: { id: 'brand_surface_probe', displayName: 'Surface Probe Brand', shortCode: 'SPB', vatRate: 0.19 } },
  'PATCH /api/db/brands/:id': { body: { color: '#123456' }, path: '/api/db/brands/brand_surface_probe' },
  'PATCH /api/db/brands/:id/status': { body: { isActive: false }, path: '/api/db/brands/brand_surface_probe/status' },
  'POST /api/search': { body: { query: 'call forwarding', aiConfig: null } },
  'POST /api/crm/cases': { body: {} },
};

describe('responses validate against their declared schema', () => {
  /** A document to aim the :id routes at, created once. */
  let probeDocId: string;
  beforeAll(async () => {
    const created = await request(app)
      .post('/api/db/documents')
      .set(...ADMIN)
      .send({ name: 'Surface Probe Target', content: 'target' });
    probeDocId = created.body.data.document.id;
  });

  const covered = API_ROUTES.filter((r) => !SKIPPED[key(r)]);

  it.each(covered.map((r) => [key(r), r] as [string, RouteSpec]))('%s', async (name, route) => {
    const probe = PROBES[name] ?? {};
    const targetPath = (probe.path ?? route.path).replace(':id', probeDocId);

    let call = (request(app) as any)[route.method](targetPath);
    if (route.guard !== 'none') call = call.set(...ADMIN);
    if (probe.query) call = call.query(probe.query);
    if (probe.body !== undefined) call = call.send(probe.body);

    const response = await call;

    // 503 is a legitimate success-path answer for /readyz (a required dependency
    // down), and it carries the same schema as its 200.
    expect([200, 503], `${name} answered ${response.status}`).toContain(response.status);

    const parsed = route.response.safeParse(response.body);
    if (!parsed.success) {
      throw new Error(
        `${name} response does not match its schema:\n` +
          JSON.stringify(parsed.error.issues, null, 2) +
          `\nbody: ${JSON.stringify(response.body).slice(0, 600)}`
      );
    }
  });

  it('states which routes are not covered, and why', () => {
    // A visible list beats silent absence: every entry needs a live provider or
    // Graph credentials, so none of them can be exercised here.
    expect(Object.keys(SKIPPED).sort()).toEqual([
      'GET /auth/callback',
      'GET /auth/login',
      'POST /api/copilot-draft',
      'POST /api/copilot-generate',
      'POST /api/db/sync/sharepoint',
      'POST /api/embeddings/backfill',
      'POST /api/kb-chat',
      'POST /api/test-ai-connection',
    ]);
    for (const name of Object.keys(SKIPPED)) {
      const route = API_ROUTES.find((r) => key(r) === name);
      expect(route?.externalDependency, `${name} is skipped, so it must be marked externalDependency`).toBe(true);
    }
  });
});

describe('failures validate against the shared envelope', () => {
  it('a 401 from any guarded route parses as the failure envelope', async () => {
    const res = await request(app).get('/api/db/documents');
    expect(res.status).toBe(401);
    expect(failureEnvelope.safeParse(res.body).success).toBe(true);
  });

  it('a 400 from validation parses as the failure envelope, with details', async () => {
    const res = await request(app).post('/api/db/documents').set(...ADMIN).send({ name: '' });
    expect(res.status).toBe(400);
    const parsed = failureEnvelope.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.error.details?.length).toBeGreaterThan(0);
  });
});

describe('docs/openapi.json', () => {
  it('is current — regenerating it produces no diff', () => {
    // Compared with line endings normalized, not byte-for-byte. The committed blob
    // is LF, but a Windows clone with core.autocrlf=true checks the file out as
    // CRLF, so a byte-exact compare failed on every Windows working tree while
    // passing on the Linux CI runner — a stale-spec alarm that fired on the
    // checkout config instead of on drift. .gitattributes now pins the working
    // tree to LF; this normalization keeps the guard honest even where it isn't.
    const lf = (s: string) => s.replace(/\r\n/g, '\n');
    const committed = lf(
      fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'openapi.json'), 'utf8')
    );
    const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
    expect(
      committed === generated,
      'docs/openapi.json is stale — run `npm run api:spec` and commit the result'
    ).toBe(true);
  });

  it('documents an operation for every registered route', () => {
    const doc = buildOpenApiDocument() as any;
    const operations = Object.values(doc.paths).reduce(
      (n: number, methods: any) => n + Object.keys(methods).length,
      0
    );
    expect(operations).toBe(API_ROUTES.length);
  });

  it('states the unsigned-token caveat rather than implying real auth', () => {
    const doc = buildOpenApiDocument() as any;
    expect(doc.info.description).toMatch(/UNSIGNED/);
    expect(doc.components.securitySchemes.bearerUserId.description).toMatch(/not cryptographically verified/i);
  });
});
