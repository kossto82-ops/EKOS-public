/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side session store + signed-cookie helpers for the BFF login flow
 * (docs/AUTH_INTEGRATION_PLAN.md §4). The browser only ever holds a signed,
 * httpOnly session-id cookie; the corporate tokens live in the auth_sessions
 * table, encrypted at rest. No new dependency: cookie signing is HMAC-SHA256,
 * parsing is a small manual reader.
 */

import crypto from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/db.ts";
import { authSessions } from "../../db/schema.ts";
import { encryptValue, decryptValue } from "../crypto.ts";
import { logger } from "../logger.ts";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "ekos_session";
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_HOURS) || 8) * 60 * 60 * 1000;
// Inactivity timeout: a session with no authenticated request for this long is
// dead, independently of the absolute 8h cap above (SECURITY.md §1). Every
// authenticated request touches lastSeenAt (see getActiveSession), so this
// measures real inactivity. Set SESSION_IDLE_MINUTES=0 to disable. Default 30m —
// comfortably above the client-side IdleLockScreen's 10m UX lock.
const SESSION_IDLE_MS = (() => {
  const raw = process.env.SESSION_IDLE_MINUTES;
  const minutes = raw === undefined || raw === "" ? 30 : Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 0;
})();

// Signing key for the cookie. Falls back to ENCRYPTION_SECRET, then a dev-only
// constant — the same posture as src/server/crypto.ts. The cookie value is a
// high-entropy random id regardless; the signature only detects tampering.
const COOKIE_SIGNING_KEY =
  process.env.SESSION_COOKIE_SECRET || process.env.ENCRYPTION_SECRET || "dev-only-cookie-secret-change-me";

function sign(sessionId: string): string {
  const sig = crypto.createHmac("sha256", COOKIE_SIGNING_KEY).update(sessionId).digest("base64url");
  return `${sessionId}.${sig}`;
}

function verify(signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = signed.slice(0, dot);
  const provided = signed.slice(dot + 1);
  const expected = crypto.createHmac("sha256", COOKIE_SIGNING_KEY).update(sessionId).digest("base64url");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

/** Parse one cookie value out of the Cookie header, without a dependency. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return verify(value);
  }
  return null;
}

export interface NewSessionInput {
  ekosUserId: string;
  corporateUsername: string;
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExp?: number | null;
}

/** Create a session row and return its opaque id (unsigned). */
export function createSession(input: NewSessionInput): string {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  db.insert(authSessions)
    .values({
      id,
      ekosUserId: input.ekosUserId,
      corporateUsername: input.corporateUsername,
      accessTokenEnc: encryptValue(input.accessToken),
      refreshTokenEnc: input.refreshToken ? encryptValue(input.refreshToken) : null,
      accessTokenExp: input.accessTokenExp ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      lastSeenAt: now.toISOString(),
    })
    .run();
  return id;
}

export interface ActiveSession {
  id: string;
  ekosUserId: string;
  corporateUsername: string;
}

/**
 * Look up a session by the (already signature-verified) id, enforcing absolute
 * expiry. Returns null and deletes the row when expired. Touches lastSeenAt.
 */
export function getActiveSession(sessionId: string): ActiveSession | null {
  const row = db.select().from(authSessions).where(eq(authSessions.id, sessionId)).all()[0];
  if (!row) return null;
  const now = Date.now();
  // Absolute lifetime cap.
  if (new Date(row.expiresAt).getTime() <= now) {
    deleteSession(sessionId);
    return null;
  }
  // Inactivity timeout — dead if no authenticated request within the window.
  if (SESSION_IDLE_MS > 0 && now - new Date(row.lastSeenAt).getTime() > SESSION_IDLE_MS) {
    deleteSession(sessionId);
    return null;
  }
  db.update(authSessions).set({ lastSeenAt: new Date(now).toISOString() }).where(eq(authSessions.id, sessionId)).run();
  return { id: row.id, ekosUserId: row.ekosUserId, corporateUsername: row.corporateUsername };
}

/** The stored corporate access token for a session, decrypted. For token refresh (Phase 4). */
export function getSessionAccessToken(sessionId: string): string | null {
  const row = db.select().from(authSessions).where(eq(authSessions.id, sessionId)).all()[0];
  if (!row) return null;
  try {
    return decryptValue(row.accessTokenEnc);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "auth: failed to decrypt session access token");
    return null;
  }
}

export function deleteSession(sessionId: string): void {
  db.delete(authSessions).where(eq(authSessions.id, sessionId)).run();
}

/** Set the signed, httpOnly session cookie on the response. */
export function setSessionCookie(res: Response, sessionId: string): void {
  const secure = process.env.NODE_ENV === "production";
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(sign(sessionId))}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    ...(secure ? ["Secure"] : []),
  ];
  res.append("Set-Cookie", attrs.join("; "));
}

/** Expire the session cookie on the response. */
export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production";
  const attrs = [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ];
  res.append("Set-Cookie", attrs.join("; "));
}
