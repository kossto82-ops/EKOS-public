/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Endpoint exposure classification — the EKOS translation of
 * `coding-guidelines/Rules/guidelines/SecurityGuidelines.md` §12.
 *
 * Exposure answers a question authentication does not: *from which network is
 * this endpoint reachable?* — orthogonal to *who may call it*. §12's core point
 * is that exposure is an **intent that cannot be inferred from code** (at dev
 * time every route is reachable; there is no LB in front), so it must be
 * **declared**, or it gets forgotten — the EB-3900 incident.
 *
 * How this maps to EKOS specifically:
 *   - EKOS is a standalone app (its own Express server + deployment), NOT one of
 *     the services behind the corporate shared LB whose `external_lb_whitelist.yaml`
 *     §12 governs. So there is no corporate whitelist file to edit here; inventing
 *     one would be fiction. What §12 still buys us is the *decision* and the *gate*.
 *   - `external` = reachable from the end-user browser (the React SPA is served to
 *     users and calls these directly). If EKOS is ever fronted by a path-whitelisting
 *     LB/gateway, the `external` set below is exactly the allowlist.
 *   - `internal` = reached only by infrastructure (orchestrator/LB health checks),
 *     never by the public browser. These must NOT be exposed publicly.
 *
 * This map is the source of truth. `tests/exposureClassification.test.ts` fails if
 * it drifts from the route registry (a new route with no classification is a
 * failing test, not an oversight — the §12 "guaranteed gate"), and `openapi.ts`
 * stamps each operation with `x-exposure`.
 */

export type Exposure = "internal" | "external";

/** `${METHOD} ${expressPath}` — same key shape as apiRegistry route keys. */
export const ENDPOINT_EXPOSURE: Record<string, Exposure> = {
  // Operational probes — infrastructure only, never the public browser.
  "GET /healthz": "internal",
  "GET /readyz": "internal",

  // Auth handshake + session — browser-facing.
  "GET /auth/login": "external",
  "GET /auth/callback": "external",
  "POST /auth/logout": "external",
  "GET /auth/me": "external",

  // Documents.
  "GET /api/db/documents": "external",
  "POST /api/db/documents": "external",
  "PATCH /api/db/documents/:id": "external",
  "POST /api/db/documents/governance-decision": "external",
  "DELETE /api/db/documents/:id": "external",

  // Sources.
  "GET /api/db/sources": "external",
  "POST /api/db/sources": "external",
  "POST /api/db/sources/:id/status": "external",

  // Sync.
  "GET /api/db/sync/status": "external",
  "POST /api/db/sync/run": "external",
  "GET /api/db/sync/sharepoint/status": "external",
  "POST /api/db/sync/sharepoint": "external",

  // Governance.
  "GET /api/db/governance/ai-config": "external",
  "POST /api/db/governance/ai-config": "external",
  "GET /api/db/governance/desk-settings": "external",
  "POST /api/db/governance/desk-settings": "external",
  "GET /api/db/governance/gaps": "external",
  "POST /api/db/governance/gaps": "external",
  "GET /api/db/governance/tasks": "external",
  "POST /api/db/governance/tasks": "external",
  "POST /api/db/governance/report": "external",

  // Brands.
  "GET /api/db/brands": "external",
  "POST /api/db/brands": "external",
  "PATCH /api/db/brands/:id": "external",
  "PATCH /api/db/brands/:id/status": "external",

  // AI / retrieval.
  "POST /api/search": "external",
  "POST /api/kb-chat": "external",
  "POST /api/copilot-generate": "external",
  "POST /api/copilot-draft": "external",
  "POST /api/crm/cases": "external",
  "POST /api/test-ai-connection": "external",
  "GET /api/embeddings/status": "external",
  "POST /api/embeddings/backfill": "external",
  "GET /api/debug-db": "external",
};

export function exposureKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Classified exposure for a route, or undefined if it was never declared. */
export function exposureFor(method: string, path: string): Exposure | undefined {
  return ENDPOINT_EXPOSURE[exposureKey(method, path)];
}
