import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, seedTestDatabase } from './testApp.ts';
import { __clearIntrospectionCache } from '../src/server/auth/introspect.ts';

/**
 * End-to-end BFF login flow (oauth mode): login redirect → callback token
 * exchange → session cookie → authenticated API access → logout. The corporate
 * authorization server is mocked at the fetch boundary. See
 * docs/AUTH_INTEGRATION_PLAN.md §4.
 */

const BASE = 'https://auth.test/authorization/v1';
const farFuture = Math.floor(Date.now() / 1000) + 3600;

let app: Express;
const prevEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['AUTH_MODE', 'AUTH_BASE_URL', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET', 'AUTH_POST_LOGIN_REDIRECT', 'ALLOWED_ORIGIN'];

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.AUTH_MODE = 'oauth';
  process.env.AUTH_BASE_URL = BASE;
  process.env.AUTH_CLIENT_ID = 'ekos';
  process.env.AUTH_CLIENT_SECRET = 'test-secret';
  process.env.AUTH_POST_LOGIN_REDIRECT = 'http://localhost:3000/';
  process.env.ALLOWED_ORIGIN = 'http://localhost:3000';

  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/oauth/token')) {
      // Only accept the authorization-code grant with a verifier present.
      const body = new URLSearchParams(init.body);
      if (body.get('grant_type') !== 'authorization_code' || !body.get('code_verifier')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ access_token: 'tok-admin', refresh_token: 'ref-1', expires_in: 3600, token_type: 'bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.endsWith('/oauth/check_token')) {
      const token = new URLSearchParams(init.body).get('token');
      const body = token === 'tok-admin'
        ? { active: true, user_name: 'raul.garcia', authorities: ['ROLE_USER'], exp: farFuture }
        : { active: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.endsWith('/userdetails')) {
      return new Response(JSON.stringify({ username: 'raul.garcia', email: 'raul.garcia@corp.test', enabled: true }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }));

  app = createTestApp();
  await seedTestDatabase();
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k]!;
  }
  vi.unstubAllGlobals();
});

beforeEach(() => __clearIntrospectionCache());

/** Pull the session cookie name=value (no attributes) out of a Set-Cookie header. */
function sessionCookie(setCookie: string[] | undefined): string | undefined {
  const raw = (setCookie || []).find((c) => c.startsWith('ekos_session='));
  return raw?.split(';')[0];
}

describe('BFF login flow', () => {
  it('GET /auth/login redirects to the auth server with PKCE + state', async () => {
    const res = await request(app).get('/auth/login').redirects(0);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.origin + loc.pathname).toBe(`${BASE}/oauth/authorize`);
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
  });

  it('rejects a callback with an unknown/expired state (400)', async () => {
    const res = await request(app).get('/auth/callback?code=abc&state=never-issued').redirects(0);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('completes the full flow: login → callback → cookie → /auth/me → logout', async () => {
    // 1. login, capture state
    const login = await request(app).get('/auth/login').redirects(0);
    const state = new URL(login.headers.location).searchParams.get('state')!;

    // 2. callback exchanges the code and sets a session cookie
    const cb = await request(app).get(`/auth/callback?code=good-code&state=${state}`).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:3000/');
    const cookie = sessionCookie(cb.headers['set-cookie'] as unknown as string[]);
    expect(cookie).toBeTruthy();

    // 3. the cookie authenticates /auth/me as the mapped EKOS user (u1 / admin)
    const me = await request(app).get('/auth/me').set('Cookie', cookie!);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe('u1');
    expect(me.body.data.role).toBe('Administrator');

    // 4. and authenticates a normal API route (admin passes requireTab('sync'))
    const api = await request(app).get('/api/db/sync/status').set('Cookie', cookie!);
    expect(api.status).toBe(200);

    // 5. logout destroys the session
    const out = await request(app).post('/auth/logout').set('Cookie', cookie!);
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);

    // 6. the same cookie no longer authenticates
    const after = await request(app).get('/auth/me').set('Cookie', cookie!);
    expect(after.status).toBe(401);
  });

  it('rejects a tampered session cookie (401)', async () => {
    const res = await request(app).get('/auth/me').set('Cookie', 'ekos_session=forged.deadbeef');
    expect(res.status).toBe(401);
  });

  it('kills a session after the inactivity window (idle timeout)', async () => {
    // Log in and confirm the session is live.
    const login = await request(app).get('/auth/login').redirects(0);
    const state = new URL(login.headers.location).searchParams.get('state')!;
    const cb = await request(app).get(`/auth/callback?code=good-code&state=${state}`).redirects(0);
    const cookie = sessionCookie(cb.headers['set-cookie'] as unknown as string[])!;
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);

    // Age last_seen_at well past the 30m default idle window, directly in the DB.
    const { db } = await import('../src/db/db.ts');
    const { authSessions } = await import('../src/db/schema.ts');
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.update(authSessions).set({ lastSeenAt: stale }).run();

    // Next authenticated request finds the session idle-expired → 401.
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('returns 503 from /auth/login when OAuth is not configured', async () => {
    const savedMode = process.env.AUTH_MODE;
    const savedId = process.env.AUTH_CLIENT_ID;
    const savedSecret = process.env.AUTH_CLIENT_SECRET;
    delete process.env.AUTH_MODE;
    delete process.env.AUTH_CLIENT_ID;
    delete process.env.AUTH_CLIENT_SECRET;
    try {
      const res = await request(app).get('/auth/login').redirects(0);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('ERR_AUTH_NOT_CONFIGURED');
    } finally {
      process.env.AUTH_MODE = savedMode;
      process.env.AUTH_CLIENT_ID = savedId;
      process.env.AUTH_CLIENT_SECRET = savedSecret;
    }
  });
});
