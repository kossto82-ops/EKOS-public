# API Specifications & Contracts

**Purpose:** This document standardizes the API request/response structures, HTTP methods, headers, and response formats for the Enterprise Knowledge Platform. It acts as the contract between front-end interfaces and server-side processors.

> **The machine-readable contract is [openapi.json](./openapi.json)**, generated from `src/server/apiRegistry.ts` by `npm run api:spec` — request schemas come from `src/server/schemas/apiSchemas.ts` (the ones the server validates with) and response schemas from `src/server/schemas/responseSchemas.ts` (the ones tests assert against). It cannot describe a field the code does not enforce, and `tests/apiSurface.test.ts` fails if it is stale, if a mounted route is missing from the registry, or if a registered route no longer exists.
>
> **This document is the prose companion, not the source of truth.** Where the two disagree, the generated spec is right and this file has drifted — it has done so before, claiming a "1 MB body cap" that was really 100 kb, and denying that any authentication existed for months after server-side RBAC shipped (a claim `tests/docsDrift.test.ts` now greps for, which is why it is paraphrased rather than quoted here).
**Owner:** Staff Software Architect
**Last Updated:** 2026-07-29
**Status:** Approved Template

---

## 1. Global API Conventions — Current Prototype

- **Protocol**: HTTP/1.1 over TLS (TLS termination happens at the hosting platform in production; the Express app itself serves plain HTTP).
- **Base Route Pattern**: No versioning prefix — all routes are mounted directly under `/api/...` (there is no `/api/v1`).
- **Payload Format**: `application/json`, capped at **20MB** per request (`express.json({ limit: '20mb' })`), matching the client's `MAX_UPLOAD_BYTES` for KB uploads. (Until 2026-08-05 a duplicate, limit-less `express.json()` registration ran first, so body-parser's 100kb default was the ceiling actually in force and any larger upload was rejected with 413 — see git history.)
- **Authentication & Authorization**: Interim, pre-IdP — but **enforced server-side**, not UI-only. Every `/api/*` route is guarded by `requireUser` (mounted router-wide in each route file), which resolves the caller from an **unsigned** `Authorization: Bearer <userId>` header against the known user roster; a missing/unknown id gets **401**. Sensitive routes add `requireTab(<tab>)` or `requireAction(<action>)` and return **403** when the caller's role/department fails the rule. Both middleware consult the same pure rules as the client (`src/utils/rbac.ts`), so UI visibility and server enforcement cannot drift. The residual gap is **identity, not authorization**: because the Bearer id is unsigned it can be spoofed by a direct API caller — closing that requires a real IdP (JWT/OIDC/SAML), see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §5. Per-route guards: AI generation + `/api/search` = `requireUser` only; `test-ai-connection` / `debug-db` = `requireTab('settings')`; document & source writes = `requireAction('upload_kb')`; brand writes = `requireAction('manage_rates')`; governance config/gaps/tasks writes = `requireTab('governance')` (reads on `settings`); all sync routes = `requireTab('sync')`.
- **Rate Limiting**: All `/api/*` routes share a single limiter — 150 requests per 15-minute window per IP (`express-rate-limit`) — with a tighter 30/15-min budget layered on the LLM-calling routes, and a separate 120/min budget on the health probes.
- **Tenancy**: Every persisted row carries a `tenantId` column, hardcoded to `"tenant_default"` — true multi-tenant isolation is not implemented.
- **Traceability**: **Implemented.** Every request carries a correlation id: the caller's `X-Request-Id` when it matches `[A-Za-z0-9._:-]{1,80}` (the client already sends one), otherwise a server-minted `req_<uuid>`. It comes back in the `X-Request-Id` response header, appears in `metadata.requestId` of any failure envelope, and tags every server log line for that request. See §3.
- **Logging**: One structured JSON line per event via `src/server/logger.ts` (pino), plus one access-log line per `/api` request carrying method, path, status, duration and the correlation id. `LOG_LEVEL` overrides the default (`info` in production, `debug` in development, silent under test). Not scoped to `/api`-only by accident: in development Vite serves every source module through the same app, and those requests are deliberately not logged.
- **Probes**: `GET /healthz` and `GET /readyz` sit outside `/api` and are unauthenticated — see §4.

---

## 2. Endpoint Catalog — Actual Implemented Routes

