# Backend Services & Middleware Blueprint

**Purpose:** This document details the server-side architecture, processing pipelines, ingestion workers, and middleware configurations for the Enterprise Knowledge Platform. It coordinates server implementation and development patterns.
**Owner:** Lead Backend Architect
**Last Updated:** 2026-06-26
**Status:** Approved Template

> **Target vs. actual.** §1–§3 describe the aspirational multi-service backend
> (watcher daemons, an embedding generator, a vector processing queue). The
> prototype is a **single Express process** with **synchronous** ingestion and **no**
> background workers or vector pipeline — documented in **§4**, which is the source of
> truth where it disagrees with the blueprint above.

---

## 1. Backend Process Segmentation

The platform server-side architecture comprises three primary functional engines:

```
+-------------------------------------------------------------+
|                      Backend Services                       |
+-------------------------------------------------------------+
   |
   +--> [Service A]: API proxy and authentication middleware
   |
   +--> [Service B]: Ingestion orchestrator (Directory watcher)
   |
   +--> [Service C]: Search & Vector processing queue
```

---

## 2. Ingestion & Document Processing Pipeline

The server-side document processor follows a structured background worker design:

1. **Connector Synchronization**: Watcher daemons scan connected repositories (SharePoint, Shared Drive, local volumes) on structured schedules (e.g., cron-driven intervals).
2. **Metadata Extraction**: Extenders resolve file names, ownership details, security levels, and last-modified dates.
3. **Partitioning Worker**: Large text assets are chunked into uniform blocks using character or semantic boundary markers.
4. **Embedding Generator**: Backend calls to vector conversion modules translate segments into normalized vector streams.
5. **Storage Dispatcher**: Transactional entities are stored in SQL rows while vectors are simultaneously propagated to vector indexing systems.

---

## 3. Server Middleware Policies

All routes served by the platform must wrap request handlers with the following middleware sequence:

- **Security Gate (Auth)**: Verifies user tokens and parses identities from incoming HTTP headers.
- **RBAC Interceptor**: Compares the user's role tags against target resource authorization boundaries.
- **Rate Limiter**: Tracks client IPs and token thresholds to prevent request floods.
- **Logger**: Generates secure JSON audit events containing trace IDs, actions, and targeting metadata.
- **Error Boundary**: Catches unhandled runtime exceptions, masking technical system messages while returning clean HTTP payloads.

---

## 4. Actual Prototype Backend

A single Express process (`server.ts`) is both the REST API and — via Vite middleware in development — the SPA host. There is no gateway, no separate compute tier, no worker fleet, and no message queue.

**Middleware, in order (`server.ts`):**
- **Correlation id** (`requestId`, `src/server/middleware/errors.ts`) — first in the chain, so every log line and failure envelope below it can carry the caller's `X-Request-Id`.
- `helmet` (security headers) and `cors`.
- `express.json({ limit: '20mb' })` — 20 MB body cap, matching the client's upload limit. (Registered **once**; a second, limit-less registration used to shadow it and pin the real cap at body-parser's 100kb default.)
- `express-rate-limit` — a shared 150 req / 15-min per-IP limiter, plus a 30 req / 15-min budget on the LLM routes and 120 req / min on the health probes (**429** on exceed).
- **Access log** (`src/server/logger.ts`) — one structured line per `/api` request with method, path, status, duration, `requestId` and resolved `userId`. Scoped to `/api` because Vite serves every source module through this same app in development.
- **Auth/RBAC** — each route file mounts `requireUser` router-wide, and sensitive routes add `requireTab`/`requireAction` (→ **403**). `requireUser` runs in one of two modes (`src/server/auth/config.ts`, selected by whether corporate OAuth client credentials are configured):
  - **legacy** (default) — the `Authorization: Bearer <userId>` header is an **unsigned user id** resolved against `src/constants/users.ts` (→ **401** if absent/unrecognized). Interim scheme for local/demo.
  - **oauth** — the credential is a signed `httpOnly` session cookie (from the BFF login), or an opaque corporate Bearer token validated by **introspection** (`src/server/auth/introspect.ts`); the corporate identity is mapped to an EKOS user via the `user_directory` table (`src/server/auth/identityMap.ts`), and an authenticated-but-unprovisioned user fails closed (**403**).

  Both modes feed the **same** `requireTab`/`requireAction` RBAC checks, shared with the client via `src/utils/rbac.ts`. See [SECURITY.md](./SECURITY.md) §1–2, [AUTH_INTEGRATION_PLAN.md](./AUTH_INTEGRATION_PLAN.md) and [API_SPECIFICATION.md](./API_SPECIFICATION.md) §1.
