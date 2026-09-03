# Relational Database Schema & Data Strategy

**Purpose:** This document specifies the database strategy, schema design, data types, indexes, and transactional boundaries for the relational database powering the Enterprise Knowledge Platform.
**Owner:** Lead Database Engineer / Architect
**Last Updated:** 2026-06-26
**Status:** Approved Template

---

## 1. Database Sizing & Sizing Baselines

The transactional persistence tier must support multi-tenant scale requirements:
- **Baseline Load**: 100 concurrent tenants, 1,000 active users, and 100,000 indexed documents.
- **Max Peak Target**: 1,000 tenants, 10,000 active users, and 10,000,000 chunks.
- **Relational Technology**: PostgreSQL / Relational Engine supporting JSONB data types and robust primary/foreign indexing models.

---

## 2. Core Relational Schema Blueprint (Logical Tables)

> **Target vs. actual.** §1–§3 describe the aspirational PostgreSQL production
> blueprint. The prototype ships a SQLite/Drizzle schema whose tables are named
> `kb_*` and differ from the logical `documents`/`document_chunks` tables below —
> the implemented schema is documented in **§4**. Where they disagree, §4 is the
> source of truth (`src/db/schema.ts`).

All schema changes must align with these tables and relationships:

### Table 1: `documents`
Stores primary documents indexed from ingestion sources.

| Column Name | Data Type | Key Type | Nullable | Constraints / Indexes |
| :--- | :--- | :--- | :--- | :--- |
| `id` | VARCHAR(255) | PRIMARY KEY | NO | Hash Index |
| `title` | VARCHAR(512) | - | NO | Full Text Index |
| `owner` | VARCHAR(255) | - | NO | - |
| `version` | VARCHAR(50) | - | NO | DEFAULT '1.0.0' |
| `security_level`| VARCHAR(50) | - | NO | Check constraint (Public, Internal, Confidential) |
| `created_at` | TIMESTAMP | - | NO | DEFAULT CURRENT_TIMESTAMP |
| `source_id` | VARCHAR(255) | FOREIGN KEY | NO | Reference `knowledge_sources(id)` |

### Table 2: `document_chunks`
Stores segmented textual content for search retrieval and RAG.

| Column Name | Data Type | Key Type | Nullable | Constraints / Indexes |
| :--- | :--- | :--- | :--- | :--- |
| `id` | VARCHAR(255) | PRIMARY KEY | NO | - |
| `document_id` | VARCHAR(255) | FOREIGN KEY | NO | Reference `documents(id)` ON DELETE CASCADE |
| `chunk_index` | INT | - | NO | UNIQUE (document_id, chunk_index) |
| `content` | TEXT | - | NO | - |
| `vector_id` | VARCHAR(255) | - | YES | B-Tree index for vector mapping |

### Table 3: `kb_brands`
Stores brand configurations, locales, and service profiles.

| Column Name | Data Type | Key Type | Nullable | Constraints / Indexes |
| :--- | :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | NO | - |
| `displayName` | TEXT | - | NO | - |
| `shortCode` | TEXT | - | NO | - |
| `country` | TEXT | - | YES | - |
| `locale` | TEXT | - | YES | - |
| `vatRate` | REAL | - | YES | - |
| `vatLabel` | TEXT | - | YES | - |
| `currency` | TEXT | - | YES | - |
| `currencySymbol`| TEXT | - | YES | - |
| `color` | TEXT | - | YES | - |
| `teamIds` | TEXT | - | YES | JSON serialized string of team IDs |
| `pricingPlans` | TEXT | - | YES | JSON serialized string of pricing plans |
| `isActive` | INTEGER | - | YES | DEFAULT 1 (true) |
| `tenantId` | TEXT | - | YES | DEFAULT 'tenant_default' |
| `createdAt` | TEXT | - | YES | ISO timestamp |
| `updatedAt` | TEXT | - | YES | ISO timestamp |

---

## 3. Database Migration & Integrity Rules

