# EKOS — Documentation Index

Entry point for the EKOS documentation set. The root [README](../README.md) is the
place to start for what the project is and how to run it; the documents below go
deeper on a single concern each.

> **Note on tone.** These documents are written in the voice of an internal
> enterprise platform (owners, review boards, sign-off gates). That framing is a
> deliberate part of the simulation — EKOS is a portfolio piece that models what an
> enterprise knowledge platform *and its paperwork* look like, not a live product.
> [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) is the honest map of prototype vs.
> production.

---

## Current status

### Works end-to-end
- AI-powered search grounded in real KB documents, scoped by brand and department
- Document upload with real text extraction (PDF/DOCX/XLSX/CSV/TXT), approval queue, and SQLite persistence via REST
- Multi-brand support (14 brands) and multi-department scoping (10 departments)
- Role-based tab access enforced on both client and server (interim, pre-IdP)
- Knowledge sources dashboard, sync/indexing board, and AI query audit trail
- Per-brand AI provider config (Gemini, Anthropic, OpenAI, Groq) with encrypted key storage
- Rate limiting, CORS, security headers (helmet), 8-language UI, light/dark themes

### Requires production engineering (out of prototype scope)
- MCP connectors for automatic ingestion; vector embeddings for semantic RAG at scale
- JWT/SSO identity provider integration — the one item that gates exposure beyond a trusted network
- A deployment target, an Alertmanager receiver, and an off-host backup destination.
  CI builds, smoke-tests, scans and publishes an image; the stack runs backups on a
  schedule with a heartbeat and an age-based alert. None of it reaches a human or
  leaves the host until those three are configured — see [OPERATIONS.md](./OPERATIONS.md) §5
- See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the full boundary and hardening roadmap

### Quality gates
- `npm test` (vitest + supertest) — RBAC enforcement on both the client rules and the server middleware, brand/department scoping, AI-grounding caller-scope isolation, key encryption, the document/sync/governance API routes, batch-write atomicity, SharePoint ingest governance, tombstoning and duplicate-file deduplication, the answer-formatting contract the search prompt states to the model in every locale, search relevance, locale key parity, telemetry, the error boundary, list virtualization, and `axe-core` accessibility over shared primitives, all seven full tab screens, and fourteen dialog surfaces opened and driven with real Tab/Shift+Tab keypresses (`tests/dialogAccessibility.test.tsx`, which also statically guards that anything declaring dialog semantics attaches a focus trap), plus drift guards over the deployment manifests (`tests/deployment.test.ts` — which also pins the properties a container scan cannot report until it is too late: every CI action pinned to a resolvable ref, the build toolchain kept out of the production dependency tree, Vite never imported on the production path, Debian security upgrades applied in the shipping stage, the backup script placed where it can both resolve and parse, and `xlsx` sourced from the vendor rather than npm's abandoned release) and the design system (`tests/designSystem.test.ts`)
- **Documentation-drift guard** (`tests/docsDrift.test.ts`) — fails when a document contradicts the code: a count that disagrees with the constants it describes, a reference to a removed brand, a wrong port, or a claim the implementation no longer matches. Added because this documentation set went stale — a wrong brand count, and an API spec still describing the endpoints as unauthenticated months after server-side RBAC shipped — with nothing to catch it
- `tsc --noEmit` typecheck and `vite build` run in CI on every push/PR (`.github/workflows/ci.yml`)
- **Known gap:** about half the source modules — mostly React components and hooks — have no direct test; coverage is concentrated on the server, data and scoping layers. `npm run test:coverage` needs `@vitest/coverage-v8` installed (not in the lockfile)

---

## Documentation map

| File | Domain |
| :--- | :--- |
| [PRODUCT.md](./PRODUCT.md) | Product vision, personas, functional requirements, document lifecycle |
| [EXECUTIVE_SUMMARY.md](./EXECUTIVE_SUMMARY.md) | Business rationale, OKRs, value matrix |
| [ROADMAP.md](./ROADMAP.md) | Delivery phases and technology horizon |
| [DECISIONS.md](./DECISIONS.md) | Architecture Decision Record (ADR) log — the "why it's built this way" |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Logical architecture, target topology, and the actual prototype architecture |
| [DATABASE.md](./DATABASE.md) | SQLite/Drizzle schema and data design |
| [BACKEND.md](./BACKEND.md) | Express middleware and service layer |
| [API_SPECIFICATION.md](./API_SPECIFICATION.md) | REST endpoint contracts |
| [SECURITY.md](./SECURITY.md) | Auth, encryption, and compliance posture |
| [PERFORMANCE.md](./PERFORMANCE.md) | Latency, caching, and scale targets |
| [OPERATIONS.md](./OPERATIONS.md) | What the service reports about itself, what is alerted on, and what still is not covered |
| [RAG.md](./RAG.md) | Chunking and embedding design |
| [MCP.md](./MCP.md) | Model Context Protocol integration design |
| [INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md) | Sitemap and content models |
| [UX_GUIDELINES.md](./UX_GUIDELINES.md) | Interaction, density, and navigation patterns |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Color, typography, and component tokens |
| [ACCESSIBILITY.md](./ACCESSIBILITY.md) | WCAG approach and the accessibility test gate |
| [REVIEW_FRAMEWORK.md](./REVIEW_FRAMEWORK.md) | Design/quality review methodology |
| [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) | Scope boundaries, known gaps, and hardening roadmap |
| [knowledge-base/](./knowledge-base/) | Seed KB articles used to ground the assistant |

Release history lives in git commit history; significant technical decisions are
captured in [DECISIONS.md](./DECISIONS.md).

## Documentation conventions

1. **Density over prose** — tables and lists rather than long paragraphs.
2. **No embedded code snippets** — docs describe architecture, schemas and contracts; implementation lives in the code, so docs can't drift out of sync with it.
3. **Honesty about scope** — anything not yet built is named as such and linked to [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).