- **Schema validation** (`src/server/middleware/validate.ts`) — per-route Zod schemas from `src/server/schemas/apiSchemas.ts`, reusing the client's own schemas where the UI validates the same payload. A rejection is a **400 `ERR_VALIDATION`** with per-field details.
- **Error boundary** (`errorHandler`, registered last) — every failure, from any middleware, renders as one envelope: `{success:false, error:{code, message, details?}, metadata:{timestamp, requestId}}`. A 500's message is **generic**; the underlying error goes to the log with the request id. This is §3's target, now actually implemented — route handlers used to return `e.message` directly, relaying SQLite constraint text and provider bodies to the caller.

**Operational endpoints** sit outside `/api` and outside auth: `GET /healthz` (liveness, touches no dependency) and `GET /readyz` (readiness over database / vector index / SharePoint credentials, **503** when a required one fails). The **BFF login routes** (`GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`) also sit outside `/api` and are intentionally unauthenticated — they run the OAuth handshake that establishes identity in the first place; `GET /auth/me` is `requireUser`-guarded (see [AUTH_INTEGRATION_PLAN.md](./AUTH_INTEGRATION_PLAN.md)). `SIGTERM`/`SIGINT` drain in-flight requests before closing the SQLite handle (`src/server/shutdown.ts`). The connection runs WAL journaling with a 5s `busy_timeout`; `synchronous` stays at FULL. See [API_SPECIFICATION.md](./API_SPECIFICATION.md) §4.

**Server logging** is structured JSON on stdout via pino, one object per event, `LOG_LEVEL`-controlled and silent under test. There is no collector behind it — see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)'s "Infrastructure Observability". Client-side error capture remains its own seam (`src/utils/telemetry.ts`).

**Ingestion & document processing — synchronous, in-request (`POST /api/db/documents`):**
1. **Real text extraction** — PDF/DOCX/XLSX/CSV/TXT/MD are parsed on upload with `pdfjs-dist` / `mammoth` / `xlsx` (code-split, loaded on demand per file type — ADR-018). No watcher daemon; the client sends the file.
2. **Chunking** — extracted text is segmented into `kb_document_chunks` rows, written with `future_embedding_status = 'pending'`. Vectors are produced separately by `POST /api/embeddings/backfill`, not in this request — see [RAG.md](./RAG.md) §5. (This line previously said the embedding columns were unused placeholders; that stopped being true when the hybrid pipeline landed.)
3. **Versioning** — the first `kb_document_versions` row is written on create; a later content edit via `PATCH /api/db/documents/:id` bumps the version, writes a new version row, and returns the doc to `Under Review`.
4. **Governance gate** — a non-governance uploader's `approvalStatus` is forced to `Under Review` so an upload can't self-approve into retrieval (S5).

**Sync** is simulated: `POST /api/db/sync/run` validates the source and writes a `kb_sync_jobs` row, but ingestion is not run on a schedule; the real SharePoint crawl (`/api/db/sync/sharepoint`) runs in-request when Graph credentials are configured. See [SHAREPOINT_SYNC.md](./SHAREPOINT_SYNC.md).

**AI provider calls** (`src/server/aiClient.ts`) are made in-request with a 30 s timeout and the SSRF/key-exfil guard described in [SECURITY.md](./SECURITY.md) §3.
