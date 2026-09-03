---
name: ekh-docs
description: >
  Audit, correct, and write documentation for the Enterprise Knowledge Hub project.
  Use this skill whenever the user wants to: review existing docs, fix outdated
  documentation, document a new feature, update the README, write architecture docs,
  create API documentation, or check that docs match the actual code. Also triggers for:
  "document this", "update the docs", "what does X do", "write a README for",
  "is this documented", "check the docs", or any request about documentation quality
  or completeness in this project. Always read the actual code before writing or
  correcting any documentation — never document from memory.
---

# Enterprise Knowledge Hub — Documentation Skill

## Project context

**What it is:** Multi-brand, multi-department AI-powered knowledge base for customer
service agents. React frontend + Express backend + SQLite (prototype) / PostgreSQL (production).

**Key dimensions:**
- Brand (commercial): 14 brands total — 13 customer-facing (northwind_de DE, Northwind Bureau FR,
  Secretaría.es ES, Northwind Italia IT, Northwind JP, Northwind NL, Northwind Office, Northwind CH, Northwind FR,
  Northwind Center, Northwind Legal, Northwind Bureau AG/northwind_dbag, Northwind Club) plus `internal_it`, the
  internal IT-department brand. Source of truth: `kb_brands` table / `src/constants/brands.ts`
- Department (internal): customer_service, call_center, human_resources, training,
  it, sales, marketing, finance, legal, administration
- Office/Location: Pending — architecture designed, not yet implemented

**Roles (ascending permissions):**
Agent → Operator → TeamLeader → LocationManager → Administrator

**The docs set is large — 21 files.** Before writing a new one, check whether the
subject already has a home: `README`, `ARCHITECTURE`, `API_SPECIFICATION`,
`BACKEND`, `DATABASE`, `RAG`, `SECURITY`, `OPERATIONS`, `KNOWN_LIMITATIONS`,
`DECISIONS` (the ADR log), `ACCESSIBILITY`, `DESIGN_SYSTEM`,
`INFORMATION_ARCHITECTURE`, `PERFORMANCE`, `PRODUCT`, `ROADMAP`,
`EXECUTIVE_SUMMARY`, `REVIEW_FRAMEWORK`, `SHAREPOINT_SYNC`, `MCP`,
`UX_GUIDELINES`, plus `docs/openapi.json`. Deployment and operations also have
`deploy/README.md`. A new top-level doc needs a reason no existing one fits.

## Step 1 — Audit what exists

Before writing anything, read what's already there:

```bash
ls docs/
cat docs/README.md
cat docs/KNOWN_LIMITATIONS.md   # the honest inventory — check it first
cat docs/DECISIONS.md           # ADRs: why things are the way they are
```

Then read the actual code to verify accuracy:

```bash
# Check if docs match reality
grep -n "brandIds\|departmentIds\|officeIds" src/types/index.ts
grep -n "canAccess\|LocationManager" src/context/AuthContext.tsx
grep -rnE "router\.(get|post|patch|put|delete)\(" src/server/routes/*.ts   # routes live here, not server.ts
```

**Golden rule:** If the docs say X but the code does Y, the code is the truth.
Flag the discrepancy and correct the doc.

## Step 2 — Identify doc type needed

