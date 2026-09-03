// Scheduled backup for the `backup` service in docker-compose.yml.
//
// SPDX-License-Identifier: Apache-2.0
//
// Runs the same approach deploy/README.md documents for a human to type by hand:
// better-sqlite3's own online .backup() against DATABASE_PATH, which is safe
// against a live, concurrently-written database (unlike copying the file, which
// can capture a half-written WAL). This script does that on an interval, keeps a
// bounded number of copies, and — only if configured — pushes each one off-host.
//
// It runs as the `backup` service using the EKOS application image itself, not a
// separate one: that image already carries a better-sqlite3 build compiled
// against the exact Node ABI the database was written with, and a second
// toolchain here would just be a second thing that can drift from it.
//
// ===========================================================================
// WHAT THIS DOES NOT DO UNLESS BACKUP_OFFHOST_URL IS SET
//
// `ekos-backups` (docker-compose.yml) is a second named volume on the SAME host
// as `ekos-data`. A copy on a second volume on the same VM is not an off-host
// backup — it shares that VM's disk, datacenter, and account, and a host loss
// takes both volumes with it. BACKUP_OFFHOST_URL is the only thing in this file
// that changes that, and it is unset by default. With it unset, this service
// produces real, scheduled, retained backups that still share the host's fate —
// and every cycle logs that fact explicitly, rather than a procedure that reads
// like a control while quietly not being one.
//
// BACKUP_OFFHOST_URL, when set, must be a URL this process can HTTP PUT to: an
// S3-compatible presigned URL, an Azure Blob SAS URL, a GCS signed URL, or a
// receiver you run yourself. Node 22's built-in fetch does the PUT — no SDK, no
// cloud CLI baked into the image.
//
// ===========================================================================
// .env AND ENCRYPTION_SECRET ARE PART OF THIS BACKUP, AND THIS SCRIPT DOES NOT
// TOUCH THEM
//
// This container does not have `.env` mounted and backs up the SQLite file only.
// Provider API keys are stored encrypted with ENCRYPTION_SECRET (src/server/
// crypto.ts); without the matching secret, the keys in a restored database are
// undecryptable ciphertext, not merely inaccessible. The secret and the database
// are one backup unit — back up `.env` (or at minimum ENCRYPTION_SECRET)
// yourself, separately, and keep the two together wherever they end up. See
// deploy/README.md.
// ===========================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

const DATABASE_PATH = process.env.DATABASE_PATH || '/data/ekos.sqlite';
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const INTERVAL_SECONDS = Number(process.env.BACKUP_INTERVAL_SECONDS) || 21600; // 6h
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT) || 28; // ~1 week at 6h
const OFFHOST_URL = String(process.env.BACKUP_OFFHOST_URL || '').trim();
// Where the heartbeat lands. Defaults to a file inside BACKUP_DIR, i.e. on the
// ekos-backups volume — the one volume this service and the ekos service both
// have mounted (docker-compose.yml mounts it read-only into ekos), which is why
// this works with no Prometheus/collector dependency: the ekos process reads
// this file directly and reports its age as a gauge (src/server/metrics.ts),
// so the signal exists even when the `observability` profile never starts.
const HEARTBEAT_PATH = process.env.BACKUP_HEARTBEAT_PATH || path.join(BACKUP_DIR, '.heartbeat');
// A hung upload endpoint must not park the cycle forever. Without a bound the
// service sits in an unresolved fetch, never logs again and never reaches its
// next interval — which from outside is indistinguishable from a crash.
const OFFHOST_TIMEOUT_MS = Number(process.env.BACKUP_OFFHOST_TIMEOUT_MS) || 120000;

function log(record) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'backup', ...record }));
}

// Shutdown coordination, read by the SIGTERM handler at the bottom of the file.
let stopping = false;
let inFlight = null;
let sleepTimer = null;

// Has the application initialized the schema yet?
//
// The backup and ekos services share the ekos-data volume and start together.
// The ekos process CREATES the sqlite file the moment its db module loads
// (`new Database(path)`), and only AFTER that runs migrations and seeds. So there
// is a window — a few hundred ms on first boot — where the file exists but holds
// no tables. A readonly backup taken in that window is a structurally-valid,
// quick_check-passing, completely empty database. It gzips, it verifies, and it
// stamps the heartbeat — a backup that says "you are protected" while containing
// nothing, and the first anyone learns of it is an empty restore.
//
// The honest readiness signal is drizzle's own migration ledger: if
// `__drizzle_migrations` exists and has at least one row, initDatabase() has run
// and every table (kb_documents included) is present. An empty-but-migrated
// database is NOT skipped — zero documents is a legitimate state a real
// deployment can be in, and refusing to back it up would lose later edits made
// before the first document is added.
function schemaIsReady(db) {
  try {
    const applied = db
      .prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations")
      .get();
    return (applied?.n ?? 0) > 0;
  } catch {
    // The table does not exist yet — migrations have not run.
    return false;
  }
}

