/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps a corporate Active Directory user name to an EKOS PortalUser, which is
 * what the RBAC layer (src/utils/rbac.ts) consumes. This is the one seam where
 * "who the corporate IdP says you are" becomes "what you may do in EKOS".
 *
 * Backed by the `user_directory` table (docs/AUTH_INTEGRATION_PLAN.md §5,
 * decision #1 — a DB directory rather than deriving roles from AD `authorities`
 * claims). The table is seeded from src/constants/users.ts (corporate_username
 * = email local-part) as the bridge from the interim roster, and maintained by
 * admins thereafter. A corporate user with no active row resolves to
 * `undefined`, and the caller MUST fail closed — authenticated is not
 * authorized.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/db.ts";
import { userDirectory } from "../../db/schema.ts";
import type { PortalUser, UserRole } from "../../types/index.ts";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parsePermissions(value: string): PortalUser["permissions"] {
  try {
    const p = JSON.parse(value) ?? {};
    return {
      manageRates: !!p.manageRates,
      manageForwarding: !!p.manageForwarding,
      manageClients: !!p.manageClients,
      viewLogs: !!p.viewLogs,
      manageAiAgents: !!p.manageAiAgents,
      manageKnowledgeBase: !!p.manageKnowledgeBase,
    };
  } catch {
    return {
      manageRates: false,
      manageForwarding: false,
      manageClients: false,
      viewLogs: false,
      manageAiAgents: false,
      manageKnowledgeBase: false,
    };
  }
}

export function resolveEksUser(corporateUsername: string | undefined): PortalUser | undefined {
  if (!corporateUsername) return undefined;
  const key = corporateUsername.trim().toLowerCase();
  if (!key) return undefined;

  const row = db.select().from(userDirectory).where(eq(userDirectory.corporateUsername, key)).all()[0];
  if (!row) return undefined;
  if (row.status === "Inactive") return undefined; // provisioned but disabled — fail closed

  return {
    id: row.ekosUserId,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    status: row.status === "Away" ? "Away" : "Active",
    brandIds: parseJsonArray(row.brandIds),
    departmentIds: parseJsonArray(row.departmentIds),
    lastActive: "via SSO",
    permissions: parsePermissions(row.permissions),
  };
}
