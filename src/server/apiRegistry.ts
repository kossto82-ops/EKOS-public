/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ZodType } from "zod";
import * as req from "./schemas/apiSchemas.ts";
import * as res from "./schemas/responseSchemas.ts";

/**
 * Every route this server exposes, in one table.
 *
 * Why a registry rather than decorating the route files: the API's description
 * lived in `docs/API_SPECIFICATION.md`, maintained by hand. Prose cannot be
 * checked against an Express router, so the only defence against drift was
 * somebody remembering — and the docs had already gone stale twice (a "1 MB body
 * cap" that was really 100kb, an "Authentication: None" claim that outlived
 * server-side RBAC by months).
 *
 * With the routes listed here:
 *  - `src/server/openapi.ts` generates the OpenAPI document from these schemas, so
 *    the published contract is derived from the code rather than described beside it;
 *  - `tests/apiSurface.test.ts` walks the real Express router stacks and fails if a
 *    route exists that is not registered, or is registered but not mounted. Adding
 *    an endpoint without describing it is now a failing test, not an oversight.
 *
 * `response` is the **success** shape; failures are uniform
 * (`res.failureEnvelope`) and asserted separately.
 */
export interface RouteSpec {
  method: "get" | "post" | "patch" | "delete";
  /** Express path, with `:param` segments. Converted to `{param}` for OpenAPI. */
  path: string;
  summary: string;
  tag: string;
  /**
   * Server-side authorization, as enforced by src/server/middleware/auth.ts.
   * `none` marks the unauthenticated operational probes.
   */
  guard: "none" | "requireUser" | `requireTab:${string}` | `requireAction:${string}`;
  requestBody?: ZodType;
  requestQuery?: ZodType;
  response: ZodType;
  /** Marks a route whose response depends on an external AI/Graph call. */
  externalDependency?: boolean;
}

