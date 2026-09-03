/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from "express";
import { fail } from "./errors.ts";
import { INITIAL_USERS } from "../../constants/users.ts";
import { canAccessTab, canPerformGovernanceAction, GovernanceAction } from "../../utils/rbac.ts";
import type { PortalUser, Tab } from "../../types/index.ts";
import { getAuthConfig } from "../auth/config.ts";
import { introspectToken } from "../auth/introspect.ts";
import { resolveEksUser } from "../auth/identityMap.ts";
import { readSessionCookie, getActiveSession } from "../auth/session.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PortalUser;
    }
  }
}

// SECURITY MODEL NOTE: this middleware runs in one of two modes, selected by
// configuration (src/server/auth/config.ts, docs/AUTH_INTEGRATION_PLAN.md):
//
//   • "oauth"  — the target state. The Bearer token is an OPAQUE corporate
//     access token, validated by introspection against the corporate
//     authorization server (src/server/auth/introspect.ts) and mapped to an
//     EKOS user (src/server/auth/identityMap.ts). Identity is now
//     cryptographically established by a party that holds the token, not merely
//     asserted — this closes the spoofing gap. A validated corporate user with
//     no EKOS mapping is authenticated but NOT authorized: it fails closed 403.
//
//   • "legacy" — the interim scheme, active only when OAuth is not configured.
//     The Bearer token is an unsigned user id matched against INITIAL_USERS.
//     There is no proof the caller is who they claim; a party that knows a
//     valid id can impersonate them. This narrows but does not close the
//     finding in docs/KNOWN_LIMITATIONS.md, and exists so local development,
//     the demo, and the pre-IdP deployment keep working.
//
// In BOTH modes, every downstream route re-checks the resolved identity's
// role/department against the same rbac.ts rules the UI uses (requireTab /
// requireAction below), so authorization can never be bypassed by calling the
// API directly.
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.header("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    // NB: no early "missing token" return here — in oauth mode a browser
    // authenticates by session cookie and sends no Bearer at all. Each branch
    // below rejects an empty credential itself (legacy: an empty id matches no
    // user → 401).

    if (getAuthConfig().mode === "oauth") {
      // BFF path: a signed session cookie is the primary credential for the SPA.
      // The corporate token was already validated at /auth/callback and stored
      // server-side, so a valid session needs no per-request introspection.
      const sessionId = readSessionCookie(req);
      if (sessionId) {
        const session = getActiveSession(sessionId);
        if (session) {
          const sessionUser = resolveEksUser(session.corporateUsername);
          if (!sessionUser) {
            // The session is live but the directory entry was revoked — fail closed.
            return fail(res, 403, "ERR_FORBIDDEN", "Authenticated user has no EKOS access provisioned");
          }
          req.user = sessionUser;
          return next();
        }
        // Expired/unknown session: fall through to a Bearer token if one was sent.
      }

      // Bearer path: an opaque corporate token, validated by introspection.
      // (Direct API clients / service-to-service; the browser uses the cookie.)
      if (!token) {
        return fail(res, 401, "ERR_UNAUTHORIZED", "Missing or unrecognized caller identity");
      }
      const identity = await introspectToken(token);
      if (!identity) {
        return fail(res, 401, "ERR_UNAUTHORIZED", "Missing or unrecognized caller identity");
      }
      const user = resolveEksUser(identity.username);
      if (!user) {
        // Authenticated against the corporate IdP, but not provisioned in EKOS.
        // authN succeeded, authZ did not — fail closed.
        return fail(res, 403, "ERR_FORBIDDEN", "Authenticated user has no EKOS access provisioned");
      }
      req.user = user;
      return next();
    }

    // legacy mode
    const user = INITIAL_USERS.find((u) => u.id === token);
    if (!user) {
      return fail(res, 401, "ERR_UNAUTHORIZED", "Missing or unrecognized caller identity");
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireTab(tab: Tab) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || !canAccessTab(user.role, user.departmentIds || [], tab)) {
      return fail(
        res,
        403,
        "ERR_FORBIDDEN",
        `Role "${user?.role ?? "unknown"}" is not permitted to access the "${tab}" area`
      );
    }
    next();
  };
}

export function requireAction(action: GovernanceAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || !canPerformGovernanceAction(user.role, user.departmentIds || [], action)) {
      return fail(
        res,
        403,
        "ERR_FORBIDDEN",
        `Role "${user?.role ?? "unknown"}" is not permitted to perform "${action}"`
      );
    }
    next();
  };
}
