import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/db/schema.ts';
import { migrationStatus } from '../src/db/db.ts';
import { createTestApp } from './testApp.ts';

/**
 * Versioned migrations.
 *
 * The schema used to be created by an idempotent `CREATE TABLE IF NOT EXISTS`
 * block at startup, plus a hand-maintained list of `ALTER TABLE ... ADD COLUMN`
 * in empty catch blocks. That could only ever add columns, never rename, drop or
 * re-type one; it recorded nothing about what a given database had received; and
 * a forgotten line surfaced as "no such column" at the first read.
 *
 * The risk in replacing it is the opposite failure: drizzle's migrator applies
 * everything newer than the last recorded migration inside ONE transaction and
 * rolls back on error, so a baseline that assumes an empty database would abort
 * startup on every database that already has tables. These cases pin down both
 * directions — a fresh database gets built, and a pre-migration one adopts the
 * baseline without being touched.
 */
const REPO = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO, 'src', 'db', 'migrations');

/** The DDL the pre-migration startup routine used to run, verbatim enough to matter. */
const LEGACY_DDL = `
  CREATE TABLE kb_documents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
    scope TEXT NOT NULL, brand_id TEXT, category TEXT, is_important INTEGER DEFAULT 0,
    content TEXT, uploaded_at TEXT NOT NULL, uploaded_by TEXT NOT NULL, owner TEXT,
    department TEXT, review_frequency TEXT, expiration_date TEXT, approval_status TEXT,
    version TEXT DEFAULT '1.0', last_review_date TEXT, views_count INTEGER DEFAULT 0,
    rating_up INTEGER DEFAULT 0, rating_down INTEGER DEFAULT 0,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, deleted_at TEXT
  );
  CREATE TABLE kb_brands (
    id TEXT PRIMARY KEY, displayName TEXT NOT NULL, shortCode TEXT NOT NULL, country TEXT,
    locale TEXT, vatRate REAL, vatLabel TEXT, currency TEXT, currencySymbol TEXT,
    color TEXT, teamIds TEXT, pricingPlans TEXT, isActive INTEGER DEFAULT 1,
    tenantId TEXT DEFAULT 'tenant_default', createdAt TEXT, updatedAt TEXT
  );
`;

beforeAll(() => {
  // Applies the migrations against the in-memory database the suite shares.
  createTestApp();
});

describe('migration files', () => {
  it('has a journal whose every entry has a matching .sql file', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'));
    expect(journal.entries.length).toBeGreaterThan(0);
    for (const entry of journal.entries) {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`)), `${entry.tag}.sql is missing`).toBe(true);
    }
  });

  /**
   * The baseline is the one file that may deviate from generated output, and only
   * in this specific way. If a later migration copies the pattern, a genuine
   * "table already exists" conflict would pass silently instead of failing loudly.
   */
  it('uses IF NOT EXISTS in the baseline only', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'));
    const [baseline, ...rest] = journal.entries;

    // Comments are stripped first: the baseline's header explains the CREATE TABLE
    // → CREATE TABLE IF NOT EXISTS edit in prose, and prose is not DDL.
    const statementsOf = (tag: string) =>
      fs
        .readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');

    const baselineSql = statementsOf(baseline.tag);
    expect(baselineSql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(baselineSql.match(/CREATE TABLE(?! IF NOT EXISTS)/g)).toBeNull();

    for (const entry of rest) {
      expect(statementsOf(entry.tag), `${entry.tag}.sql must be verbatim generator output`).not.toContain('IF NOT EXISTS');
    }
  });
});

describe('applying migrations to a fresh database', () => {
  it('creates every table the schema declares', () => {
    const sqlite = new Database(':memory:');
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_DIR });

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name);

    for (const expected of [
      'kb_documents', 'kb_document_versions', 'kb_document_chunks', 'kb_sources',
      'kb_sync_jobs', 'kb_queries_audit', 'kb_search_gaps', 'kb_governance_configs', 'kb_brands',
    ]) {
      expect(tables, `${expected} was not created`).toContain(expected);
    }
    sqlite.close();
  });

  it('records what it applied, and is a no-op the second time', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const count = () =>
      (sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as any).n;
    const first = count();
    expect(first).toBeGreaterThan(0);

    migrate(db, { migrationsFolder: MIGRATIONS_DIR }); // re-run
    expect(count()).toBe(first);
    sqlite.close();
  });
});

describe('adopting migrations on a pre-migration database', () => {
  /**
   * The failure this guards against is total: a plain `CREATE TABLE` baseline
   * raises "table kb_brands already exists", the migrator rolls back, and
   * initDatabase() throws — every existing deployment fails to start.
   */
  it('does not fail against a database that already has tables', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(LEGACY_DDL);
    sqlite.prepare(
      `INSERT INTO kb_brands (id, displayName, shortCode, createdAt, updatedAt)
       VALUES ('brand_legacy', 'Legacy Brand', 'LGC', '2026-01-01', '2026-01-01')`
    ).run();

    expect(() => migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_DIR })).not.toThrow();

    // The pre-existing row is untouched — the baseline skipped the table.
    const row = sqlite.prepare(`SELECT displayName FROM kb_brands WHERE id = 'brand_legacy'`).get() as any;
    expect(row.displayName).toBe('Legacy Brand');

    // ...and tables it did NOT have were created.
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain('kb_document_chunks');
    expect(tables).toContain('__drizzle_migrations');
    sqlite.close();
  });

  /**
   * The consequence of a baseline that skips existing tables: columns the old
   * ALTER-on-startup mechanism added are still missing afterwards. That is what
   * initDatabase()'s frozen LEGACY_COLUMN_BACKFILL list is for.
   */
  it('leaves legacy tables missing the columns the frozen backfill list covers', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(LEGACY_DDL);
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_DIR });

    const columns = () =>
      sqlite.prepare('PRAGMA table_info(kb_documents)').all().map((c: any) => c.name);
    expect(columns()).not.toContain('department_scope');

    // Exactly what initDatabase() does after migrating.
    sqlite.exec('ALTER TABLE kb_documents ADD COLUMN department_scope TEXT;');
    expect(columns()).toContain('department_scope');
    sqlite.close();
  });
});

describe('migrationStatus()', () => {
  it('reports the live database as up to date after startup', () => {
    const status = migrationStatus();
    expect(status.upToDate).toBe(true);
    expect(status.pending).toBe(0);
    expect(status.applied).toBeGreaterThan(0);
  });
});
