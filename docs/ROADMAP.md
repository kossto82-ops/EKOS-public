# Enterprise Platform Roadmap & Milestones

**Purpose:** This document charts the long-term technical and product roadmap for the Enterprise Knowledge Platform. It defines delivery phases, core milestones, and integration steps.
**Owner:** VP of Product
**Last Updated:** 2026-06-26
**Status:** Approved Template

---

## 1. Multi-Phase Deployment Strategy

The platform is designed around a multi-tier rollout plan spanning four critical phases:

```
+------------------+     +------------------+     +------------------+     +------------------+
|     Phase 1      |     |     Phase 2      |     |     Phase 3      |     |     Phase 4      |
| Interactive UX   |====>| Integration Prep |====>| System Pilot     |====>| Global Rollout   |
| (Baseline App)   |     | (APIs, Database) |     | (1,000 Users)    |     | (Enterprise)     |
+------------------+     +------------------+     +------------------+     +------------------+
```

---

## 2. Phase Deliverables and Gates

### Phase 1: Interactive UX Foundation (Completed)
- Establish the design system and front-end layout structures.
- Define initial information architecture and navigation flows.
- Implement responsive layout components and high-density tabular list views.

### Phase 2: System Integration Preparation (Current Focus)
- Deploy the relational database schema and database migration frameworks.
- Wire up the background document ingestion queue and metadata extraction services.
- Integrate the Model Context Protocol (MCP) clients to retrieve system file contexts.

### Phase 3: System Pilot
- Deploy secure user authentication services and role-based access gates.
- Launch the hybrid RAG search pipeline on a subset of corporate documentation.
- Initiate user pilot testing with up to 1,000 active concurrent user sessions.

### Phase 4: Global Rollout
- Optimize performance caching, database indexes, and API rate limiters.
- Deploy in high-availability, multi-zone configurations.
- Roll out the unified search workspace to all global business units.

---

## 3. Technology Horizon Planning

- **Short-Term (1-3 Months)**: Connect downstream document repositories (SharePoint, Shared Drives) and configure vector embedding models.
- **Medium-Term (3-6 Months)**: Refine RAG semantic retrieval using advanced cross-encoder rerankers and strict role-based data filtering.
- **Long-Term (6+ Months)**: Deploy federated workspace search, enabling multi-tenant isolation across global organizational units.

---

## 4. Scope Alignment & Hardening Roadmap

For a detailed analysis of production hardening tasks, owner assignments, timeline alignment, and risk assessments, refer to the official [Scope Boundaries & Known Limitations](./KNOWN_LIMITATIONS.md) document.

---

## 5. Deferred: bulk export of the corpus to Markdown

Not started, deliberately — recorded 2026-08-12 so the design decisions are not
re-derived when it is needed. The requirement is "move every document out, as
Markdown". It is a small job, and most of the cost is in three choices that are
easy to get wrong.

The corpus is already Markdown. Of 214 live documents, 202 are named `.md`, one
`.txt` and 11 `.pdf`; the PDFs are stored as extracted text, so their names get
rewritten exactly as `downloadFilenameFor()` in `src/utils/documentDownload.ts`
already does for the single-document download. No document has empty content and
no two share a name, so a flat export neither drops nor overwrites anything.

**Export from the database, not from the repository.** `src/data/*.json` holds the
authored snapshots, but the live database also holds documents created or edited
through the app and the 24 rows that come from no tracked source (see
`eval/task-gaps.md`). Note the counts do not agree — 229 documents authored across
the snapshots against 214 live in the database — and reconciling that is part of
this task, not a detail to discover afterwards.

**Frontmatter has to be regenerated, not copied.** `stripFrontmatter()` removes the
YAML header at ingest and the metadata lives in columns from then on, so an export
that writes only `content` produces 214 files with no owner, approval status,
department or version. Re-emitting the header from the columns is strictly better
than the original files, because a resolved owner replaces the
`[INFORMATION REQUIRED]` placeholder the crawl carried in.

**The original folder hierarchy is not in the database.** `folderPath` exists in the
snapshots but is not a column on `kb_documents`, so a database-only export has to
rebuild the tree from `category` / `department` — coherent, but not identical to
SharePoint's. If the original hierarchy matters, join the snapshot back in for the
documents that came from it.

Shape: a script writing `category/department/name.md` plus an inventory
`index.md`. If it should instead be self-service in the UI, it becomes an endpoint
returning an archive — and then it needs an access decision of its own, because
exporting the whole corpus in one call is precisely the action an access control
should be strict about.

