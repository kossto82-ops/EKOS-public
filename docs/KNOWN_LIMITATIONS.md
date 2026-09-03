# Enterprise Knowledge Platform: Scope Boundaries & Known Limitations
**Approved by:** Architecture Review Board  
**Target Audience:** Head of IT, Enterprise Software Architect, Principal Engineer, Security Lead  
**Document Status:** Official Engineering Artifact  

---

## 1. Purpose

This document outlines the architectural boundaries and functional scope of the Enterprise Knowledge Platform (EKP) prototype. It differentiates clearly between the client-centric capabilities validated in this prototype, the engineering-owned systems deferred to the platform's production implementation phase, and the concrete hardening roadmap required to transition this system into a hardened, high-availability corporate environment. 

This document serves as an official alignment framework to guide cross-functional teams (Engineering, DevOps, Security, and Product) during subsequent integration sprints.

---

## 2. Current Prototype Scope

The prototype represents a high-fidelity, architecture-first frontend interface coupled with modular client-side logic and robust service-layer abstractions. The following core functional areas are fully realized and ready for integration:

*   **Enterprise Information Architecture:** Multi-brand metadata hierarchies, document categorization schemes (e.g., SLA, Regulatory, Policy, Strategy), and dynamic scope boundary selectors.
*   **Knowledge Assistant:** High-performance retrieval interface featuring streaming-ready layout models, sources referencing, dynamic suggestion cards, follow-up query handlers, feedback logging mechanisms, and compliance reporting modals.
*   **Knowledge Base Manager:** Consolidated data list viewer supporting advanced filtering (by Brand, Category, Status, Owner), sorting routines, full-text client search, file upload drag-and-drop overlays, and inline document metadata drawers.
*   **Connected Sources:** Structured configuration panel managing connectors (SharePoint, Drive, Confluence, Slack), risk profiling displays, sync-interval rules, and real-time ingest triggers.
*   **Sync & Indexing:** A live status board detailing index integrity, total indexed keys, sync logs, and a fully reactive manually triggered ingest cycle integrated with assistive accessibility live region announcers.
*   **Frontend Architecture & Service Abstraction:** Decoupled, modular React components relying on clean API client layers and typescript definitions, facilitating the drop-in replacement of mock endpoints with live HTTP/REST queries.
*   **Database Schema & Backend Readiness:** Pre-defined database entities (including documents, brands, and sync schedules) aligned with production relational storage (PostgreSQL) structures.
*   **Hybrid RAG Pipeline:** Implemented end to end — boundary-aware chunking, multi-provider embeddings, a cosine vector index, RRF fusion with the lexical ranker, and an opt-in reranking stage ([RAG.md](./RAG.md) §5). MCP remains design-only: the handshake contracts are specified in configuration, with no runtime protocol exchange.

---

## 3. Engineering-Owned Components (Out of Scope)

The following components are recognized as enterprise-managed utilities. They are intentionally excluded from the prototype scope and are owned entirely by the Core Engineering and DevOps organizations for future implementation:

*   **SharePoint / Cloud Ingestion Services:** The actual binary streaming, extraction, parsing, and OCR processing of physical enterprise documents from external repositories.
*   **MCP Server Implementation:** The live server hosting the Model Context Protocol endpoints to facilitate local tool discovery and context grounding.
*   **Production PostgreSQL Database:** The database instances, connection pools, replicas, backup schedules, and failover infrastructure.
*   **Authentication & Single Sign-On (SSO):** Integration with corporate Identity Providers (IdP) such as Okta, Azure AD, or Ping Identity using OAuth2/OIDC protocols.
*   **Role-Based Access Control (RBAC) Enforcement:** Real-time enforcement of data-access permissions, credential validations, and policy gates at the server/database layer.
*   **Production API Gateway & Reverse Proxy:** Rate-limiting, request throttling, SSL termination, and API routing infrastructure.
*   **Background Workers & Orchestrators:** Async job runners (e.g., Celery, BullMQ) for running heavy document synchronization schedules.
*   **Production Vector Database:** Live vector index instances (such as Pinecone, Milvus, or pgvector) hosting high-dimensional embeddings.
*   **Infrastructure & Deployment Pipelines:** Terraform templates, Kubernetes manifests, Helm charts, CI/CD pipelines (GitHub Actions/GitLab CI), and server container clustering.
*   **Monitoring & Logging Frameworks:** Enterprise observability agents (e.g., Datadog, Prometheus, Grafana, OpenTelemetry).

