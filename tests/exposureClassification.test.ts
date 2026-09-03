import { describe, it, expect } from 'vitest';
import { API_ROUTES } from '../src/server/apiRegistry.ts';
import { ENDPOINT_EXPOSURE, exposureFor, exposureKey } from '../src/server/exposure.ts';

/**
 * Endpoint exposure classification gate — the EKOS enforcement of
 * SecurityGuidelines §12 (see src/server/exposure.ts). Exposure is a declared
 * intent, not something inferrable from code, so a route that is not classified
 * must fail CI rather than ship undeclared (the EB-3900 failure mode).
 */
const key = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;

describe('every route declares its network exposure', () => {
  it('classifies exactly the registered routes — no missing, no stale', () => {
    const registered = new Set(API_ROUTES.map(key));
    const classified = new Set(Object.keys(ENDPOINT_EXPOSURE));

    const missing = [...registered].filter((k) => !classified.has(k));
    const stale = [...classified].filter((k) => !registered.has(k));

    expect(missing, 'these routes are mounted but not classified in src/server/exposure.ts').toEqual([]);
    expect(stale, 'these classifications no longer match any mounted route').toEqual([]);
  });

  it('resolves an exposure for every route via exposureFor()', () => {
    for (const r of API_ROUTES) {
      expect(exposureFor(r.method, r.path), `${key(r)} has no exposure`).toMatch(/^(internal|external)$/);
    }
  });
});

describe('exposure invariants', () => {
  it('marks only the operational probes as internal', () => {
    const internal = Object.entries(ENDPOINT_EXPOSURE)
      .filter(([, v]) => v === 'internal')
      .map(([k]) => k)
      .sort();
    expect(internal).toEqual(['GET /healthz', 'GET /readyz']);
  });

  it('keeps exposure orthogonal to auth: every external route is authenticated, except the public login handshake', () => {
    // A route can be external AND still need auth — the two axes are independent
    // (§12). The only external routes allowed to be unauthenticated are the OAuth
    // handshake endpoints, which cannot carry a caller identity yet.
    const PUBLIC_HANDSHAKE = new Set(['GET /auth/login', 'GET /auth/callback', 'POST /auth/logout']);
    const offenders = API_ROUTES.filter(
      (r) => exposureFor(r.method, r.path) === 'external' && r.guard === 'none' && !PUBLIC_HANDSHAKE.has(key(r))
    ).map(key);
    expect(offenders, 'external + unauthenticated + not a login-handshake route — an exposure/auth gap').toEqual([]);
  });

  it('never exposes an internal route to unauthenticated external callers by accident (probes stay guardless by design)', () => {
    // Probes are intentionally unauthenticated (routes/health.ts) *and* internal —
    // that pairing is only safe because they are not externally reachable. This
    // pins the pairing so flipping a probe to external without adding auth fails here.
    for (const [k, exposure] of Object.entries(ENDPOINT_EXPOSURE)) {
      if (exposure === 'internal') {
        const route = API_ROUTES.find((r) => key(r) === k);
        expect(route?.guard, `${k} is internal`).toBe('none');
      }
    }
  });

  it('exposureKey matches the registry key shape', () => {
    expect(exposureKey('get', '/api/db/documents')).toBe('GET /api/db/documents');
  });
});