export const API_ROUTES: RouteSpec[] = [
  // -- Operational (unauthenticated by necessity; see routes/health.ts) --------
  {
    method: "get",
    path: "/healthz",
    summary: "Liveness. Process state only — touches no dependency.",
    tag: "operations",
    guard: "none",
    response: res.healthzResponse,
  },
  {
    method: "get",
    path: "/readyz",
    summary: "Readiness over database, migrations, vector index and SharePoint credentials. 503 when a required check fails.",
    tag: "operations",
    guard: "none",
    response: res.readyzResponse,
  },

  // -- Auth (BFF login flow) --------------------------------------------------
  {
    method: "get",
    path: "/auth/login",
    summary: "Start the corporate authorization-code + PKCE flow. 302 to the auth server; 503 when OAuth is not configured.",
    tag: "auth",
    guard: "none",
    response: res.authRedirectResponse,
    externalDependency: true,
  },
  {
    method: "get",
    path: "/auth/callback",
    summary: "OAuth redirect target. Exchanges the code for tokens, creates a server-side session and sets the cookie.",
    tag: "auth",
    guard: "none",
    response: res.authRedirectResponse,
    externalDependency: true,
  },
  {
    method: "post",
    path: "/auth/logout",
    summary: "Destroy the current session and clear the cookie. Idempotent — succeeds even with no session.",
    tag: "auth",
    guard: "none",
    response: res.authLogoutResponse,
  },
  {
    method: "get",
    path: "/auth/me",
    summary: "The current caller's EKOS identity, resolved from the session cookie or a bearer token.",
    tag: "auth",
    guard: "requireUser",
    response: res.authMeResponse,
  },

  // -- Documents --------------------------------------------------------------
  {
    method: "get",
    path: "/api/db/documents",
    summary: "List documents, scoped server-side to the caller's brands and departments.",
    tag: "documents",
    guard: "requireUser",
    requestQuery: req.DocumentsQuerySchema,
    response: res.documentsListResponse,
  },
  {
    method: "post",
    path: "/api/db/documents",
    summary: "Create a document with its first version and chunk rows.",
    tag: "documents",
    guard: "requireAction:upload_kb",
    requestBody: req.DocumentCreateSchema,
    response: res.documentCreateResponse,
  },
  {
    method: "patch",
    path: "/api/db/documents/:id",
    summary: "Partial update. Three permission tiers are enforced inside the handler.",
    tag: "documents",
    guard: "requireUser",
    requestBody: req.DocumentPatchSchema,
    response: res.documentPatchResponse,
  },
  {
    method: "post",
    path: "/api/db/documents/governance-decision",
    summary: "Approve / reject / ban a document by name.",
    tag: "documents",
    guard: "requireUser",
    requestBody: req.GovernanceDecisionSchema,
    response: res.governanceDecisionResponse,
  },
  {
    method: "delete",
    path: "/api/db/documents/:id",
    summary: "Soft-delete a document (sets deleted_at; the row is kept so the seeder cannot resurrect it).",
    tag: "documents",
    guard: "requireAction:upload_kb",
    response: res.documentDeleteResponse,
  },

  // -- Sources ----------------------------------------------------------------
  {
    method: "get",
    path: "/api/db/sources",
    summary: "List connected knowledge sources.",
    tag: "sources",
    guard: "requireUser",
    response: res.sourcesListResponse,
  },
  {
    method: "post",
    path: "/api/db/sources",
    summary: "Upsert the source list atomically.",
    tag: "sources",
    guard: "requireAction:upload_kb",
    requestBody: req.SourcesUpsertSchema,
    response: res.okEmpty,
  },
  {
    method: "post",
    path: "/api/db/sources/:id/status",
    summary: "Set one source's status.",
    tag: "sources",
    guard: "requireAction:upload_kb",
    requestBody: req.SourceStatusSchema,
    response: res.sourceStatusResponse,
  },

  // -- Sync -------------------------------------------------------------------
  {
    method: "get",
    path: "/api/db/sync/status",
    summary: "Sync log and index telemetry derived from the live corpus.",
    tag: "sync",
    guard: "requireTab:sync",
    response: res.syncStatusResponse,
  },
  {
    method: "post",
    path: "/api/db/sync/run",
    summary: "Record a sync job row. Rejects an unknown sourceId with 400.",
    tag: "sync",
    guard: "requireTab:sync",
    requestBody: req.SyncRunSchema,
    response: res.syncRunResponse,
  },
  {
    method: "get",
    path: "/api/db/sync/sharepoint/status",
    summary: "Whether Microsoft Graph credentials are configured.",
    tag: "sync",
    guard: "requireTab:sync",
    response: res.sharepointStatusResponse,
  },
  {
    method: "post",
    path: "/api/db/sync/sharepoint",
    summary: "Crawl the SharePoint library and upsert every document. 200 with configured:false when unconfigured.",
    tag: "sync",
    guard: "requireTab:sync",
    response: res.sharepointSyncResponse,
    externalDependency: true,
  },

  // -- Governance -------------------------------------------------------------
  {
    method: "get",
    path: "/api/db/governance/ai-config",
    summary: "Stored AI provider config, with the key masked.",
    tag: "governance",
    guard: "requireTab:settings",
    response: res.aiConfigResponse,
  },
  {
    method: "post",
    path: "/api/db/governance/ai-config",
    summary: "Replace the AI provider config. Validated against the same schema the settings form uses.",
    tag: "governance",
    guard: "requireAction:manage_governance",
    requestBody: req.AiConfigSaveSchema,
    response: res.okEmpty,
  },
  {
    method: "get",
    path: "/api/db/governance/desk-settings",
    summary: "Desk response thresholds.",
    tag: "governance",
    guard: "requireTab:settings",
    response: res.deskSettingsResponse,
  },
  {
    method: "post",
    path: "/api/db/governance/desk-settings",
    summary: "Replace the desk thresholds.",
    tag: "governance",
    guard: "requireAction:manage_governance",
    requestBody: req.DeskSettingsSaveSchema,
    response: res.okEmpty,
  },
  {
    method: "get",
    path: "/api/db/governance/gaps",
    summary: "Recorded search gaps — queries that matched nothing.",
    tag: "governance",
    guard: "requireTab:governance",
    response: res.searchGapsResponse,
  },
  {
    method: "post",
    path: "/api/db/governance/gaps",
    summary: "Upsert the search-gap list atomically.",
    tag: "governance",
    guard: "requireAction:manage_governance",
    requestBody: req.SearchGapsSaveSchema,
    response: res.okEmpty,
  },
  {
    method: "get",
    path: "/api/db/governance/tasks",
    summary: "Review queue tasks.",
    tag: "governance",
    guard: "requireTab:governance",
    response: res.reviewTasksResponse,
  },
  {
    method: "post",
    path: "/api/db/governance/tasks",
    summary: "Replace the review queue. Re-approving an already-resolved task is blocked server-side and counted.",
    tag: "governance",
    guard: "requireAction:manage_governance",
    requestBody: req.ReviewTasksSaveSchema,
    response: res.reviewTasksSaveResponse,
  },
  {
    method: "post",
    path: "/api/db/governance/report",
    summary: "File a review task from a reported issue. Status is forced to 'Feedback Received'.",
    tag: "governance",
    guard: "requireUser",
    requestBody: req.ReviewTaskReportSchema,
    response: res.reportResponse,
  },

  // -- Brands -----------------------------------------------------------------
  {
    method: "get",
    path: "/api/db/brands",
    summary: "List brands with their VAT and pricing data.",
    tag: "brands",
    guard: "requireUser",
    response: res.brandsListResponse,
  },
  {
    method: "post",
    path: "/api/db/brands",
    summary: "Create a brand.",
    tag: "brands",
    guard: "requireAction:manage_rates",
    requestBody: req.BrandCreateSchema,
    response: res.brandResponse,
  },
  {
    method: "patch",
    path: "/api/db/brands/:id",
    summary: "Partial brand update.",
    tag: "brands",
    guard: "requireAction:manage_rates",
    requestBody: req.BrandPatchSchema,
    response: res.brandResponse,
  },
  {
    method: "patch",
    path: "/api/db/brands/:id/status",
    summary: "Activate or deactivate a brand.",
    tag: "brands",
    guard: "requireAction:manage_rates",
    requestBody: req.BrandStatusSchema,
    response: res.brandResponse,
  },

  // -- AI / retrieval ---------------------------------------------------------
  {
    method: "post",
    path: "/api/search",
    summary: "Grounded knowledge search. Degrades to a content-grounded local fallback when the provider fails.",
    tag: "ai",
    guard: "requireUser",
    requestBody: req.SearchSchema,
    response: res.searchResponse,
    externalDependency: true,
  },
  {
    method: "post",
    path: "/api/kb-chat",
    summary: "Conversational turn grounded in server-loaded, caller-scoped documents.",
    tag: "ai",
    guard: "requireUser",
    requestBody: req.KbChatSchema,
    response: res.kbChatResponse,
    externalDependency: true,
  },
  {
    method: "post",
    path: "/api/copilot-generate",
    summary: "Free-form copilot text generation.",
    tag: "ai",
    guard: "requireUser",
    requestBody: req.CopilotGenerateSchema,
    response: res.copilotGenerateResponse,
    externalDependency: true,
  },
  {
    method: "post",
    path: "/api/copilot-draft",
    summary: "Structured draft (complaint reply / outbound email / CRM note) with brand facts resolved server-side.",
    tag: "ai",
    guard: "requireUser",
    requestBody: req.CopilotDraftSchema,
    response: res.copilotDraftResponse,
    externalDependency: true,
  },
  {
    method: "post",
    path: "/api/crm/cases",
    summary: "Stub — always returns an empty case list. Not backed by a table.",
    tag: "ai",
    guard: "requireUser",
    response: res.crmCasesResponse,
  },
  {
    method: "post",
    path: "/api/test-ai-connection",
    summary: "Live (billable) provider ping to verify credentials before saving them.",
    tag: "ai",
    guard: "requireTab:settings",
    requestBody: req.AiConnectionTestSchema,
    response: res.aiConnectionTestResponse,
    externalDependency: true,
  },
  {
    method: "get",
    path: "/api/embeddings/status",
    summary: "Vector-index coverage. Answers whether semantic search is actually live.",
    tag: "ai",
    guard: "requireTab:settings",
    response: res.embeddingStatusResponse,
  },
  {
    method: "post",
    path: "/api/embeddings/backfill",
    summary: "Embed chunks with no vector for the current signature. Deliberately manual — it costs provider calls over the whole corpus.",
    tag: "ai",
    guard: "requireTab:settings",
    requestBody: req.EmbeddingBackfillSchema,
    response: res.embeddingBackfillResponse,
    externalDependency: true,
  },
  {
    method: "get",
    path: "/api/debug-db",
    summary: "Debug: the raw ai_provider_config row with its key redacted. Not intended for production.",
    tag: "ai",
    guard: "requireTab:settings",
    response: res.debugDbResponse,
  },
];

/** Express `:param` → OpenAPI `{param}`. */
export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Path parameter names in declaration order. */
export function pathParams(expressPath: string): string[] {
  return [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}