Grouped by source file under `src/server/routes/`. All responses use the pattern `{ success: boolean, data?: ..., error?: ... }` except where noted.

### 2.1 AI / Search (`ai.ts`)

| Method | Route | Purpose |
| :--- | :--- | :--- |
| POST | `/api/test-ai-connection` | Sends a "Ping" prompt through `callAI` with a caller-supplied provider config to verify credentials before saving them. |
| GET | `/api/debug-db` | Debug-only: dumps the raw `kb_governance_configs` row for `ai_provider_config`. Guarded by `requireTab('settings')`. **Not intended for production.** |
| GET | `/api/embeddings/status` | Vector-index coverage: `{ total, embedded, signature, mode }`. Answers "does this deployment actually have semantic search?". Guarded by `requireTab('settings')`. |
| POST | `/api/embeddings/backfill` | Embeds chunks that have no vector for the current embedding signature. Body: `{ limit?, force?, rechunk? }` — `rechunk: true` first re-splits documents ingested before real chunking existed (required once on such a corpus, see [RAG.md](./RAG.md) §5.3). Deliberately manual: it costs provider calls over the whole corpus. Guarded by `requireTab('settings')`. |
| POST | `/api/search` | Grounded knowledge search. See §2.1.1. |
| POST | `/api/kb-chat` | Conversational assistant turn grounded in supplied `globalDocs`/`brandDocs`, writes an audit row to `kb_queries_audit`. |
| POST | `/api/copilot-generate` | Free-form AI text generation for the copilot panel (email/complaint drafting), no persistence. |
| POST | `/api/copilot-draft` | Structured draft generation (complaint reply / outbound email / CRM case note) with brand-specific tone, language, and pricing-plan grounding. Kept for backward compatibility with `/api/copilot-generate`. |
| POST | `/api/crm/cases` | Stub — always returns `{ cases: [] }`. Not backed by a table. |

#### 2.1.1 `POST /api/search` — Enterprise Knowledge Search

- **Request Body**:
  | Field | Type | Required | Notes |
  | :--- | :--- | :--- | :--- |
  | `query` | string | Yes | Non-empty after `.trim()`. |
  | `brandId` | string | No | Filters grounding documents to `scope: 'global'` or matching `brandId`. |
  | `departmentId` | string | No | Filters grounding documents to `departmentScope: 'global'` or a matching entry in `departmentIds`. |
  | `aiConfig` | object | No | `{ provider, model, apiKey, temperature, customEndpointUrl }` — overrides the server-stored provider config for this call only. |