1. **Schema Revisions**: No raw database alterations. All adjustments must go through versioned SQL or schema migration scripts reviewed by the Lead Database Architect.
2. **Cascading Strategies**: Delete cascades must be carefully configured. Removing a Knowledge Source must cleanly archive or cascade-delete dependent documents and text chunks to prevent orphaned database references.
3. **Optimistic Locking**: Critical transactional records must utilize version flags to prevent dirty reads or overwrite anomalies during multi-user sessions.

---

## 4. Actual Prototype Schema (SQLite / Drizzle)

The implemented schema lives in `src/db/schema.ts` (engine `better-sqlite3` + Drizzle ORM) and is created/migrated by `src/db/db.ts`. It has **11 tables**: nine prefixed `kb_`, plus two auth tables (`user_directory`, `auth_sessions`) added with the corporate OAuth2 integration (see [AUTH_INTEGRATION_PLAN.md](./AUTH_INTEGRATION_PLAN.md)):

| Table | PK | Key relationships | Purpose |
| :--- | :--- | :--- | :--- |
| `kb_documents` | `id` | referenced by versions & chunks | Primary KB documents (content, scope, brand/department scoping, approval & review metadata, ratings) |
| `kb_document_versions` | `id` | `document_id` → `kb_documents` **ON DELETE CASCADE** | Immutable per-version content snapshots; a content edit writes a new row |
| `kb_document_chunks` | `id` | `version_id` → `kb_document_versions` **ON DELETE CASCADE** | Segmented text for retrieval, with its embedding vector and provenance columns — see the embeddings bullet below (this row previously claimed the columns were unused placeholders; they have held real vectors since the hybrid RAG pipeline landed) |
| `kb_sources` | `id` | referenced by sync jobs | Connected knowledge sources (type, status, record count, `config` JSON) |
| `kb_sync_jobs` | `id` | `source_id` → `kb_sources` **ON DELETE CASCADE** | Sync/ingestion job log (`status`: Completed / Warning / Halted / Started) |
| `kb_queries_audit` | `id` | — | Assistant query audit trail (query, response, confidence, rating, feedback) |
| `kb_search_gaps` | `id` | — | Unanswered/low-confidence queries flagged for governance |
| `kb_governance_configs` | `key` | — | Key/value JSON store (`ai_provider_config`, `desk_settings`, `review_tasks`) |
| `kb_brands` | `id` | — | Brand roster (see §2 Table 3) — the source of truth for the 14 brands |
| `user_directory` | `corporate_username` | — | Corporate AD `user_name` → EKOS identity (role/department/brand/permissions), used by the OAuth auth mode to map a signed-in corporate user to a `PortalUser`. Seeded from `INITIAL_USERS`. |
| `auth_sessions` | `id` | — | Server-side BFF sessions: the corporate access/refresh tokens **encrypted at rest** (`src/server/crypto.ts`), the resolved EKOS user, and an absolute expiry. The browser holds only a signed `httpOnly` cookie carrying the session id. |

**Conventions that hold across (almost) every table:**
- **Standard columns:** `tenant_id` (`NOT NULL DEFAULT 'tenant_default'` — tenancy is single-tenant today), `created_at`, `updated_at`, and `deleted_at`. Exceptions: `kb_governance_configs` is keyed by `key` (no `id`); the two auth tables carry no `deleted_at` (a session is hard-deleted at logout/expiry, a directory row is edited in place), and `auth_sessions` uses `expires_at`/`last_seen_at` instead of a soft-delete marker.
- **Soft delete (S5):** `deleted_at` is set instead of removing a row; the shared `isGroundableDoc` predicate and every read path/aggregate exclude rows where `deleted_at` is non-null, so a deleted document never grounds retrieval or inflates telemetry.
- **Cascade chain:** deleting a `kb_documents` row cascades to its `kb_document_versions`, which cascade to their `kb_document_chunks` — verified with FK enforcement ON (`PRAGMA foreign_keys = ON`).
- **Embeddings live in `kb_document_chunks`:** `embedding` holds a JSON array of L2-normalized floats, with `embedding_model` / `embedding_version` (the `provider:model[:dims]` signature) / `embedding_date` / `future_embedding_status` recording how and when it was produced. Vector search filters on an exact `embedding_version` match, so a model change invalidates the index rather than silently mixing vector spaces. Rows are written `pending` at ingest and vectorized by `POST /api/embeddings/backfill` — a KB that has never run the backfill has no vectors and serves lexical-only retrieval (see [RAG.md](./RAG.md) §5). `similarity_score` remains unused.
- **Governance-gated fields:** `approval_status` on `kb_documents` gates whether a doc is groundable; it can only be set to an approved value by a governance role (see [API_SPECIFICATION.md](./API_SPECIFICATION.md) §2.2).

