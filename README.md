# EKOS — Enterprise Knowledge Operating System

A full-stack, AI-powered enterprise knowledge base, built as a **personal portfolio
project**. EKOS models the workspace a large multi-brand support organization would
use to find, govern, and answer questions from its internal knowledge — the kind of
tool that sits behind a customer-service or call-center team.

> **Walkthrough:** run the app locally (see below) to explore the role-gated tabs —
> Assistant, Knowledge Base, Review Queue, Sources, Sync, Governance and System Health.
> A recorded walkthrough can be regenerated from the running app (see
> `docs/screenshots/README.md`).

It is a working prototype, not a product. The goal is to demonstrate end-to-end
product thinking, front-end and back-end engineering, and the discipline of being
honest about where a prototype ends and production begins.

> **What's real vs. simulated** — the credibility line, stated up front:
> - **Real:** the React SPA, the Express API, the SQLite database and schema, document
>   upload with real PDF/DOCX/XLSX text extraction, role- and brand-scoped access
>   checks on both client and server, per-brand AI provider configuration with
>   encrypted key storage, and the full test/CI pipeline.
> - **Real, and measured:** retrieval is a genuine hybrid RAG pipeline — boundary-aware
>   chunking, multi-provider embeddings, a cosine vector index over chunk vectors, and
>   RRF fusion with the lexical ranker. Scored against 63 labelled queries
>   ([`eval/baseline.json`](eval/baseline.json), regenerate with `npm run eval:refresh`),
>   the shipped configuration reaches **hit@1 73.0% · hit@5 88.9% · MRR 0.790**, against
>   **hit@1 27.0% · hit@5 52.4%** for the lexical ranker alone.
> - **Bounded on purpose:** the vector index is a brute-force scan inside the same SQLite
>   file, not an ANN structure or a vector database (adequate to roughly 100k chunks); the
>   optional reranker is an LLM judge, not a cross-encoder, and is off by default; and a
>   deployment that has never run `POST /api/embeddings/backfill` has **no vectors at all**
>   and silently serves lexical-only retrieval — check `GET /api/embeddings/status` before
>   claiming semantic search is live.
> - **Simulated:** identity is a user switcher over a fixed roster, not a real IdP — the
>   `Authorization` header carries an unsigned user id, so server-side RBAC is enforced
>   against an identity nobody has proven. MCP is configuration only, with no runtime
>   protocol exchange. When no AI provider is configured, the assistant falls back to a
>   small hand-authored keyword index, labelled as simulated in the UI.
> - The complete boundary is documented in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

---

## At a glance

| | |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Motion, Vite 6 |
| **Backend** | Express 4, Node.js, `tsx`/`esbuild`, `better-sqlite3` + Drizzle ORM |
| **AI** | Server-side multi-provider client (Gemini, Anthropic, OpenAI, Groq) with encrypted keys |
| **Scope model** | 14 brands · 10 departments · 5 roles · 8 UI languages · light/dark |
| **Quality** | `vitest` suite (unit + supertest API + `axe-core` accessibility gate) · docs-drift guard · lint/test/build CI |

---

## The workspace

EKOS is a single-screen workspace with seven role-gated tabs:

1. **Assistant** — natural-language search over the knowledge base, grounded in
   scope-matched documents, with quick-action prompts and source citations.
2. **Knowledge Base** — document repository and metrics: filter by
   scope/category/status, sort, and drag-and-drop upload with real text extraction.
   The list is virtualized so render cost stays flat at thousands of documents.
3. **Review Queue** — the content review and approval workflow, with a
   keyboard-driven grid, bulk actions, and the search-gap sandbox. Visible to
   Administrators and Location Managers only.
4. **Sources** — connected-source dashboard (SharePoint / Drive / Confluence / Slack
   as configured connectors) with live KPI calculation.
5. **Sync** — indexing/sync status board with a manually triggerable ingest cycle.
6. **Governance** — brand, AI-provider, and policy management (write for Admins,
   read-only for Location Managers).
7. **System Health** — operational metrics and the AI query audit trail.