async function runOnce() {
  if (!fs.existsSync(DATABASE_PATH)) {
    // Not an error: a fresh deployment's database may not exist yet on the very
    // first cycle. Silently doing nothing would be worse than saying so.
    log({ msg: 'database file does not exist yet, skipping this cycle', path: DATABASE_PATH });
    return 'skipped';
  }

  // The file can exist before the app has migrated it — see schemaIsReady. Check
  // in its own short-lived connection so the readiness probe never holds a handle
  // into the backup itself.
  {
    const probe = new Database(DATABASE_PATH, { readonly: true });
    try {
      if (!schemaIsReady(probe)) {
        log({ msg: 'database schema not initialized yet, skipping this cycle', path: DATABASE_PATH });
        return 'skipped';
      }
    } finally {
      probe.close();
    }
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawPath = path.join(BACKUP_DIR, `ekos-${stamp}.sqlite`);
  const gzPath = `${rawPath}.gz`;

  // Everything from here is wrapped so a failure cannot leave the volume worse
  // than it found it. The obvious trigger is a full disk, and the first version
  // of this file made that a spiral: the uncompressed snapshot is written before
  // it is gzipped, so a gzip failure left a file the size of the whole database
  // behind AND skipped pruning, because both the unlink and the prune sat on the
  // success path. Each failed cycle then consumed more of the space whose absence
  // caused the failure.
  // Tracked explicitly rather than inferred from the file's presence or size: a
  // gzip that dies partway leaves a non-empty but truncated archive, and judging
  // "did this work" by size would keep it and let retention count it as a backup.
  let completed = false;

  try {
    const db = new Database(DATABASE_PATH, { readonly: true });
    try {
      await db.backup(rawPath);
    } finally {
      db.close();
    }

    // Verify before claiming success. A copy that cannot be opened is not a
    // backup, and finding that out during a restore is finding out too late.
    // quick_check rather than integrity_check: it catches structural damage
    // without the full-table scan, which matters when this runs on a schedule.
    const verify = new Database(rawPath, { readonly: true });
    try {
      const result = verify.pragma('quick_check', { simple: true });
      if (result !== 'ok') throw new Error(`quick_check failed: ${result}`);
    } finally {
      verify.close();
    }

    await new Promise((resolve, reject) => {
      const gzip = zlib.createGzip();
      const src = fs.createReadStream(rawPath);
      const dst = fs.createWriteStream(gzPath);
      src.pipe(gzip).pipe(dst);
      dst.on('finish', resolve);
      // All three streams, not just the two ends: an unhandled 'error' on the gzip
      // stream is thrown rather than rejected, which would take the container down
      // instead of failing one cycle and retrying at the next interval.
      dst.on('error', reject);
      gzip.on('error', reject);
      src.on('error', reject);
    });

    const { size } = fs.statSync(gzPath);
    completed = true;
    log({ msg: 'backup written', file: gzPath, bytes: size, onHostOnly: !OFFHOST_URL });

    // The heartbeat is stamped here — once a gzipped, quick_check-verified copy
    // exists on disk — not after the off-host upload below. A failed upload
    // degrades where the backup lives, not whether one was taken; conflating the
    // two would either mask a real backup failure behind a flaky upload endpoint,
    // or (worse) suppress the age alert while genuinely producing no protected
    // copy, depending on which way the conflation went.
    writeHeartbeat();

    if (OFFHOST_URL) {
      try {
        const body = fs.readFileSync(gzPath);
        // A hung endpoint must not stall the cycle forever — without this the
        // service would sit in an unresolved fetch and never reach its next
        // interval, which reads from outside exactly like a crash.
        const res = await fetch(OFFHOST_URL, {
          method: 'PUT',
          body,
          signal: AbortSignal.timeout(OFFHOST_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        log({ msg: 'backup uploaded off-host', file: gzPath });
      } catch (err) {
        // The local, on-host copy still exists — a failed upload degrades this run,
        // it does not lose the backup. But until an upload succeeds, this backup's
        // only copy is on the same host as the database, exactly as if
        // BACKUP_OFFHOST_URL had never been set.
        log({ msg: 'off-host upload failed, local copy retained', error: String(err) });
      }
    } else {
      log({
        msg: 'BACKUP_OFFHOST_URL is not set — this backup is on the same host as the ' +
          'database it protects, which is not an off-host backup',
      });
    }
    return 'ok';
  } finally {
    // Both of these run whether the cycle succeeded or threw. The raw snapshot is
    // an intermediate that should never outlive its cycle, and pruning is the only
    // thing that reclaims space — skipping it on failure is precisely backwards.
    safeUnlink(rawPath);
    if (!completed) safeUnlink(gzPath);
    pruneOldBackups();
  }
}

// Stamps the epoch-seconds of the last verified backup into HEARTBEAT_PATH.
// Written as text, not inferred from the heartbeat file's own mtime: a clock
// that is merely fast or slow relative to the reader would otherwise show up as
// a false "backup is stale" or a false "backup is fresh", and the age this
// produces is only ever compared against `time()` from the SAME container that
// reads it (src/server/metrics.ts) if we stamp the value ourselves.
//
// Written via a temp file + rename, not a direct write: metrics.ts can read
// this file at any moment from a different container, and a reader landing
// mid-write would see a truncated or half-written number. rename() on the same
// filesystem is atomic; the reader never observes an intermediate state.
//
// Must not throw: a failed heartbeat write is itself the exact silent failure
// this mechanism exists to catch, so it is logged loudly rather than allowed to
// take down a cycle that otherwise produced a good backup.
function writeHeartbeat() {
  try {
    const tmp = `${HEARTBEAT_PATH}.tmp`;
    fs.writeFileSync(tmp, String(Math.floor(Date.now() / 1000)));
    fs.renameSync(tmp, HEARTBEAT_PATH);
  } catch (err) {
    log({ msg: 'could not write backup heartbeat — age-based alerting will not see this cycle', file: HEARTBEAT_PATH, error: String(err) });
  }
}

function safeUnlink(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    // Cleanup failing must not mask the original error that got us here.
    log({ msg: 'could not remove intermediate file', file, error: String(err) });
  }
}

// Called from a `finally`, so it must not throw: an exception raised in here
// would replace whatever error brought us into the cleanup path, and the log
// would blame the wrong thing.
function pruneOldBackups() {
  try {
    const entries = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('ekos-') && f.endsWith('.sqlite.gz'))
      .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const { f } of entries.slice(RETENTION_COUNT)) {
      safeUnlink(path.join(BACKUP_DIR, f));
      log({ msg: 'pruned old backup', file: f });
    }
  } catch (err) {
    log({ msg: 'could not prune old backups', error: String(err) });
  }
}

async function main() {
  log({
    msg: 'backup service starting',
    intervalSeconds: INTERVAL_SECONDS,
    retentionCount: RETENTION_COUNT,
    offHostConfigured: Boolean(OFFHOST_URL),
  });

  // A cycle that SKIPPED (file or schema not ready yet) must not then wait a full
  // INTERVAL_SECONDS — at the 6h production interval that would leave a fresh
  // deployment unprotected for hours over a race that resolves in milliseconds.
  // It retries on a short backoff until the first real backup lands, then settles
  // into the configured interval. Capped at the interval so a sub-interval
  // deployment (the CI stack runs at 15s) never waits longer than its own cadence.
  const SKIP_RETRY_SECONDS = Math.min(INTERVAL_SECONDS, 5);

  // Run once at startup — a fresh deployment gets a backup within minutes rather
  // than waiting a full INTERVAL_SECONDS for the first one.
  while (!stopping) {
    let outcome = 'ok';
    try {
      inFlight = runOnce();
      outcome = await inFlight;
    } catch (err) {
      log({ msg: 'backup cycle failed', error: String(err) });
    } finally {
      inFlight = null;
    }
    if (stopping) break;
    // Interruptible sleep: a SIGTERM during the idle window should not wait out
    // the remaining hours of the interval before the container exits.
    const delaySeconds = outcome === 'skipped' ? SKIP_RETRY_SECONDS : INTERVAL_SECONDS;
    await new Promise((resolve) => {
      sleepTimer = setTimeout(resolve, delaySeconds * 1000);
    });
  }
  log({ msg: 'backup service stopped' });
  process.exit(0);
}

// A cycle interrupted mid-write leaves a partial file behind, and the previous
// handler called process.exit immediately, so a redeploy during a backup did
// exactly that. Now the signal stops the loop and lets the current cycle reach
// its own cleanup — the `finally` in runOnce is what removes the intermediate.
process.on('SIGTERM', () => {
  log({ msg: 'backup service stopping', waitingForCycle: Boolean(inFlight) });
  stopping = true;
  if (sleepTimer) clearTimeout(sleepTimer);
  if (!inFlight) process.exit(0);
});

main();