---

## 4. Known Technical Limitations

These limitations are not defects; they are planned technical integrations and represent the boundaries between the client prototype and the enterprise-owned backend:

> ⚠️ **Narrowed finding (was critical, now high — residual risk remains):** Every
> `/api/db/*` route (`src/server/routes/documents.ts`, `sources.ts`, `governance.ts`,
> `brands.ts`, `sync.ts`) and every AI route (`src/server/routes/ai.ts`) now runs behind
> `src/server/middleware/auth.ts`'s `requireUser`/`requireTab`/`requireAction` guards,
> which resolve the caller's identity from the `Authorization: Bearer <auth_token>`
> header, look up that id's role/department against `src/constants/users.ts`, and
> re-run the **same** `canAccessTab`/`canPerformGovernanceAction` rules from
> `src/utils/rbac.ts` server-side before any mutating route runs — a request can no
> longer bypass authorization simply by skipping the client and calling the API
> directly with no header (401) or with an unrecognized id (401), and a recognized but
> under-privileged caller is blocked with 403 (route coverage and role mapping are
> exercised end-to-end in `tests/rbacEnforcement.test.ts`).
>
> **This closes the "any caller, no check at all" gap, but does not add real
> authentication.** The `auth_token` is an unsigned id (currently just the active
> simulated user's `id`, set by `AuthContext`), not a cryptographically verified
> session/JWT — a caller who knows or guesses a valid user id can still impersonate
> that user and pass every check. Do not treat this as equivalent to the OIDC/IdP
> integration described under "Server-Side RBAC Enforcement" below; that item is now
> narrower in scope (swap the unsigned id for a verified token) rather than starting
> from zero, but it is still required before this build is exposed beyond a trusted
> network. **Continue to front any network-reachable deployment with a gateway/VPN**
> until real token verification lands.
>
> **Update (2026-08-13) — verified-token mode has landed, behind configuration.**
> `src/server/auth/` + `src/server/routes/auth.ts` implement an OAuth2
> authorization-code + PKCE BFF login against the corporate authorization server:
> opaque tokens validated by introspection, a server-side session with the tokens
> encrypted at rest, a signed `httpOnly` cookie, and corporate→EKOS identity
> mapping via the `user_directory` table. It is **off by default** — the app runs
> the legacy unsigned-id scheme above until `AUTH_CLIENT_ID`/`AUTH_CLIENT_SECRET`
> (backend) and `VITE_AUTH_MODE=oauth` (frontend) are set. So the residual risk is
> unchanged *for a default deployment*, but closing it is no longer a build task —
> it is: register the `ekos` client with the auth-server team and set the config
> per environment. See [AUTH_INTEGRATION_PLAN.md](./AUTH_INTEGRATION_PLAN.md).
*   **Service Abstractions:** Backend requests are handled via robust local clients simulating network latency and state changes, ready for switchover to live endpoints.
*   **Simulated Authentication:** Users and active sessions are managed within state hooks and mock user matrices; corporate authentication providers (OIDC/SAML) are not connected.
*   **Client-Side RBAC Simulation:** Permission rules and restricted tab-actions are visually guarded based on the simulated active user's role, and — as of the middleware described in the callout above — the same rules are now also enforced server-side. What's still missing is cryptographic proof of identity (the caller id itself is unsigned); see the callout above for the precise residual risk and the highest-priority remaining item on the hardening roadmap.
*   **Vector Search & Grounding:** Semantic retrieval is now **implemented server-side**, not modeled — real chunking, multi-provider embeddings, a cosine vector index over `kb_document_chunks`, RRF hybrid fusion and an opt-in LLM reranker (see [RAG.md](./RAG.md) §5). Three boundaries remain, all deliberate: (a) the index is a **brute-force scan**, not an ANN structure — adequate to roughly 100k chunks, past which `searchChunks()` must be swapped for a real ANN index or a production vector database; (b) reranking uses an **LLM judge, not a cross-encoder**, so it is costlier per query and off by default; (c) the vector index lives in the same SQLite file as the rest of the KB, with no separate replication or backup story. A deployment that has not run `POST /api/embeddings/backfill` has **no vectors at all** and serves lexical-only retrieval, which on the labelled set finds the right document for 5% of queries against 83% for hybrid ([RAG.md](./RAG.md) §5.8) — not a graceful degradation, an unusable one. **That state is no longer silent** (it was until 2026-08-06): startup logs it at `error` level, `GET /readyz` reports the `vectorIndex` check, and the Assistant renders a keyword-only warning above any answer retrieved without semantic search. `GET /api/embeddings/status` remains the direct check, and now counts only chunks of live documents — it previously included soft-deleted ones, reporting 69.5% coverage on a corpus that was in fact fully embedded, so the figure could never reach 100% and was useless as a completion signal.
*   **Local Fallback Answer Quality:** When the live LLM call fails or is unconfigured, `src/api/searchApi.ts`'s `fuzzyMatch` substitutes a keyword-scored answer from a small, hand-authored `MOCK_KNOWLEDGE_BASE` so the demo keeps working offline. A manual QA pass on 2026-07-03 found this keyword scoring could pick the wrong topic when two entries shared an ambiguous keyword at different weights (fixed — see git history — and the UI now visibly labels a fallback answer as simulated rather than presenting it as AI-verified). The underlying limitation remains structural: this is a small, static keyword index, not real semantic retrieval, so novel phrasing outside its ~20 entries will fall through to a generated, non-grounded placeholder (`generateDefaultAnswer`). Treat any fallback answer as a demo aid, not a source of truth, until the production RAG/vector pipeline (see "pgvector Embedding Synchronization" below) replaces it.
*   **MCP Handshake:** MCP configurations and tools are represented in configuration files, with the actual runtime protocol exchange awaiting Core Engineering implementation.
*   **Scale Testing:** Performance and visual responsiveness have been optimized for standard enterprise documents (up to 1,000 keys). The KB Manager's document list now renders via a virtualized window (see "Chunk-Based Document Loading" below) so client render cost no longer scales with document count, and `/api/db/documents` is now paginated server-side (`limit`/`offset`, default 200 per page — see git history) so a large library no longer pays a full-table fetch on load. This is still architectural readiness, not an empirical load test — actual large-scale runs (millions of documents, real network/API latency at that volume) have not been performed.
*   **Fully Automated WCAG Audits:** Extensive visual and manual WCAG 2.2 AA remediation has been completed. `tests/accessibility.test.tsx` runs `axe-core` in CI against the shared Modal/Breadcrumb/Toast primitives, and `tests/fullScreenAccessibility.test.tsx` (added 2026-07-03, EKP-045) extends this to all seven full tab screens (`src/App.tsx`) under the app's real provider tree with mocked network calls — this pass immediately found and fixed two real, always-present violations: an invalid `aria-controls` reference in `KnowledgeBaseTab`'s sub-tab switcher, and an unlabeled show/hide button in `AiProviderSettings` (see git history). A follow-up manual pass on 2026-07-06, run in a real Chrome instance rather than jsdom (see the "Continuous Accessibility Testing" item below for why that distinction matters), found and fixed two more: a dangling `aria-controls` on `KnowledgeBaseTab`'s active sub-tab during its own loading state, and missing keyboard access on several scrollable tables (git history). Live-integration/high-concurrency verification and manual assistive-technology testing are still pending (see "Assistive Technology User Testing" below).
*   **Infrastructure Observability:** The **server side now emits structured logs**, not prose: `src/server/logger.ts` (pino) is the single sink, every line is one JSON object with a level, and every request-scoped line carries the `requestId` the client sent — so the lines a single failing request produced can be correlated, and `/api` requests additionally get one access-log entry with status and duration. `GET /healthz` (liveness) and `GET /readyz` (readiness: database, vector index, SharePoint credentials) make process and dependency state checkable by a probe instead of inferred from whether the SPA renders. **The destination now exists.** `src/server/otel.ts` starts an OpenTelemetry SDK — traces, metrics and logs over OTLP — and `deploy/` ships a collector, a container image and a Compose deployment to run them on. Spans cover HTTP, Express, outbound provider calls, `ai.generate` and `retrieval.hybrid`; metrics cover embedding coverage, empty-retrieval rate, retrieval mode, AI latency/errors/tokens, pending migrations and event-loop lag; pino lines are exported alongside stdout with the trace and span id of the request that produced them. `deploy/alerts.yaml` turns the two silent-degradation modes into alertable conditions. See `docs/OPERATIONS.md`. **Three gaps remain, and they are real:** telemetry is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; the collector retains *metrics* by default but drops traces and logs until a backend is configured; and `deploy/alertmanager.yml` routes to a null receiver, so rules fire and reach no human until a destination is filled in. There is also no uptime check from outside the host — every alert is evaluated from telemetry the app itself pushes, so a dead VM makes the alerts go quiet rather than fire. Client-side capture remains the separate seam described under "Telemetry & Observability" below.
*   **Infrastructure & Transport Security Headers:** Production-grade HTTP security headers (e.g., HSTS, Content Security Policy, COOP, XFO, and Trusted Types) are excluded from the client application code and must be injected dynamically at the egress API Gateway, Nginx reverse proxy, or Cloud Run platform routing layer.

---

## 5. Production Hardening Roadmap

This roadmap identifies key tasks required to prepare the platform for enterprise deployment:

### Security
*   **OAuth2 / OIDC Integration:** ~~Connect the React frontend to the corporate IdP via an authorization-code flow with PKCE.~~ **Built (behind config), 2026-08-13.** Authorization-code + PKCE BFF against the corporate authorization server, backend and frontend, validated by token introspection (the server issues opaque tokens, not RS256 JWTs — see [AUTH_INTEGRATION_PLAN.md](./AUTH_INTEGRATION_PLAN.md) §2). It runs a dual-mode `requireUser`: legacy unsigned-id by default, real corporate session when configured. **Remaining is not code:** register the `ekos` client (id+secret) with the auth-server team and set `AUTH_*`/`SESSION_*`/`VITE_AUTH_MODE=oauth` per environment (Test first).
    *   *Rationale:* Eliminates simulated session states and ensures secure user tokens.
    *   *Owner:* Security Engineering
    *   *Timeline:* Sprint 1 of Integration Phase — built; awaiting client registration + per-env config
*   **Server-Side RBAC Enforcement:** ~~Map active user roles and brand-scope scopes directly to database query filters on the backend.~~ **Landed** for role/department/action checks via `src/server/middleware/auth.ts` — remaining work is narrower: replace the unsigned `auth_token` id with a cryptographically verified session/JWT issued by the corporate IdP (see OAuth2/OIDC item above), so identity itself can't be spoofed, not just misused.
    *   *Rationale:* Prevents unauthorized API access and ensures data isolation.
    *   *Owner:* Core Backend Engineering
    *   *Timeline:* Sprint 2 of Integration Phase

### Accessibility
*   **Continuous Accessibility Testing (CI/CD):** ~~Integrate `@axe-core/react` or Cypress-Axe into the deployment pipeline.~~ **Landed, now covering both shared primitives and full tab screens.** `tests/accessibility.test.tsx` runs `axe-core` against the shared `Modal`, `Breadcrumb`, and `ToastContainer` primitives; `tests/fullScreenAccessibility.test.tsx` (EKP-045, 2026-07-03) extends this to all seven tab screens rendered under the app's full provider tree with mocked network calls. **`tests/dialogAccessibility.test.tsx` (2026-08-06) closed the largest remaining hole in that coverage**: between them the two suites scanned `Modal` as an isolated primitive and the tab screens in their settled *default* state, so every dialog in the app was audited only while closed. That is how `PolicyManager` shipped a hand-rolled `<div role="dialog">` with no focus trap and no Escape handling while CI stayed green — review caught it, no test could have. The new suite has two layers: a static guard over `src/` asserting that anything declaring `role="dialog"`/`aria-modal` calls `useFocusTrap` and attaches the ref it returns, and an interaction layer that opens all fourteen dialog surfaces and drives real Tab/Shift+Tab keypresses to prove focus wraps rather than escapes, plus the Escape path for the ten that should close (and a negative assertion that `IdleLockScreen` does *not*). Two conventions came out of it and are worth knowing before touching either suite: jsdom reports `offsetParent` as null for everything, so `useFocusTrap`'s visibility filter discards every candidate and an untrapped dialog is indistinguishable from a trapped one unless the suite shims it; and animation is not a reliable proxy for "still loading" — the review queue's Critical-priority dot pulses permanently by design, so elements marked `data-persistent-motion` are excluded from the settle condition (that marker is a test fix, not an accessibility one; the dot separately honours `prefers-reduced-motion`). `.github/workflows/ci.yml` runs `npm run lint`, `npm test`, and `npm run build` on every push/PR. This has already caught and fixed real bugs: `Modal`'s form variant had `role="dialog"` on a `<form>` element (invalid `aria-allowed-role`); `KnowledgeBaseTab`'s sub-tab buttons carried `aria-controls` pointing at unmounted panel ids, both for inactive tabs (2026-07-03) and, missed at the time, for the active tab during its own loading skeleton (fixed 2026-07-06, see git history); `AiProviderSettings`'s show/hide API key button had no accessible name; and several scrollable tables (`SyncIndexingTab`, `SettingsTab` ×2, `DocumentMetricsView`, plus the shared `TableContainer` primitive) had no keyboard access (`scrollable-region-focusable`). **Two gaps remain, both because jsdom has no real layout/paint engine, so axe's `color-contrast` and `scrollable-region-focusable` rules were disabled in this suite (they degrade to false positives/negatives without real layout):** a manual pass on 2026-07-06 ran the *full* `axe-core` ruleset (including `color-contrast`) against the actual Chrome-rendered app — all six tab screens, light and dark mode, and the user/brand/department dropdowns — and found zero contrast violations, plus the `scrollable-region-focusable` findings fixed above. This closes the gap for now but isn't a standing CI gate; automating it would need a real-browser test runner (e.g. Playwright), which isn't a dependency in this project today. Manual assistive-technology (screen reader) testing is still pending — see below.
    *   *Rationale:* Prevents code changes from breaking WCAG compliance.
    *   *Owner:* Frontend Lead / QA Automation
    *   *Timeline:* Sprint 2 of Integration Phase
*   **Assistive Technology User Testing:** Conduct formal user audits with native screen reader users (JAWS, NVDA).
    *   *Rationale:* Validates keyboard flow and voice readout quality.
    *   *Owner:* UX Research / Accessibility Champion
    *   *Timeline:* Pre-Release Quality Gate

### Performance
*   **Chunk-Based Document Loading:** ~~Transition lists and document libraries to virtualized window rendering (e.g., `react-window`) and paginated API endpoints.~~ **Both halves landed.** Client-side virtualization: the KB Manager's document list (`src/components/tabs/kb/DocList.tsx`) renders via `react-window`'s `List` — only the rows scrolled into view are ever mounted (verified in `tests/docListVirtualization.test.tsx` that DOM row count stays far below total document count at 500 synthetic documents); its nested-interactive accessibility defect is fixed (git history). Server-side pagination (2026-07-04, git history): `/api/db/documents` accepts `limit`/`offset` (default 200/page) and reports `hasMore`/`nextOffset`; `DocList` surfaces a "Load more documents" affordance when a library exceeds one page. **Known residual scope:** client-side search/filter/sort only operates on documents already loaded — loading further pages is an explicit user action, not automatic.
    *   *Rationale:* Sustains fast render speeds with thousands of documents.
    *   *Owner:* Frontend Engineering
    *   *Timeline:* Completed 2026-07-04
*   **Asset Delivery Optimization:** Configure CDN caching, compression (Brotli), and edge-routing.
    *   *Rationale:* Maximizes performance for global corporate users.
    *   *Owner:* DevOps Engineering
    *   *Timeline:* Deployment Stage

### Infrastructure
*   **PostgreSQL Migration:** Move SQLite/local configurations to a managed PostgreSQL cluster (Cloud SQL).
    *   *Rationale:* Guarantees data durability, concurrency, and backups.
    *   *Owner:* Database Administration (DBA)
    *   *Timeline:* Sprint 1 of Integration Phase
*   **Containerization & Orchestration:** Package the Express server and build artifacts into OCI containers deployed to Google Cloud Run or GKE. **The application-side prerequisites are now in place:** `GET /healthz` is a dependency-free liveness probe and `GET /readyz` a readiness probe that returns 503 while a required dependency (the database) is unusable, so an orchestrator can gate traffic instead of guessing; and SIGTERM/SIGINT now drain in-flight connections before closing the database (`src/server/shutdown.ts`), which is what makes a rolling redeploy non-destructive. Remaining work is the container/manifest/autoscaling configuration itself, which is DevOps-owned.
    *   *Rationale:* Enables autoscaling and resilient hosting.
    *   *Owner:* DevOps Engineering
    *   *Timeline:* Sprint 2 of Integration Phase
*   **Local SQLite Durability:** While the platform still runs on SQLite (see PostgreSQL Migration above), the connection is now configured for it: WAL journaling so a reader is never blocked by a concurrent sync write, a 5s `busy_timeout` so lock contention becomes latency rather than a `SQLITE_BUSY` 500, and a clean `close()` on shutdown so WAL contents are checkpointed back into `db.sqlite` instead of being left in a sidecar file that a naive backup copy would miss. `synchronous` is deliberately left at FULL rather than the NORMAL usually paired with WAL — this file holds governance decisions. None of this substitutes for the managed-cluster item above: there is still one file, one node, and no replica.
    *   *Rationale:* Removes the avoidable failure modes of the interim storage engine.
    *   *Owner:* Core Backend Engineering
    *   *Timeline:* Completed 2026-08-05

### AI Integration
*   **LLM Gateway Connection:** Connect the Knowledge Assistant to a central AI gateway utilizing the `@google/genai` SDK on the backend.
    *   *Rationale:* Secures enterprise API keys and manages LLM quota rules.
    *   *Owner:* AI Platform Engineering
    *   *Timeline:* Sprint 1 of Integration Phase
*   **pgvector Embedding Synchronization:** Connect document ingestion routines to a pgvector vector database for semantic search.
    *   *Rationale:* Enables production RAG and semantic lookup capabilities.
    *   *Owner:* ML/Data Engineering
    *   *Timeline:* Sprint 2 of Integration Phase

### Operations
*   **Telemetry & Observability:** ~~Integrate OpenTelemetry libraries into the Express backend and React error boundaries.~~ **Partial: client-side seam landed, real backend still pending.** `src/utils/telemetry.ts`'s `reportError()` is now the single call site for client-side error capture — wired into `ErrorBoundary.componentDidCatch` and the global `window.addEventListener('error'|'unhandledrejection', ...)` handlers in `src/main.tsx` (previously those handlers only suppressed benign Vite HMR noise; genuine errors vanished into the console with no structured record). Today `reportError()` only emits a structured `console.error` line. The *server* side now has a collector to send to (see "Infrastructure Observability" above), but nothing yet forwards browser errors into it, so client errors are still uncorrelated with the server trace of the request that produced them. What this closes: every error-capture site now goes through one function instead of ad-hoc `console.error` calls, so wiring a real backend later is a one-line change in `telemetry.ts`, not a hunt across the codebase. **The Express side is no longer a seam but a working pipeline** — `src/server/otel.ts` and `src/server/metrics.ts` — emitting traces, latency histograms and domain metrics over OTLP, with a collector and alert rules in `deploy/`; see "Infrastructure Observability" above and `docs/OPERATIONS.md`. The client seam still has nothing behind it.
    *   *Rationale:* Monitors user errors, API response latencies, and service health.
    *   *Owner:* DevOps / SRE
    *   *Timeline:* Deployment Stage

---

## 6. Risk Assessment

| Area | Risk | Mitigation | Owner |
| :--- | :--- | :--- | :--- |
| **Authentication** | Simulated user states could leak access in testing | Guard test accounts with access-control passwords and deploy OIDC early. | Identity Team / DevOps |
| **Data Ingestion** | Rapid document ingestion may cause indexing bottlenecks | Implement asynchronous BullMQ worker queues to process jobs sequentially. | Core Backend Team |
| **Access Rights** | ~~Incorrect client-side roles could present unauthorized options~~ Backend endpoints now validate role/department permissions on every API request (`src/server/middleware/auth.ts`); residual risk is that in the **default legacy mode** the caller id is unsigned, so a party who knows a valid id can still impersonate it. | ~~Replace the unsigned id with a verified IdP session token.~~ Built (behind config) — the oauth mode does exactly this; activate it per §5. | Backend Lead |
| **Vector Accuracy** | Hallucinations in Assistant response generation | Ground Gemini requests with source metadata and enforce strict system prompts. | AI Specialist |

---

## 7. Assumptions

The development and delivery of this prototype are based on the following assumptions:

1.  **MCP Infrastructure:** Core Engineering will build and maintain the Model Context Protocol servers to ground system tools.
2.  **Relational Database:** A managed PostgreSQL (or Cloud SQL) instance will be provisioned to host the production tables.
3.  **Data Extraction Service:** Core Engineering will provide REST-based endpoints for document text-extraction and metadata chunking.
4.  **SSO Availability:** Corporate Single Sign-On environments (SAML/OIDC) are prepared and support standard web redirects.
5.  **REST Integrity:** The frontend architecture will consume stable, structured JSON response payloads matching the TypeScript interfaces.

---

## 8. Out of Scope

The Enterprise Knowledge Platform project does **NOT** attempt to address:

*   **Public Search Ingestion:** The indexer is designed purely for internally managed documents and does not crawl the public internet.
*   **General-Purpose AI Chat:** The chat system is strictly scoped to enterprise document search and does not support code generation, translation playgrounds, or general-purpose tasks.
*   **Document Authoring:** The system acts as a read-only retrieval engine and knowledge base; editing or authoring text documents is managed via external systems (e.g., Google Docs, Microsoft Word).

---

## 9. Executive Summary

The Enterprise Knowledge Platform is intentionally delivered as an architecture-first enterprise frontend, designed to integrate with Engineering-owned backend services. Remaining items represent standard production hardening activities, infrastructure integrations, and security enforcement steps rather than blockers for demonstrating the product vision or validating the proposed enterprise architecture.

This prototype validates the user experience, information architecture, metadata governance, and accessibility standards, providing a solid foundation for the subsequent integration and deployment phases.