Access is scoped along three axes — **brand** (commercial), **department** (internal),
and **role** — with the tab matrix enforced on both the client (`AuthContext`) and the
server (`requireUser`/`requireTab`/`requireAction` middleware). A header switcher lets
you impersonate any simulated user to demo how the workspace changes per role.

*Run `npm run dev` to explore all seven tabs live against the running app.*

---

## Architecture

A single Express process (`server.ts`) is both the API and — via Vite middleware in
development — the SPA host. There is no gateway or separate compute tier: those are the
production topology documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), not what
runs today. The vector index is not a separate service either — it is a brute-force cosine
scan over chunk vectors stored in the same SQLite file.

```
React SPA  ──HTTPS/JSON──►  Express API  ──►  RBAC middleware  ──►  SQLite (Drizzle ORM)
   │                             │
   │                             ├──►  AI client (Gemini / Anthropic / OpenAI / Groq)
   │                             └──►  Embeddings (Gemini / OpenAI / OpenAI-compatible)
   └── search: lexical ranking + vector chunk search, fused with RRF; matched
       passages are sent as grounding context. Falls back to lexical-only when
       no embedding provider is configured — see docs/RAG.md §5.
```

The search data flow, scoping rules, and role matrix are documented in
[docs/ARCHITECTURE.md §5](docs/ARCHITECTURE.md), which describes the *actual* prototype
rather than the aspirational topology.

---

## Engineering decisions worth a look

The [ADR log in docs/DECISIONS.md](docs/DECISIONS.md) records the significant technical
decisions with their rationale. A few highlights:

- **Server-side RBAC middleware (ADR-011)** re-checks the same rules the client uses on
  every `/api/db/*` and AI route — narrowing, honestly not closing, the "any caller, no
  check" gap that a real identity provider would close.
- **Encrypted provider keys (ADR-010)** — AES-256-CBC over keys at rest, keyed from
  `ENCRYPTION_SECRET`.
- **Accessibility as a CI gate (ADR-012, ADR-016, ADR-034)** — `axe-core` runs against
  shared primitives, all seven full tab screens, and fourteen dialog surfaces opened
  and driven with real Tab/Shift+Tab; its first runs found and fixed real defects,
  including a dialog that had shipped with no focus trap at all.
- **Code-split document parsers (ADR-018)** — `pdfjs-dist`, `mammoth`, and `xlsx` load
  on demand only when a matching file is uploaded, cutting the largest chunk from
  1.47 MB to 168 KB.

---

## Running it

**Prerequisite:** Node.js 22 — the version CI tests against and the container image
builds on. `better-sqlite3` is a native addon compiled against a specific V8 ABI, so
switching Node majors means `npm rebuild better-sqlite3`, not just a version change.

**Network:** `npm ci` needs to reach `cdn.sheetjs.com` as well as the npm registry.
One dependency is pinned to a URL: `npm install xlsx` returns 0.18.5 and always
will — SheetJS stopped publishing there, leaving that version permanently unpatched
against a prototype-pollution and a ReDoS advisory in code this app points at
user-uploaded spreadsheets. The fixed releases exist only on the SheetJS
distribution, so that is where this one comes from.

```bash
npm install
cp .env.example .env      # then set GEMINI_API_KEY (and ENCRYPTION_SECRET) if you want live AI
npm run dev               # http://localhost:3000
```

Without an API key the assistant falls back to a small local keyword index and clearly
labels its answers as simulated, so the UI is fully explorable offline.

```bash
npm run build             # production build (Vite client + esbuild server bundle)
npm start                 # serve the built app
```

### Deploying it

```bash
cd deploy && docker compose up -d --build
```

A multi-stage image, a Compose deployment and an OpenTelemetry collector live in
[deploy/](deploy/README.md); CI builds the image, smoke-tests it and publishes it to
GHCR on every push to `main`.

Two things to know before deploying anything: EKOS runs as **exactly one instance**
(the SQLite file cannot be shared between containers), and the database must sit on a
mounted volume — get that wrong and it is destroyed on every redeploy without an
error, because the schema self-bootstraps and the service comes up healthy and empty.
Both are explained in [deploy/README.md](deploy/README.md).

