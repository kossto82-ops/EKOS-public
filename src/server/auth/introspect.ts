/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token introspection against the corporate OAuth2 authorization server.
 *
 * The corporate server issues OPAQUE bearer tokens (UUID-shaped), not signed
 * JWTs (docs/AUTH_INTEGRATION_PLAN.md §2), so a token cannot be verified by
 * checking a local signature — it must be introspected over the network. That
 * makes two things mandatory:
 *   1. Fail closed. Any non-active result, expiry, non-2xx, malformed body, or
 *      transport error resolves to `null` (unauthenticated) — never to a
 *      partially-trusted identity.
 *   2. Cache. Without a short-TTL cache every EKOS request becomes two upstream
 *      round-trips; with it, a burst of requests on one session pays the auth
 *      server once per TTL window.
 */

import { withTimeout } from "../aiClient.ts";
import { logger } from "../logger.ts";
import { getAuthConfig } from "./config.ts";

export interface CorporateIdentity {
  /** The Active Directory user name — the key we map to an EKOS user. */
  username: string;
  email?: string;
  authorities: string[];
  /** Unix seconds, when the auth server reports it. */
  exp?: number;
}

interface CacheEntry {
  identity: CorporateIdentity;
  expiresAt: number; // ms epoch
}

// Bounded to keep a flood of distinct (e.g. forged) tokens from growing the map
// without limit. Insertion-ordered eviction of the oldest entry is enough here —
// this is a freshness cache, not an access-optimised LRU.
const MAX_CACHE_ENTRIES = 1000;
const cache = new Map<string, CacheEntry>();

/** Test-only: drop all cached introspection results. */
export function __clearIntrospectionCache(): void {
  cache.clear();
}

function cacheGet(token: string, now: number): CorporateIdentity | undefined {
  const hit = cache.get(token);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(token);
    return undefined;
  }
  return hit.identity;
}

function cacheSet(token: string, identity: CorporateIdentity, now: number, ttlMs: number): void {
  // Never cache past the token's own expiry.
  let expiresAt = now + ttlMs;
  if (typeof identity.exp === "number") {
    expiresAt = Math.min(expiresAt, identity.exp * 1000);
  }
  if (expiresAt <= now) return; // already expired — don't cache
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(token, { identity, expiresAt });
}

/**
 * Validate an opaque access token and resolve the caller's corporate identity.
 * Returns `null` for anything that is not a live, active token — the caller
 * must treat `null` as unauthenticated.
 */
export async function introspectToken(token: string): Promise<CorporateIdentity | null> {
  if (!token) return null;

  const cfg = getAuthConfig();
  const now = Date.now();

  const cached = cacheGet(token, now);
  if (cached) return cached;

  try {
    // 1) Introspect: is this token active, and whose is it?
    const introspectRes = await withTimeout(
      fetch(`${cfg.baseUrl}/oauth/check_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      }),
      cfg.requestTimeoutMs,
      "oauth check_token"
    );

    if (!introspectRes.ok) {
      logger.warn({ status: introspectRes.status }, "auth: check_token returned non-2xx — failing closed");
      return null;
    }

    const data = (await introspectRes.json()) as {
      active?: boolean;
      exp?: number;
      user_name?: string;
      authorities?: string[];
    };

    if (!data || data.active !== true || !data.user_name) return null;
    if (typeof data.exp === "number" && data.exp * 1000 <= now) return null;

    // 2) Enrich with user details (email; also honours a disabled account).
    // Best-effort: the username from introspection is enough to authenticate and
    // map, so a userdetails hiccup must not deny an otherwise-valid caller.
    let email: string | undefined;
    try {
      const detailsRes = await withTimeout(
        fetch(`${cfg.baseUrl}/userdetails`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }),
        cfg.requestTimeoutMs,
        "oauth userdetails"
      );
      if (detailsRes.ok) {
        const details = (await detailsRes.json()) as { email?: string; enabled?: boolean };
        if (details.enabled === false) return null; // disabled account — fail closed
        email = details.email;
      }
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, "auth: userdetails lookup failed — continuing with introspection identity");
    }

    const identity: CorporateIdentity = {
      username: data.user_name,
      email,
      authorities: Array.isArray(data.authorities) ? data.authorities : [],
      exp: data.exp,
    };

    cacheSet(token, identity, now, cfg.introspectionTtlMs);
    return identity;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "auth: token introspection failed — failing closed");
    return null;
  }
}
