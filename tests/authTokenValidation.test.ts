import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, seedTestDatabase } from './testApp.ts';
import { __clearIntrospectionCache } from '../src/server/auth/introspect.ts';

/**
 * Exercises the "oauth" mode of src/server/middleware/auth.ts end-to-end:
 * the Bearer token is an opaque corporate token validated by introspection,
 * not an unsigned user id. Companion to rbacEnforcement.test.ts, which covers
 * the interim "legacy" mode. The corporate authorization server is mocked at
 * the fetch boundary — see docs/AUTH_INTEGRATION_PLAN.md §2/§3.
 */

const BASE = 'https://auth.test/authorization/v1';
const farFuture = Math.floor(Date.now() / 1000) + 3600;

// token → what /oauth/check_token reports. user_name maps to an EKOS user by the
// email local-part heuristic in identityMap.ts:
//   raul.garcia   → u1          (Administrator)
//   sofia.dubois  → u_a_cs_es   (Operator)
//   ghost.user    → (no EKOS user) → provisioned-nowhere → 403
const INTROSPECT: Record<string, any> = {
  'tok-admin': { active: true, user_name: 'raul.garcia', authorities: ['ROLE_USER'], exp: farFuture },
  'tok-operator': { active: true, user_name: 'sofia.dubois', authorities: ['ROLE_USER'], exp: farFuture },
  'tok-unmapped': { active: true, user_name: 'ghost.user', authorities: ['ROLE_USER'], exp: farFuture },
  'tok-inactive': { active: false },
};

let app: Express;
const prevEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ['AUTH_MODE', 'AUTH_BASE_URL', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET']) {
    prevEnv[k] = process.env[k];
  }
  process.env.AUTH_MODE = 'oauth';
  process.env.AUTH_BASE_URL = BASE;
  process.env.AUTH_CLIENT_ID = 'ekos';
  process.env.AUTH_CLIENT_SECRET = 'test-secret';

  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/oauth/check_token')) {
      const token = new URLSearchParams(init.body).get('token') || '';
      const body = INTROSPECT[token] ?? { active: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.endsWith('/userdetails')) {
      const token = String(init.headers.Authorization || '').slice(7);
      const rec = INTROSPECT[token];
      return new Response(
        JSON.stringify({ username: rec?.user_name, email: `${rec?.user_name}@corp.test`, enabled: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('not found', { status: 404 });
  }));

  app = createTestApp();
  // The corporate identity → EKOS user mapping is backed by the user_directory
  // table (identityMap.ts), seeded from INITIAL_USERS. Without this, every
  // validated token would map to nobody and fail closed with 403.
  await seedTestDatabase();
});

afterAll(() => {
  for (const k of Object.keys(prevEnv)) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k]!;
  }
  vi.unstubAllGlobals();
});

beforeEach(() => {
  __clearIntrospectionCache();
});

const bearer = (t: string): [string, string] => ['Authorization', `Bearer ${t}`];

describe('oauth mode — token validation via introspection', () => {
  it('rejects a request with no Authorization header (401)', async () => {
    const res = await request(app).get('/api/db/sync/status');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an inactive/unknown token (401)', async () => {
    const res = await request(app).get('/api/db/sync/status').set(...bearer('tok-inactive'));
    expect(res.status).toBe(401);
    const unknown = await request(app).get('/api/db/sync/status').set(...bearer('never-issued'));
    expect(unknown.status).toBe(401);
  });

  it('validates an active admin token and lets it through (200)', async () => {
    const res = await request(app).get('/api/db/sync/status').set(...bearer('tok-admin'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('maps a validated Operator token, then RBAC still applies', async () => {
    // Operator may READ sources...
    const ok = await request(app).get('/api/db/sources').set(...bearer('tok-operator'));
    expect(ok.status).toBe(200);
    // ...but not reach the sync tab (403 from requireTab, not 401).
    const denied = await request(app).get('/api/db/sync/status').set(...bearer('tok-operator'));
    expect(denied.status).toBe(403);
  });

  it('fails closed (403) for a token that is valid but maps to no EKOS user', async () => {
    const res = await request(app).get('/api/db/sources').set(...bearer('tok-unmapped'));
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('caches introspection — a repeated call does not re-hit the auth server', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    await request(app).get('/api/db/sync/status').set(...bearer('tok-admin'));
    await request(app).get('/api/db/sync/status').set(...bearer('tok-admin'));
    const introspectCalls = fetchMock.mock.calls.filter((c: any[]) => String(c[0]).endsWith('/oauth/check_token'));
    expect(introspectCalls.length).toBe(1);
  });
});
