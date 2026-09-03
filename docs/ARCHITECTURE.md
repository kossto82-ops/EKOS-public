# System Architecture & Infrastructure Blueprint

**Purpose:** This document specifies the logical system architecture, microservices layout, network communication protocols, and deployment topology for the Enterprise Knowledge Platform. It directs infrastructural deployment models.
**Owner:** Principal Enterprise Software Architect
**Last Updated:** 2026-06-28
**Status:** Approved Template

---

## 1. Logical Architecture & Boundaries

The platform operates as a multi-tier service model, isolating client-side user experience concerns from core compute, vector search, and physical database schemas.

```
       +-------------------------------------------------+
       |              Client Presentation                |
       |  (Static Web Assets, React App, State Hooks)    |
       +-------------------------------------------------+
                               |
                               |  HTTPS / JSON API
                               v
       +-------------------------------------------------+
       |             API Gateway / Middleware            |
       |      (Routing, Rate Limiting, RBAC Enforcement) |
       +-------------------------------------------------+
                               |
            +------------------+------------------+
            |                                     |
            v                                     v
+-----------------------+             +-----------------------+
|  Ingestion / Sync API |             |   Knowledge / Search  |
|  (Directory Crawling) |             |  (Vector/Hybrid RAG)  |
+-----------------------+             +-----------------------+
            |                                     |
            v                                     v
+-----------------------+             +-----------------------+
| Relational Storage DB |             | Vector / Embeddings   |
|   (PostgreSQL / SQL)  |             |      (AI Store)       |
+-----------------------+             +-----------------------+
```

---

## 2. Infrastructure & Topology Specs

1. **Static Presentation Delivery**: Web-app bundles are distributed via localized Content Delivery Networks (CDNs) with SSL/TLS termination at edge firewalls.
2. **Compute Service Engines**: Backend middleware services reside within autoscaling container orchestration environments (e.g., Kubernetes clusters or container platforms).
3. **Storage Tier Architecture**: Relational database systems execute inside High Availability (HA) configurations, backed by continuous backups and multi-zone physical replicas.
4. **Isolated Vector Storage**: High-dimensionality vector indexes are stored on low-latency, specialized compute nodes separate from the operational transactional database.

---

## 3. Communication Protocols

- **External Interface**: Client-to-server interactions use HTTP/2 JSON REST endpoints.
- **Internal Messaging**: Background workers, ingestion queues, and search orchestrators communicate via low-latency Remote Procedure Calls (gRPC) or reliable AMQP message queues.
- **LLM/Orchestration**: System servers utilize Model Context Protocol (MCP) integrations to retrieve context from local corporate file systems.
- **Persistence Hooks**: Services use Object-Relational Mappers (ORMs) or direct drivers to issue prepared statements to database endpoints safely.

---

## 4. Architectural Boundaries & Known Limitations

To review the specific boundaries of the system prototype, engineering-owned systems, and the roadmap for production integration, refer to the [Scope Boundaries & Known Limitations](./KNOWN_LIMITATIONS.md) documentation.

---

## 5. Current Prototype Architecture

Sections 1-4 above describe the target production topology. This section documents what the prototype *actually* is today: a single Express process (`server.ts`) serving both the API and, via Vite middleware in development, the React SPA — no gateway and no separate compute tiers. Retrieval is hybrid (lexical + vector), but the vector index is not a separate service: it is a brute-force cosine scan over chunk vectors held in the same SQLite database, described in [RAG.md](./RAG.md) §5.4.

### 5.1 The three scoping dimensions

Every document, source, and user in the platform is scoped along up to three axes:

| Dimension | Kind | Status |
| :--- | :--- | :--- |
| **Brand** (commercial) | e.g. northwind_de (DE), Northwind Bureau (FR), Secretaría.es (ES) — 14 brands total (13 customer-facing + `internal_it`, the internal IT-department brand), defined in `src/constants/brands.ts`; the DB table `kb_brands` is the source of truth | Implemented |
| **Department** (internal) | `customer_service`, `call_center`, `human_resources`, `training`, `it`, `sales`, `marketing`, `finance`, `legal`, `administration` — 10 departments, defined in `src/constants/departments.ts` | Implemented |
| **Office / Location** | A planned third dimension for physical-location scoping | Designed, not implemented — pending confirmed location list from IT/HR |

Scoping is resolved client-side per document (`filteredDocuments` in `src/hooks/useKbDocuments.ts`) and per source (`filteredSources` in `src/components/sources/KnowledgeSourcesView.tsx`), both applying the same two-part rule: a `global`-scoped item is visible to everyone; a `specific`-scoped item requires the active brand/department to be in its `brandId`/`departmentIds`. This logic is unit-tested in `tests/dept.test.ts`.

