/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BFF login flow against the corporate OAuth2 authorization server
 * (docs/AUTH_INTEGRATION_PLAN.md §4). Authorization-code + PKCE, run entirely
 * server-side: the browser never sees an OAuth token, only a signed httpOnly
 * session cookie.
 *
 *   GET  /auth/login    → 302 to the corporate /oauth/authorize (state + PKCE)
 *   GET  /auth/callback → exchange code for tokens, create session, set cookie
 *   POST /auth/logout   → destroy session + clear cookie
 *   GET  /auth/me       → the current caller's EKOS identity (requireUser)
 */

import crypto from "node:crypto";
import express from "express";
import { requireUser } from "../middleware/auth.ts";
import { asyncHandler, fail } from "../middleware/errors.ts";
import { withTimeout } from "../aiClient.ts";
import { logger } from "../logger.ts";
import { getAuthConfig } from "../auth/config.ts";
import { introspectToken } from "../auth/introspect.ts";
import { resolveEksUser } from "../auth/identityMap.ts";
import { createSession, setSessionCookie, clearSessionCookie, readSessionCookie, deleteSession } from "../auth/session.ts";

export const router = express.Router();

// Transient login handshake state: state → PKCE verifier. In-memory and TTL'd,
// because it only has to survive the seconds between /auth/login and the
// browser returning to /auth/callback. A server restart mid-login just means
// the user clicks login again — nothing to persist.
const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingLogins = new Map<string, { verifier: string; createdAt: number }>();

function prunePending(now: number) {
  for (const [state, entry] of pendingLogins) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingLogins.delete(state);
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function notConfigured(res: express.Response) {
  return fail(
    res,
    503,
    "ERR_AUTH_NOT_CONFIGURED",
    "Corporate authentication is not configured on this deployment (AUTH_CLIENT_ID/SECRET unset)."
  );
}

// GET /auth/login — start the authorization-code + PKCE flow.
router.get("/auth/login", (req, res) => {
  const cfg = getAuthConfig();
  if (cfg.mode !== "oauth") return notConfigured(res);

  const now = Date.now();
  prunePending(now);

  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  pendingLogins.set(state, { verifier, createdAt: now });

  const url = new URL(`${cfg.baseUrl}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.callbackUrl);
  url.searchParams.set("scope", cfg.scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return res.redirect(302, url.toString());
});

// GET /auth/callback — the auth server returns here with ?code&state.
router.get(
  "/auth/callback",
  asyncHandler(async (req, res) => {
    const cfg = getAuthConfig();
    if (cfg.mode !== "oauth") return notConfigured(res);

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      return fail(res, 400, "ERR_INVALID_INPUT", "Missing authorization code or state.");
    }

    // Single-use state — consume it whether or not the rest succeeds.
    const pending = pendingLogins.get(state);
    pendingLogins.delete(state);
    if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
      return fail(res, 400, "ERR_INVALID_STATE", "Login state is invalid or has expired. Please start again.");
    }

    // Exchange the code for tokens (Basic client auth + PKCE verifier).
    let tokenBody: { access_token?: string; refresh_token?: string; expires_in?: number };
    try {
      const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
      const tokenRes = await withTimeout(
        fetch(`${cfg.baseUrl}/oauth/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: cfg.callbackUrl,
            code_verifier: pending.verifier,
          }).toString(),
        }),
        cfg.requestTimeoutMs,
        "oauth token exchange"
      );
      if (!tokenRes.ok) {
        logger.warn({ status: tokenRes.status }, "auth: token exchange returned non-2xx");
        return fail(res, 401, "ERR_UNAUTHORIZED", "Could not complete sign-in. Please try again.");
      }
      tokenBody = (await tokenRes.json()) as typeof tokenBody;
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, "auth: token exchange failed");
      return fail(res, 502, "ERR_AUTH_UPSTREAM", "The authentication server is unavailable. Please try again.");
    }

    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      return fail(res, 401, "ERR_UNAUTHORIZED", "Could not complete sign-in. Please try again.");
    }

    // Resolve the corporate identity, then map to an EKOS user. Authenticated
    // but unprovisioned fails closed — no session is created.
    const identity = await introspectToken(accessToken);
    if (!identity) {
      return fail(res, 401, "ERR_UNAUTHORIZED", "Could not verify the signed-in identity.");
    }
    const user = resolveEksUser(identity.username);
    if (!user) {
      return fail(res, 403, "ERR_FORBIDDEN", "Authenticated user has no EKOS access provisioned.");
    }

    const sessionId = createSession({
      ekosUserId: user.id,
      corporateUsername: identity.username,
      accessToken,
      refreshToken: tokenBody.refresh_token ?? null,
      accessTokenExp: identity.exp ?? null,
    });
    setSessionCookie(res, sessionId);
    return res.redirect(302, cfg.postLoginRedirect);
  })
);

// POST /auth/logout — destroy the session. Works even if the cookie is already
// gone (idempotent), so it is not behind requireUser.
router.post("/auth/logout", (req, res) => {
  const sessionId = readSessionCookie(req);
  if (sessionId) deleteSession(sessionId);
  clearSessionCookie(res);
  return res.json({ success: true });
});

// GET /auth/me — the current caller's EKOS identity. requireUser resolves it
// from the session cookie (or a Bearer token) and enforces mode.
router.get(
  "/auth/me",
  requireUser,
  asyncHandler(async (req, res) => {
    return res.json({ success: true, data: req.user });
  })
);