The seed (`src/db/seed.ts`) backfills reference data (brands, sample sources/jobs) with `onConflictDoNothing()` so a re-seed is safe. Schema changes go through versioned migrations — see §5.

---

## 5. Schema Migrations (Actual)

§3 above requires that "no raw database alterations" happen and that every change go through a reviewed migration. Until 2026-08-05 the implementation did not meet its own rule: `initDatabase()` ran ~200 lines of `CREATE TABLE IF NOT EXISTS` at every boot, followed by a hand-maintained list of `ALTER TABLE ... ADD COLUMN` statements in empty `catch` blocks, with a comment instructing the next developer to append a line per new column.

That is adequate for a greenfield dev database and inadequate for anything with data in it. It could **add** a column but never rename, drop, re-type or backfill one; it recorded **nothing** about which changes a given database had received, so there was no way to tell a current database from a stale one; and a forgotten line surfaced as `no such column` on the first read rather than at startup.

**How it works now.**

| Command | What it does |
| :--- | :--- |
| `npm run db:generate` | Diffs `src/db/schema.ts` against the snapshot in `src/db/migrations/meta/` and writes a new numbered `.sql` file for the difference. Review it like any other code. |
| `npm run db:check` | Verifies the migration folder is internally consistent (no collisions or gaps). |
| *(startup)* | `initDatabase()` applies every migration not yet recorded in `__drizzle_migrations`, then logs `migrationsApplied` / `migrationsTotal`. |

`drizzle-kit push` is deliberately **not** wired to a script: it mutates a database to match the schema without leaving a reviewable migration, which is the practice this replaces.

**Baseline.** `0000_baseline.sql` is the one hand-edited file in the folder: generated output, with `CREATE TABLE` changed to `CREATE TABLE IF NOT EXISTS`. This is what lets a database created by the old startup DDL adopt migrations without being rebuilt. The migrator applies everything newer than the last recorded migration inside a **single transaction and rolls back on error**, so a plain `CREATE TABLE` would raise "table `kb_brands` already exists" and abort startup on every pre-existing database. With `IF NOT EXISTS` the baseline is a no-op there, gets recorded as applied, and the schema and its history agree again. Verified against the live 23 MB database: 201 documents, 985 chunks, 685 embeddings and 14 brands, all unchanged, with one migration recorded. Later migrations must be verbatim generator output — `tests/migrations.test.ts` fails if any of them contains `IF NOT EXISTS`. Two feature migrations have since been generated this way: `0001_messy_xorn.sql` (`user_directory`) and `0002_shiny_grim_reaper.sql` (`auth_sessions`), both plain `CREATE TABLE`.

**Legacy column reconciliation.** Because the baseline skips tables that already exist, a pre-migration database keeps whatever columns it had — so the five `ALTER TABLE ... ADD COLUMN` statements the old mechanism used to run are retained in `initDatabase()` as a **frozen** list, and run after the migrator. New databases get those columns from the baseline and the statements no-op. This list is closed: every column added from now on comes from a generated migration, and the block can be deleted once no pre-migration database remains.

**Deployment note.** The production bundle (`dist/server.cjs`) does not embed the `.sql` files; they are read from disk at startup, resolved relative to the working directory. A container image must copy `src/db/migrations` alongside the bundle, or set `DRIZZLE_MIGRATIONS_DIR`.

**Readiness.** `GET /readyz` reports migration state as a **required** check — a process serving on a schema older than its own code fails readiness rather than waiting to fail on a query.

**Still out of scope:** this is versioned migration of a single SQLite file. Backups, replicas, failover and the managed-cluster migration remain as described in §1 and in [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).