| Request | Doc to create/update |
|---------|---------------------|
| "document this feature" | Inline JSDoc + relevant /docs/*.md section |
| "update the README" | docs/README.md — Current Status section especially |
| "document the API" | docs/API_SPECIFICATION.md |
| "architecture docs" | docs/ARCHITECTURE.md |
| "security docs" | docs/SECURITY.md |
| "how does X work" | Inline explanation + add to relevant doc |
| "what roles can see Y" | docs/RBAC.md or add to ARCHITECTURE.md |

## Step 3 — Audit checklist

Run through this checklist for every docs audit:

### README.md
- [ ] Current Status section reflects what actually works (not aspirational)
- [ ] "What requires IT" section is accurate and complete
- [ ] Known gaps are honest (SQLite not production-ready, no SSO, brute-force vector index rather than a production vector DB)
- [ ] Installation instructions actually work with current package.json scripts
- [ ] **No claim denies a capability the code has.** Drift runs both ways: the
      "what's real vs. simulated" box claimed "no vector store or embedding search"
      for the whole life of the shipped RAG pipeline, *underselling* the product,
      while every other doc had been corrected. Understatement is drift too — audit
      the honesty box against the code, not just the boastful sections.
      Guarded by `tests/docsDrift.test.ts` (ADR 029).
- [ ] **Any metric quoted in prose is derived from a committed artifact.** The
      hit@1/hit@5/MRR figures must match `eval/baseline.json`, which stamps the
      retrieval config that produced it. A number nothing derives is a number that
      rots (ADR 030).

### ARCHITECTURE.md
- [ ] Three dimensions documented: Brand / Department / Office
- [ ] Role hierarchy correct: Agent → Operator → TeamLeader → LocationManager → Administrator
- [ ] Tab visibility matrix matches canAccess() in AuthContext.tsx
- [ ] Data flow documented: client → searchService → searchApi → /api/search → DB
- [ ] Mentions: lazy loading, GovernancePanelContext, DepartmentContext, BrandContext

### API_SPECIFICATION.md
- [ ] All routes are documented. They live in `src/server/routes/*.ts`
      (`ai`, `brands`, `documents`, `governance`, `health`, `sources`, `sync`) —
      not in `server.ts`, which only composes the app
- [ ] Request/response schemas match actual code, and match `docs/openapi.json`
- [ ] Error codes are listed, and the failure envelope shape matches
      `tests/apiContract.test.ts`, which is the contract's actual guard
- [ ] Authentication is described **precisely**, which is neither "no auth" nor
      "authenticated". RBAC *is* enforced server-side, per route, asserted by
      `tests/rbacEnforcement.test.ts` — but the bearer token is an unsigned user
      id, so identity is spoofable by anyone who knows one. Saying "no auth in
      the prototype" understates the authorization work; saying it is
      authenticated overstates the identity guarantee. Say both parts
- [ ] departmentId + brandId params documented on /api/search

### SECURITY.md
- [ ] Current state: helmet, CORS, rate limiting, apiKey masking, AES-256
      encryption at rest for provider keys (`src/server/crypto.ts`, keyed on
      `ENCRYPTION_SECRET`) — what's done
- [ ] Production blockers: unsigned identity (no IdP), SQLite single-instance
- [ ] `.env` and `db.sqlite*` are excluded from git *and* from the image
      (`.gitignore`, `.dockerignore`, asserted by `tests/deployment.test.ts`).
      An earlier version of this checklist claimed `db.sqlite` was untracked-but-
      unignored; it is ignored. Verify before repeating a risk claim
- [ ] Restoring a database without its matching `ENCRYPTION_SECRET` leaves
      provider keys undecryptable — back them up as one unit

### OPERATIONS.md and deploy/README.md
- [ ] Every gap is stated as an absence, not implied by omission. Alerting gets
      this right: `deploy/alertmanager.yml` opens by saying it notifies nobody.
      Backups got it wrong for a while — a documented manual procedure reads like
      a control, and an operator concludes it is handled. **If nothing automates
      it, say so in those words**
- [ ] Nothing is described as verified that has never run. Docker is not
      installed on the dev machine, so image and compose behaviour is first
      exercised in CI

## Step 4 — Write JSDoc for key functions

When documenting code inline, use this pattern:

```typescript
/**
 * Searches the knowledge base with brand and department scoping.
 *
 * @param query - The search query from the user
 * @param brandId - Optional brand filter. If omitted, searches all brands.
 * @param departmentId - Optional department filter. If omitted, searches all departments.
 * @returns ResponseState with the AI-grounded answer or fallback mock result
 *
 * @example
 * // Search within Customer Service for Secretaría.es
 * const result = await searchService.search(
 *   'What is the cancellation policy?',
 *   'northwind_es',
 *   'customer_service'
 * );
 */