- **Response (200)**: `{ success: true, data: { answer: {...}, retrievalLatencyMs, retrievalMode, vectorSimilarityThreshold, indexVersion, retrievalSource } }`. `answer` is an AI-generated JSON object (`id, title, summary, content, confidenceScore, sources, status, answerType, businessDomain, lastUpdated, reviewOwner`). The retrieval fields report what actually ran (they used to be hardcoded constants): `retrievalMode` is `'hybrid'` or `'lexical'`; `vectorSimilarityThreshold` the absolute cosine guard and `vectorRelativeFloor` the cut that actually decides what survives (a fraction of the query's best chunk — see [RAG.md](./RAG.md) §5.5), both `0`/`null` when semantic search did not run; `indexVersion` the embedding signature (`provider:model[:dims]`) or `'lexical-only'`. `timings` breaks `retrievalLatencyMs` — which is the whole handler despite its name — into `candidatesMs` (loading the caller-scoped candidate set), `retrievalMs` (lexical ranking + the query-embedding round-trip, plus reranking when enabled), `llmMs` (the answer call) and `totalMs`. Reported on the fallback path too, so a search that ended in a provider failure still says how long that failure took.
- **Response (400)**: `{ success: false, error: { code: 'ERR_VALIDATION', message: 'query: ...', details: [...] } }` when `query` is missing/empty/non-string. Validated by middleware *before* the handler runs — the handler's own `catch` deliberately degrades to a 200 fallback answer, so a check inside it would never surface as a 400.
- **Response (500)**: `ERR_SEARCH_FAILED` when the upstream AI call fails in a way the local fallback cannot absorb.

### 2.2 Documents (`documents.ts`)

| Method | Route | Purpose |
| :--- | :--- | :--- |
| GET | `/api/db/documents` | Lists documents, **scoped server-side to the caller's brands/departments** (a client-supplied filter can only narrow further, never widen). Query params `brandId`, `departmentId` apply the same scope-matching rules as `/api/search`. Response includes `totalCount`, `filteredCount`, `availableCategories`. Soft-deleted rows (`deletedAt`) are excluded. |
| POST | `/api/db/documents` | Creates a document (defaults: `status: 'trained'`, `scope: 'global'`, `version: '1.0'`) plus its first `kb_document_versions` and `kb_document_chunks` rows. Guarded by `requireAction('upload_kb')`. A client-supplied `approvalStatus` is honored **only** when the caller holds a governance role and the value is in the allowed enum; otherwise it is forced to `'Under Review'`, so an upload cannot self-approve straight into retrieval (S5). Returns `{ document, ingestionJobId }`. |
| PATCH | `/api/db/documents/:id` | Partial update of an existing document; authorization is checked inside the handler (the doc's owner or a governance-capable role). A change to the document's content bumps the version (writes a new `kb_document_versions` row) and returns the doc to `'Under Review'`. **404** if not found. |
| POST | `/api/db/documents/governance-decision` | Records an approve / reject / ban governance decision on a document, updating its `approvalStatus`. This is the gate that lets a document become groundable for retrieval. |
| DELETE | `/api/db/documents/:id` | **Soft-deletes** the document — sets `deletedAt`; the row is retained but excluded from every read path, aggregate, and grounding path (`isGroundableDoc`). Guarded by `requireAction('upload_kb')`. |

### 2.3 Knowledge Sources (`sources.ts`)

| Method | Route | Purpose |
| :--- | :--- | :--- |
| GET | `/api/db/sources` | Lists sources; DB `status` values (`active`/`syncing`/`warning`/`inactive`) are mapped to UI-facing values (`healthy`/`syncing`/`warning`/`error`). Extra fields (owner, criticality, confidenceScore, etc.) are stored as a serialized `config` JSON blob and spread into the response. |
| POST | `/api/db/sources` | Bulk upsert — accepts an **array** of source objects, updates existing rows by id or inserts new ones. |
| POST | `/api/db/sources/:id/status` | Updates a single source's status (body: `{ status }`), bumps `lastUpdate`. |

### 2.4 Sync (`sync.ts`)

| Method | Route | Purpose |
| :--- | :--- | :--- |
| GET | `/api/db/sync/status` | Returns sync-job history (newest-first) plus **index telemetry derived from the live corpus**: `totalIndexedKeys` = documents with non-empty content, `indexIntegrity` = % of live documents that are indexable (soft-deleted rows excluded). These replace the former hardcoded `99.8 / 142500` placeholders (S4). |
| POST | `/api/db/sync/run` | Validates `sourceId` against `kb_sources` — **400** on an unknown id (defaults to `src_sharepoint_kb`) — then records a `kb_sync_jobs` row. Ingestion is still synchronous/simulated; there is no background job runner. |
| GET | `/api/db/sync/sharepoint/status` | Reports whether SharePoint/Graph credentials are configured; honestly returns `configured: false` when unset, with no fabricated record counts. |
| POST | `/api/db/sync/sharepoint` | Triggers the real SharePoint crawl when configured; on failure it writes a `'Halted'` job row rather than failing silently (S4). `data` reports `inserted`/`updated`/`skippedUnsupportedOrEmpty`/`skippedDuplicate` (one file indexed twice — see [SHAREPOINT_SYNC.md](./SHAREPOINT_SYNC.md)) and, on a **complete** crawl only, `tombstoned`: documents gone from SharePoint are soft-deleted here. |

### 2.5 Governance (`governance.ts`)

| Method | Route | Purpose |
| :--- | :--- | :--- |
| GET | `/api/db/governance/ai-config` | Returns the stored AI provider config with the API key masked (`••••••••` + last 4 chars, or `••••••••env` if falling back to an environment variable). |
| POST | `/api/db/governance/ai-config` | Upserts the AI provider config. If the incoming `apiKey` is blank or still masked, the previously stored (decrypted) key is preserved instead of being overwritten with a masked placeholder. Plaintext keys are encrypted (AES-256-CBC) before being persisted — see [SECURITY.md](./SECURITY.md). |
| GET | `/api/db/governance/desk-settings` | Returns operational desk settings (`maxAnswerSec`, `escalationStarLimit`, `enableSlack`, `enableGdpr`), defaulted if unset. |
| POST | `/api/db/governance/desk-settings` | Upserts desk settings. |
| GET | `/api/db/governance/gaps` | Lists search-gap records (`kb_search_gaps`). |
| POST | `/api/db/governance/gaps` | Bulk upsert of search-gap records. |
| GET | `/api/db/governance/tasks` | Lists review-task records. **Not on the live UI read path** — the Governance work-queue UI reads/writes review tasks directly against `localStorage` via `useKbGovernanceData`; this endpoint exists as a validated landing spot for a future migration off localStorage (see the persistence-path note in `governanceRepository.ts`). |
| POST | `/api/db/governance/tasks` | Bulk-replaces review tasks. Requires an array of `{ id: string, status: string, ... }` (400 otherwise). Server-side enforces the same eligibility rule the bulk-approve UI applies: a task whose *previous* status was `Grounded & Updated` / `Rejected` / `Feedback Received` cannot be silently flipped to `Grounded & Updated` by a caller bypassing the client check — such entries are reverted to their prior status and counted in the response's `blockedCount`. |

### 2.6 Brands (`brands.ts`)

| Method | Route | Purpose |
| :--- | :--- | :--- |
| GET | `/api/db/brands` | Lists all brands, deserializing `teamIds`/`pricingPlans` back into arrays. |
| POST | `/api/db/brands` | Creates a brand. Requires `displayName`, `shortCode`; other fields optional. |
| PATCH | `/api/db/brands/:id` | Partial update — only fields present in the body are changed. 404 if the brand doesn't exist. |
| PATCH | `/api/db/brands/:id/status` | Toggles `isActive` (body: `{ isActive: boolean }`, required — 400 if missing). |

---

## 3. Standard Response Envelope (Actual)

Every route above follows the envelope below — **one** failure shape, produced by a single terminal error middleware (`src/server/middleware/errors.ts`) rather than by each handler. Two shapes used to coexist: the AI routes emitted `{success:false, error:{code, message}}` while every `/api/db/*` route emitted `{success:false, error:"a string"}`. Since the client only ever read the object form (`src/config/apiClient.ts` reads `error.message`/`error.code`), the actual reason for any `/api/db/*` 400 was dropped on the floor and the UI showed a generic "Server returned error code: HTTP 400". The AI-generation routes (`/api/kb-chat`, `/api/copilot-generate`, `/api/copilot-draft`, `/api/crm/cases`, `/api/test-ai-connection`) also carry `success:true` alongside their existing payload keys (`reply`/`result`/`content`/`cases`) on success.

```
// Success
{ "success": true, "data": { ... } }

// Failure
{
  "success": false,
  "error": { "code": "ERR_...", "message": "...", "details": [ { "path": "field", "code": "...", "message": "..." } ] },
  "metadata": { "timestamp": "ISO-8601", "requestId": "req_..." }
}
```

`details` is present only on `ERR_VALIDATION` (one entry per rejected field). `metadata.requestId` is the correlation id described below.

### Request Validation

Every write — and every parameterized read — is validated against a Zod schema before its handler runs (`src/server/schemas/apiSchemas.ts`, applied by `src/server/middleware/validate.ts`). Two deliberate properties:

- Where a payload is **also** validated in the UI, the API reuses the *same* schema (`AiProviderConfigSchema`, `DeskSettingsSchema` from `src/schemas/validation.ts`), so a direct API call can no longer store a state the form would have refused. `POST /api/db/governance/ai-config` in particular used to accept any JSON as the live provider config that every `/search` and `/kb-chat` call then resolves.
- Where the old handler **corrected** rather than rejected, that tolerance is preserved: `?limit=99999` is still clamped to 1000, a negative `offset` to 0, and an unsupported document `type` still falls back to `pdf`.

### Correlation Id

Every request gets an id: the caller's own `X-Request-Id` when it matches `[A-Za-z0-9._:-]{1,80}` (the client already sends one), otherwise a server-minted `req_<uuid>`. It is returned in the `X-Request-Id` **response header**, echoed in `metadata.requestId` of a failure envelope, and prefixed onto the server-side log line for that request — so a user-reported failure can be found in the log without guessing.

### Status Codes Actually In Use
- **200 OK**: All successful responses. Also used by `POST /api/db/sync/sharepoint` for the "not configured" state (`{success:false, configured:false, error:{code:'ERR_SHAREPOINT_NOT_CONFIGURED'}}`) — a state the Sync board renders, not a failed request.
- **400 Bad Request**: `ERR_VALIDATION` for any schema rejection (with `details`), `ERR_INVALID_INPUT` for a semantic rejection the schema cannot express (e.g. `/api/db/sync/run` with an unknown `sourceId`), `ERR_MALFORMED_JSON` for a body that is not parseable JSON.
- **401 Unauthorized**: `ERR_UNAUTHORIZED` — `requireUser` could not resolve the `Authorization: Bearer <userId>` header to a known user (missing or unknown id).
- **403 Forbidden**: `ERR_FORBIDDEN` — the caller is known but fails a `requireTab`/`requireAction` rule for the route (e.g. an Operator hitting a governance write).
- **404 Not Found**: `ERR_NOT_FOUND` — the target row does not exist (`/api/db/brands/:id`, `/api/db/brands/:id/status`, `/api/db/documents/:id`, `/api/db/sources/:id/status`), **or** no API route matches the path at all. The latter matters: unmatched `/api/*` paths are answered with JSON here, above the SPA fallback that used to return `index.html` with `200 text/html`.
- **413 Payload Too Large**: `ERR_PAYLOAD_TOO_LARGE` — the body exceeded the 20mb JSON limit.
- **429 Too Many Requests**: The shared rate limiter's 150-req/15-min ceiling was exceeded (30-req/15-min on the AI routes).
- **500 Internal Error**: `ERR_INTERNAL` for an unhandled exception, plus the route-specific AI codes (`ERR_AI_CONNECTION_FAILED`, `ERR_KB_CHAT_FAILED`, `ERR_COPILOT_GENERATE_FAILED`, `ERR_COPILOT_DRAFT_FAILED`, `ERR_EMBEDDING_BACKFILL_FAILED`, `ERR_SEARCH_FAILED`, `ERR_SHAREPOINT_SYNC_FAILED`). An `ERR_INTERNAL` message is **generic by design** — the underlying error (SQLite constraint text, provider response bodies, file paths) goes to the log with the request id and is no longer relayed to the caller, which is what `e.message` used to do.

Authorization drives real **401**/**403** responses (via `requireUser`/`requireTab`/`requireAction`) and the rate limiter emits **429** at its ceiling. The `correlation_id` and error-code taxonomy that earlier revisions described as aspirational are the ones documented above. What remains in [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)'s hardening roadmap is the log **destination** — the lines are structured JSON now, but they go to stdout, with no APM/OTel exporter behind them and no metrics or traces emitted.

---

## 4. Operational Endpoints

Outside `/api`, unauthenticated, and not part of the application contract — these exist for load balancers, container probes and operators. Because a probe has no identity to present, they report *whether* a dependency is usable and never how much data it holds; corpus figures stay behind `GET /api/embeddings/status`, which requires a settings-tab role.

| Method | Route | Purpose |
| :--- | :--- | :--- |
| GET | `/healthz` | **Liveness.** `{ status: 'ok', uptimeSec }`. Touches no dependency by design: a liveness probe that fails because the database is down gets the container restarted, which fixes nothing and drops the requests it was serving. |
| GET | `/readyz` | **Readiness.** `{ status, uptimeSec, checks: [{ name, ok, required, detail }] }` over `database` (required), `vectorIndex` and `sharepoint` (both optional). |

`/readyz` status values:

- **`ok`** (200) — every check passed.
- **`degraded`** (200) — required checks passed, an optional one did not. The common case is a deployment that has not run `POST /api/embeddings/backfill`: retrieval still answers, lexically, and this is where that becomes visible without reading the database.
- **`unavailable`** (503) — a required check failed. An orchestrator should pull the instance out of rotation rather than let it serve errors.

**Shutdown.** `SIGTERM`/`SIGINT` stop new connections, let in-flight requests finish (10s grace, then forced), and only then close the SQLite handle — so a rolling redeploy neither kills a request mid-flight nor leaves WAL contents in `db.sqlite-wal`. See `src/server/shutdown.ts`.