### Watching it

The server emits OpenTelemetry traces, metrics and logs over OTLP, off by default and
on as soon as a collector endpoint is configured. The instrumentation is weighted
towards the failure this system actually has — a 200 response containing a wrong
answer — rather than towards error rates, which stay flat while retrieval silently
degrades to keyword-only. [docs/OPERATIONS.md](docs/OPERATIONS.md) covers what is
measured, what is alerted on, and what still is not covered.

The same instinct applies in the UI: every answer reports what it cost, split by stage
(`Answered in 3.0s · AI 2.7s · retrieval 0.3s`). That breakdown is what turned "search
feels slow" into a specific finding — the embedding provider's first call takes 2.3s
against 0.35s warm, so the cost was a cold model, not the corpus, the index or the LLM.

## Tests & quality

```bash
npm test                  # vitest + supertest
npm run lint              # tsc --noEmit
npm run test:coverage     # needs: npm i -D @vitest/coverage-v8
```

The suite spans RBAC enforcement (client rules and server middleware), brand/department
document scoping, AI-grounding scope isolation, key encryption, the document, sync and
governance API routes, batch-write atomicity, SharePoint ingest governance, tombstoning
and duplicate-file deduplication, the answer-formatting contract the search prompt states
to the model in every locale, per-stage search timings, search relevance, locale key
parity, telemetry, the error boundary, list virtualization, and `axe-core` accessibility
over shared primitives, all seven tab screens and fourteen dialog surfaces. It also carries a **documentation-drift guard** (`tests/docsDrift.test.ts`)
that fails the build when a document contradicts the code — counts that disagree with
the constants, a reference to a removed brand, or a claim the implementation no longer
matches. `.github/workflows/ci.yml` runs lint, test, and build on every push and PR.

Honest gap: roughly half of the source modules — most of the React components and
hooks — have no direct test of their own; coverage is concentrated on the server,
data and scoping layers. `npm run test:coverage` reports the real numbers once the
coverage provider is installed (it is not in the lockfile).

---

## Project structure

```text
├── server.ts              # Express entrypoint (Vite middleware + REST API)
├── src/
│   ├── App.tsx            # Layout and tab routing (tabs are React.lazy-loaded)
│   ├── api/               # Client-side network wrappers
│   ├── components/        # UI: layout, shared primitives, and per-tab modules
│   ├── context/           # Auth, Brand, Department, Locale, Breadcrumb providers
│   ├── db/                # Drizzle schema, engine, seed
│   ├── repositories/      # Client-side data access (governance; the document
│   │                      #   repository was removed when the server became
│   │                      #   the single source of truth)
│   ├── server/            # Routes + RBAC/rate-limit/security middleware
│   ├── services/          # Search, sync, governance, document-processing engines
│   └── utils/             # Text extraction, telemetry, helpers
├── deploy/                # Dockerfile lives at the root; Compose, collector, alerts here
├── docs/                  # Documentation set — start at docs/README.md
└── tests/                 # vitest + supertest suites
```

## Documentation

Start at [docs/README.md](docs/README.md) for the full index. Most useful entry points:

- [docs/PRODUCT.md](docs/PRODUCT.md) — product vision, personas, requirements
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — target topology and actual prototype
- [docs/DECISIONS.md](docs/DECISIONS.md) — architecture decision log
- [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) — the honest scope boundary and hardening roadmap

## What I'd build next

The prototype is deliberately bounded. The natural next increments, in order:

1. Swap the simulated user switcher for OIDC/SAML SSO and signed sessions. This is
   the one real blocker: every other gap degrades the system, this one is the
   difference between enforced authorization and authorization enforced against an
   identity nobody proved.
2. Move to PostgreSQL with a real vector store (pgvector or a dedicated one). One
   change closes two of the bounds above — the single-instance pin and the
   brute-force index living inside the same SQLite file.
3. Stream the answer. A search costs ~3s end to end and the user sees nothing until
   the model has finished generating the entire JSON payload; the answer body is
   the slow field and it is also the one they could be reading first.
4. Add MCP connectors for automatic ingestion from real corporate repositories.