```

Priority functions to document if not already:
1. `searchService.search()` — src/services/searchService.ts
2. `canAccess()` — src/context/AuthContext.tsx
3. `filteredDocuments` useMemo — src/components/tabs/kb/KnowledgeBaseTab.tsx
4. `createTestApp()` — tests/testApp.ts
5. `callAI()` — **src/server/aiClient.ts** (moved out of server.ts)
6. `initDatabase()` — src/db/db.ts, applies migrations at startup and refuses to
   serve on an unrecognised schema

## Step 5 — Tab visibility matrix (keep updated)

This matrix must match `canAccess()` in `src/context/AuthContext.tsx`.
Verify it every time AuthContext changes.

| Tab | Agent | Operator | TeamLeader | LocationManager | Administrator |
|-----|-------|----------|------------|-----------------|---------------|
| copilot (Assistant) | ✅ | ✅ | ✅ | ✅ | ✅ |
| kb (Knowledge Base) | ✅ | ✅ | ✅ | ✅ | ✅ |
| review (Review Queue) | ❌ | ❌ | ❌ | ✅ | ✅ |
| sources | ✅ | ✅ | ✅ | ✅ | ✅ |
| settings | ❌ | ❌ | ✅ | ✅ | ✅ |
| governance | ❌ | ❌ | ❌ | ✅ read-only | ✅ |
| sync | ❌ | ❌ | ❌ | ❌ | ✅ |

`review` became a top-level tab on 2026-08-07, split out of `kb` where it had been
a sub-tab. It reuses the `governance` predicate exactly — do not describe it as a
new permission. `kb` is open to every role; the review workflow it used to contain
is not.

## Step 6 — Current Status template

Use this template for docs/README.md Current Status section.
**Always update the date and verify each item against actual code.**

```markdown
## Current Status — v[X] · [Date]

### Works end-to-end
- AI-powered search grounded in real KB documents (brand + department scoped)
- Document upload → approval queue → persistence to SQLite via REST API
- Multi-brand: [list actual brands from src/constants/brands.ts]
- Multi-department: 10 departments with per-dept Quick Actions, Common Questions, Policy Changes
- 5-role RBAC: Agent / Operator / TeamLeader / LocationManager / Administrator
- i18n: 8 languages (EN/ES/DE/FR/IT/JA/NL/TH) with lazy-loaded dictionaries
- Idle lock screen after 10 minutes inactivity
- Rate limiting, CORS, security headers, masked API keys in UI

### Requires IT before production
- SSO authentication (Azure AD / Microsoft Entra ID) and a verified session in
  place of the unsigned Bearer id
- PostgreSQL migration (currently SQLite, pinned to one instance by design)
- Office/location layer (architecture designed, pending confirmed location list)
- A deployment target, and an Alertmanager receiver — CI builds, smoke-tests and
  publishes an image, and alerts fire, but none of them reach a human
- An off-host destination for backups (`BACKUP_OFFHOST_URL`); they run and retain
  on a schedule, but stay on the same host until one is configured

### Known gaps
- Hybrid retrieval is real (chunking + embeddings + cosine index + RRF), but the index is a brute-force scan in SQLite, not a production vector DB; a deployment that never ran the embedding backfill serves lexical-only
- No real IdP — RBAC enforced server-side but on an unsigned Bearer id (spoofable)
- SQLite, not production Postgres; single-tenant (tenantId hardcoded)
- Some i18n keys carry the English string in at least one locale. Treat any count
  as an upper bound rather than a defect count: several are correct cognates
  ("Description" and "Action" in French, "Auditor:" in Spanish/Italian/Dutch).
  Recount before quoting it — the key total moves every time a feature lands
- Backups run on a schedule with a heartbeat and an age-based alert, but stay on
  the same host unless an off-host destination is configured, and no external
  uptime check exists
- Office/location dimension not implemented (pending IT + HR input)
```

## What to flag as outdated

When auditing, mark any doc section as ⚠️ OUTDATED if:
- It mentions SQLite as "production-ready"
- It lists only 3 brands (there are now 14)
- It doesn't mention LocationManager role
- It doesn't mention departments
- It says "no authentication planned" (SSO is planned via Azure AD)
- It references `localhost:5000` (correct port is 3000)
- API spec shows `/api/search` without `departmentId` parameter
- It says there are no automated tests, or points at a handful of files. There
  are 36 suites and ~475 assertions, and `npm test` runs them
- It says API keys are stored unencrypted (they are AES-256 encrypted at rest)
- It claims routes live in `server.ts`
- It describes CI as ending at `npm run build`
- It quotes a retrieval metric that does not match `eval/baseline.json`

**And the reflex to unlearn:** drift is not only staleness in the docs. Twice now
the drift was in the *tooling that describes the project* — this skill wrongly
listed `db.sqlite` as unignored, and `ekh-testing` told its reader to skip
component tests while seven jsdom suites existed. When a doc and a skill
disagree with the code, both are wrong and both need fixing.

## What NOT to document

- The fuzzy mock MOCK_KNOWLEDGE_BASE — it's demo scaffolding, not business logic
- Implementation details of Vite/Drizzle internals — link to their own docs instead
- Aspirational features that don't exist in the code yet
  (if it's not in the code, it goes in "Requires IT" or "Roadmap", not "Works")
