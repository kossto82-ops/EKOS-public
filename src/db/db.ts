import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';
import { logger } from '../server/logger.ts';

// Initialize SQLite database stored as a file in the workspace.
// Tests run against an isolated in-memory instance (see tests/testApp.ts) so
// they never read or write the real db.sqlite.
const isTest = process.env.NODE_ENV === 'test';

/**
 * Where the database file lives.
 *
 * This used to be the bare literal `'db.sqlite'`, i.e. relative to whatever
 * directory the process happened to start in. That is fine for `npm start` from
 * the repo root and wrong everywhere else: in a container the application code
 * lives on the image's read-only-ish layer and the data has to live on a mounted
 * volume, so the two cannot be the same directory. With a hardcoded relative path
 * the only way to persist the database was to mount a volume over the app
 * directory itself — which shadows the code — or to accept that every redeploy
 * silently started from an empty database. The failure mode was the bad kind:
 * nothing errors, the schema self-bootstraps, and the corpus is just *gone*.
 *
 * So: `DATABASE_PATH` wins if set, and its parent directory is created if it does
 * not exist, because a freshly-mounted volume is an empty directory and better-sqlite3
 * throws `SQLITE_CANTOPEN` rather than creating intermediate directories itself.
 * Unset, the old repo-root behaviour is preserved exactly, so local development
 * and the existing scripts are unaffected.
 */
export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'test') return ':memory:';
  const configured = env.DATABASE_PATH?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'db.sqlite');
}

const DATABASE_PATH = resolveDatabasePath();

if (!isTest) {
  const dir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(DATABASE_PATH);

/**
 * Where the migration files live at runtime, resolved from the working directory
 * exactly as `db.sqlite` above is — `npm start` runs from the repo root. Kept
 * env-overridable because the production bundle (dist/server.cjs) does not embed
 * these .sql files: a container image has to copy src/db/migrations alongside it,
 * or point DRIZZLE_MIGRATIONS_DIR at wherever it put them.
 */
const MIGRATIONS_DIR = process.env.DRIZZLE_MIGRATIONS_DIR ?? path.join(process.cwd(), 'src', 'db', 'migrations');

/**
 * Connection pragmas, as data so the choice is testable rather than buried in
 * module-load side effects.
 *
 * - `foreign_keys`: SQLite defaults this OFF; the schema declares FKs and relies
 *   on ON DELETE CASCADE, so it must be enabled on every connection.
 * - `busy_timeout`: wait for a lock instead of failing the request immediately.
 *   Without it, two concurrent writers — an interactive save landing during a
 *   SharePoint sync — surface as an opaque `SQLITE_BUSY` 500 rather than as a
 *   slightly slower success.
 * - `journal_mode = WAL`: the default `delete` journal takes an exclusive lock for
 *   the duration of every write, so a reader arriving mid-write gets SQLITE_BUSY.
 *   Under WAL readers never block on the writer, which matters here because a
 *   request can read kb_documents while a sync is upserting into it. Omitted for
 *   the in-memory test database, where WAL does not apply.
 *
 * `synchronous` is deliberately left at its FULL default rather than the NORMAL
 * that usually accompanies WAL: NORMAL can lose the last committed transactions on
 * an OS-level crash, and this database holds governance decisions.
 */
export function pragmaStatements(env: string | undefined): string[] {
  const pragmas = ['foreign_keys = ON', 'busy_timeout = 5000'];
  if (env !== 'test') pragmas.push('journal_mode = WAL');
  return pragmas;
}

for (const pragma of pragmaStatements(process.env.NODE_ENV)) {
  sqlite.pragma(pragma);
}

export const db = drizzle(sqlite, { schema });

/**
 * The pragmas actually in force on the live connection — for diagnostics and tests.
 *
 * `path` is included because it is now configurable: "which file am I actually
 * serving?" is the first question when a container comes up with an unexpectedly
 * empty corpus, and inferring it from the cwd is exactly the guesswork
 * DATABASE_PATH exists to remove. It is logged at startup, never returned by the
 * unauthenticated probes — a filesystem layout is not a probe's business.
 */
export function databaseSettings(): { path: string; journalMode: string; busyTimeoutMs: number; foreignKeys: boolean } {
  return {
    path: DATABASE_PATH,
    journalMode: String(sqlite.pragma('journal_mode', { simple: true })),
    busyTimeoutMs: Number(sqlite.pragma('busy_timeout', { simple: true })),
    foreignKeys: Number(sqlite.pragma('foreign_keys', { simple: true })) === 1,
  };
}

/**
 * Readability probe for `GET /readyz`. Queries a real table rather than
 * `SELECT 1`, so it proves the schema was initialized too — a connection that
 * opens against an empty file is not a database this app can serve from.
 */
export function pingDatabase(): { ok: boolean; error?: string } {
  try {
    sqlite.prepare('SELECT COUNT(*) AS n FROM kb_documents').get();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'unknown database error' };
  }
}