### 5.2 Role hierarchy & tab visibility

Five roles, ascending in permission: **Agent → Operator → TeamLeader → LocationManager → Administrator**.

Tab access is enforced on **both** the client (`canAccess()` in `src/context/AuthContext.tsx`) and the server (the `requireTab`/`requireAction` middleware in `src/server/middleware/auth.ts`, applied per route). Both sides consult the same pure rules in `src/utils/rbac.ts` (`canAccessTab`/`canPerformGovernanceAction`) so they cannot silently drift. Authorization has always been enforced; the *identity* feeding it is now mode-dependent (`src/server/auth/config.ts`): in **oauth** mode the caller is a real corporate session (authorization-code + PKCE BFF, validated by introspection — see [AUTH_INTEGRATION_PLAN.md](./AUTH_INTEGRATION_PLAN.md)), while in the default **legacy** mode the caller id is still an unsigned Bearer header the server trusts as claimed. Activating oauth needs the `ekos` client registered with the auth server plus the `AUTH_*`/`VITE_AUTH_MODE` config; until then the legacy residual gap stands — see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md):

| Tab | Agent | Operator | TeamLeader | LocationManager | Administrator |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Assistant (copilot) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Knowledge Base (kb) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Review Queue (review) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Sources | ✅ | ✅ | ✅ | ✅ | ✅ |
| Settings | ❌* | ❌* | ✅ | ✅ | ✅ |
| Governance | ❌ | ❌ | ❌ | ✅ (read-only) | ✅ |
| Sync (System Health) | ❌* | ❌* | ❌* | ❌* | ✅ |

`review` is a top-level destination as of 2026-08-07. It was previously a
sub-tab inside `kb`, gated by `canAccess('governance')`; the split reproduces
that predicate exactly rather than inventing a new one, and `rbac.ts` carries a
comment tying the two cases together so they cannot drift apart. `kb` is
therefore open to every role while the review workflow it used to contain is
not — which is why the sub-tab needed an in-component redirect and the tab does
not. See [INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md) §1.

\* IT-department members (`departmentIds` includes `'it'` or `'*'`) get Settings and Sync access regardless of role — `canAccess()` checks `isIT` in addition to role for both tabs.

LocationManager's "read-only" governance access is enforced per-component (`isReadOnly` prop threaded into `AiProviderSettings`, `BrandManager`, and `PolicyManager` under `SystemGovernanceTab`), not by a single top-level gate — a component added to that tab must explicitly wire the prop or it defaults to full write access.

This matrix is verified by `tests/auth.test.ts`; if `canAccess()`/`canPerformAction()` changes, update both.

### 5.3 Search data flow

```
AssistantTab (React)
  -> searchService.search()   [src/services/searchService.ts]
  -> searchApi.search()       [src/api/searchApi.ts]
  -> POST /api/search         [src/server/routes/ai.ts]
  -> db.select() over kb_documents, filtered by brandId/departmentId
  -> callAI() [src/server/aiClient.ts] with the matched documents as grounding context
  <- structured JSON answer, rendered by SearchResultPanel
```

There is no vector database in this path — "grounding" means the full text of scope-matching documents is concatenated into the LLM system prompt. See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §4 "Vector Search & Grounding."

### 5.4 Frontend structure notes

- **Lazy loading**: Tab-level components (`KnowledgeBaseTab`, `AssistantTab`, `KnowledgeSourcesView`, `SettingsTab`, `SyncIndexingTab`, `SystemGovernanceTab`) are all `React.lazy()`-loaded in `App.tsx`, each landing in its own Vite chunk (see `vite.config.ts` manual chunking).
- **Context providers**: `BrandContext` (active brand), `DepartmentContext` (active department + `userDepartments`), `AuthContext` (the active user — a simulated/impersonated identity in legacy mode, or the real corporate session hydrated from `GET /auth/me` in oauth mode — plus `canAccess`/`canPerformAction` and `logout`), `BreadcrumbContext`, `LocaleContext` (active language, lazy-loaded i18n dictionaries), and the narrower `GovernancePanelContext` (queue selection/highlight state shared across `GovernancePanel` and its child modals, replacing what used to be ~12 drilled props).
- **Persistence split-brain**: Some domains (documents, brands, sources, sync, and the governance *config* endpoints) are fully server-backed via the REST API above. The Governance work-queue (review tasks, search gaps) still reads/writes `localStorage` directly through `useKbGovernanceData` — the equivalent `/api/db/governance/tasks` and `/gaps` endpoints exist and are validated, but are not yet wired to the UI. See the persistence-path note in `src/repositories/governanceRepository.ts`.