/**
 * Closes the handle so WAL contents are checkpointed back into the main database
 * file. Called from the shutdown path in server.ts — an abrupt `process.exit()`
 * leaves `db.sqlite-wal` on disk, which recovers on next open but means the file
 * an operator copies for a backup is not the whole database.
 */
export function closeDatabase(): void {
  try {
    sqlite.close();
  } catch (err) {
    logger.error({ err }, 'Failed to close the SQLite handle cleanly');
  }
}

/**
 * Brings the database up to the schema the code expects, by applying every
 * pending file in src/db/migrations.
 *
 * This used to be ~200 lines of `CREATE TABLE IF NOT EXISTS` followed by a
 * hand-maintained list of `ALTER TABLE ... ADD COLUMN` wrapped in empty catch
 * blocks, with a comment instructing the next developer to append a line for
 * every new column. That worked exactly once per column and only forwards: it
 * could add a column but never rename, drop, re-type or backfill one, it left no
 * record of what had been applied to a given database, and a forgotten line
 * surfaced as "no such column" at the first read rather than at startup.
 *
 * Now: `npm run db:generate` diffs src/db/schema.ts against the recorded snapshot
 * and writes a reviewable .sql file; this applies whatever has not run yet and
 * records it in __drizzle_migrations. Dev, test and production take the same
 * path, so the schema a test runs against is the schema a deployment gets.
 * See docs/DATABASE.md.
 */
export function initDatabase() {
  const before = appliedMigrationCount();
  try {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } catch (err) {
    // The migrator wraps the whole run in one transaction and rolls back, so the
    // database is untouched — but the process must not continue serving as if the
    // schema were current.
    logger.fatal({ err, migrationsFolder: MIGRATIONS_DIR }, 'Database migration failed — refusing to serve on an unknown schema');
    throw err;
  }
  const after = appliedMigrationCount();

  // Legacy column reconciliation. FROZEN — do not add to this list.
  //
  // Databases created before migrations existed have the nine tables but may lack
  // columns that the old ALTER-on-startup mechanism used to add, and the baseline
  // migration's IF NOT EXISTS deliberately skips existing tables rather than
  // rebuilding them — so those columns would stay missing. New databases get every
  // column from the baseline and these all no-op. Any column added from here on
  // comes from a generated migration; this block exists only to carry
  // pre-migration databases across, and can be deleted once none remain.
  for (const stmt of LEGACY_COLUMN_BACKFILL) {
    try { sqlite.exec(stmt); } catch { /* column already present — expected */ }
  }

  logger.info(
    { ...databaseSettings(), migrationsApplied: after - before, migrationsTotal: after },
    'Database schema up to date',
  );
}

/**
 * Columns the pre-migration startup routine added by hand. See initDatabase():
 * this list is closed.
 */
const LEGACY_COLUMN_BACKFILL = [
  'ALTER TABLE kb_documents ADD COLUMN department_scope TEXT;',
  'ALTER TABLE kb_documents ADD COLUMN department_ids TEXT;',
  'ALTER TABLE kb_documents ADD COLUMN owner_id TEXT;',
  'ALTER TABLE kb_documents ADD COLUMN processing_report TEXT;',
  'ALTER TABLE kb_document_chunks ADD COLUMN document_id TEXT;',
];

/** How many migrations this database has recorded. 0 before the first run. */
function appliedMigrationCount(): number {
  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0; // the table does not exist yet
  }
}

/**
 * Migration history: what the journal on disk declares versus what this database
 * has recorded. Reported by `GET /readyz` — a deployment running behind its own
 * migrations is a condition an operator must be able to see, not infer from a
 * "no such column" error later.
 */
export function migrationStatus(): { applied: number; pending: number; upToDate: boolean } {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  let onDisk = 0;
  try {
    onDisk = (JSON.parse(fs.readFileSync(journalPath, 'utf8')).entries ?? []).length;
  } catch (err) {
    logger.error({ err, journalPath }, 'Could not read the migration journal');
  }
  const applied = appliedMigrationCount();
  return { applied, pending: Math.max(0, onDisk - applied), upToDate: onDisk > 0 && applied >= onDisk };
}
