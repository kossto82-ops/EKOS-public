import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { resolveDatabasePath } from '../src/db/db.ts';
import { shouldIgnoreRequest, telemetryConfig } from '../src/server/otel.ts';
import { normalizeUsage, readHeartbeat } from '../src/server/metrics.ts';
import os from 'os';
import { createShutdownHandler } from '../src/server/shutdown.ts';

/**
 * Deployment and telemetry.
 *
 * Two kinds of assertion live here, for two different failure modes.
 *
 * The first is ordinary unit testing of the decisions that are made once at
 * startup and are then invisible: where the database file is, whether telemetry is
 * on. Both used to be unconditional — a hardcoded relative path, and no telemetry
 * at all — so neither had anything to test.
 *
 * The second is a **drift guard over the deployment manifests**, in the same
 * spirit as tests/docsDrift.test.ts. The Dockerfile and docker-compose.yml encode
 * a handful of properties that are load-bearing and silently breakable: the
 * database must not live on the container's writable layer, there must be exactly
 * one replica, the OpenTelemetry preload must stay on the command line. Every one
 * of those fails quietly if removed — an empty knowledge base after a redeploy, a
 * corrupted SQLite file, a process with no instrumentation — so they are asserted
 * rather than left to review. None of this proves the image *builds*; that is what
 * the `image` job in CI is for.
 */

const REPO = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('resolveDatabasePath (src/db/db.ts)', () => {
  it('uses an in-memory database under test, whatever DATABASE_PATH says', () => {
    // The test suite must never be one typo away from writing to a real database.
    expect(resolveDatabasePath({ NODE_ENV: 'test', DATABASE_PATH: '/tmp/should-be-ignored.sqlite' } as any))
      .toBe(':memory:');
  });

  it('falls back to the repo-root file when DATABASE_PATH is unset', () => {
    // The pre-existing behaviour. Local development and the ingest scripts depend
    // on it, so making the path configurable must not have changed the default.
    expect(resolveDatabasePath({ NODE_ENV: 'production' } as any))
      .toBe(path.join(process.cwd(), 'db.sqlite'));
  });

  it('honours DATABASE_PATH and resolves it to an absolute path', () => {
    const resolved = resolveDatabasePath({ NODE_ENV: 'production', DATABASE_PATH: '/data/ekos.sqlite' } as any);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.replace(/\\/g, '/')).toContain('/data/ekos.sqlite');
  });

  it('ignores a blank DATABASE_PATH rather than opening a file called ""', () => {
    // An unset variable in a compose file arrives as the empty string, not as
    // undefined. Treating that as "configured" would resolve to the process cwd —
    // a directory — and fail with an opaque SQLITE_CANTOPEN.
    expect(resolveDatabasePath({ NODE_ENV: 'production', DATABASE_PATH: '   ' } as any))
      .toBe(path.join(process.cwd(), 'db.sqlite'));
  });
});

describe('telemetryConfig (src/server/otel.ts)', () => {
  it('is off when no collector endpoint is configured', () => {
    const cfg = telemetryConfig({ NODE_ENV: 'production' } as any);
    expect(cfg.enabled).toBe(false);
    expect(cfg.reason).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it('is off under test even with an endpoint set', () => {
    // A test run must not open exporter sockets or start background timers.
    const cfg = telemetryConfig({ NODE_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' } as any);
    expect(cfg.enabled).toBe(false);
  });

  it('can be switched off explicitly even when configured', () => {
    const cfg = telemetryConfig({
      NODE_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_SDK_DISABLED: 'true',
    } as any);
    expect(cfg.enabled).toBe(false);
    expect(cfg.reason).toMatch(/OTEL_SDK_DISABLED/);
  });

  it('is on, named and versioned when an endpoint is set', () => {
    const cfg = telemetryConfig({
      NODE_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      EKOS_VERSION: 'abc123',
    } as any);
    expect(cfg).toMatchObject({
      enabled: true,
      endpoint: 'http://collector:4318',
      serviceName: 'ekos-api',
      serviceVersion: 'abc123',
      environment: 'production',
    });
  });
});

describe('shouldIgnoreRequest (src/server/otel.ts)', () => {
  it('drops the probes, which are most of the traffic and none of the signal', () => {
    expect(shouldIgnoreRequest('/healthz')).toBe(true);
    expect(shouldIgnoreRequest('/readyz')).toBe(true);
    expect(shouldIgnoreRequest('/readyz?verbose=1')).toBe(true);
  });

  it("drops Vite's development module requests", () => {
    expect(shouldIgnoreRequest('/@vite/client')).toBe(true);
    expect(shouldIgnoreRequest('/src/App.tsx')).toBe(true);
    expect(shouldIgnoreRequest('/node_modules/.vite/deps/react.js')).toBe(true);
  });

  it('keeps every API request', () => {
    expect(shouldIgnoreRequest('/api/search')).toBe(false);
    expect(shouldIgnoreRequest('/api/kb-chat')).toBe(false);
    // Not a probe: a real endpoint whose name merely starts the same way.
    expect(shouldIgnoreRequest('/api/health-report')).toBe(false);
  });
});

describe('readHeartbeat (src/server/metrics.ts)', () => {
  // The alert that catches "backups stopped happening" is built on this reading.
  // What matters is the difference between no observation and a wrong one: a
  // missing or unreadable heartbeat must leave a gap in the series, because a
  // zero would be interpreted as "last succeeded in 1970" — which happens to
  // fire the same alert, but for the wrong reason and in every deployment that
  // never configured a backup at all.
  const tmp = (contents: string) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ekos-hb-')), 'heartbeat');
    fs.writeFileSync(file, contents);
    return file;
  };

  it('reads the epoch seconds a backup cycle stamped', () => {
    expect(readHeartbeat(tmp('1770000000'))).toBe(1770000000);
  });

  it('tolerates the trailing newline a shell redirect would leave', () => {
    expect(readHeartbeat(tmp('1770000000\n'))).toBe(1770000000);
  });

  it('throws rather than returning zero when the file is missing', () => {
    // No backup service running, or the volume was not mounted into this
    // container. Both must read as "no data", never as a 1970 timestamp.
    expect(() => readHeartbeat(path.join(os.tmpdir(), 'ekos-hb-does-not-exist', 'heartbeat'))).toThrow();
  });

  it('throws rather than returning zero when the file is corrupt', () => {
    // A half-written file, or something else writing to that path.
    expect(() => readHeartbeat(tmp('not-a-timestamp'))).toThrow(/did not contain a number/);
    expect(() => readHeartbeat(tmp(''))).toThrow(/did not contain a number/);
  });
});

describe('normalizeUsage (src/server/metrics.ts)', () => {
  it('reads Gemini usage', () => {
    expect(normalizeUsage('gemini', { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } }))
      .toEqual({ input: 120, output: 40 });
  });

  it('reads Anthropic usage', () => {
    expect(normalizeUsage('anthropic', { usage: { input_tokens: 12, output_tokens: 3 } }))
      .toEqual({ input: 12, output: 3 });
  });

  it('reads the OpenAI-compatible shape for openai, groq and custom endpoints', () => {
    const payload = { usage: { prompt_tokens: 7, completion_tokens: 9 } };
    for (const provider of ['openai', 'groq', 'custom']) {
      expect(normalizeUsage(provider, payload)).toEqual({ input: 7, output: 9 });
    }
  });

  it('reports nothing rather than zero when a provider omits usage', () => {
    // A false zero would drag the token counter's totals down and make an absent
    // measurement indistinguishable from a free call.
    expect(normalizeUsage('openai', { choices: [] })).toEqual({ input: undefined, output: undefined });
    expect(normalizeUsage('gemini', null)).toEqual({});
  });
});

describe('createShutdownHandler — telemetry flush', () => {
  it('flushes telemetry after closing the database, and only then exits', async () => {
    const order: string[] = [];
    const exit = vi.fn(() => { order.push('exit'); });

    const shutdown = createShutdownHandler({
      closeServer: (done) => { order.push('closeServer'); done(); },
      closeDatabase: () => { order.push('closeDatabase'); },
      flushTelemetry: async () => { order.push('flushTelemetry'); },
      exit,
    });

    shutdown('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    // The order is the point: the flush has to be last, because the batch it
    // pushes contains the shutdown's own log lines.
    expect(order).toEqual(['closeServer', 'closeDatabase', 'flushTelemetry', 'exit']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits anyway when the flush hangs', async () => {
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      closeServer: (done) => done(),
      closeDatabase: () => {},
      // An unreachable collector. The process must still exit.
      flushTelemetry: () => new Promise(() => {}),
      exit,
      flushMs: 20,
    });

    shutdown('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it('exits normally when no flush is configured at all', async () => {
    // Telemetry is optional; the shutdown sequence must not depend on it.
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      closeServer: (done) => done(),
      closeDatabase: () => {},
      exit,
    });
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});

describe('deployment manifests', () => {
  const dockerfile = read('Dockerfile');
  const compose = YAML.parse(read('deploy/docker-compose.yml'));

  it('keeps the OpenTelemetry preload on the container command', () => {
    // The instrumentations patch modules as they load. Drop this flag and express,
    // http and better-sqlite3 are all required before the SDK exists — the process
    // starts fine, serves fine, and emits nothing for the rest of its life.
    expect(dockerfile).toMatch(/CMD \["node", "--require", "\.\/dist\/otel\.cjs", "dist\/server\.cjs"\]/);
    expect(JSON.parse(read('package.json')).scripts.start).toContain('--require ./dist/otel.cjs');
  });

  it('puts the database on the mounted volume, not the container layer', () => {
    // Without this the database is destroyed on every redeploy — and nothing
    // errors, because the schema self-bootstraps and seeding runs. The service
    // comes up healthy and empty.
    expect(dockerfile).toMatch(/ENV DATABASE_PATH=\/data\//);
    expect(dockerfile).toMatch(/VOLUME \["\/data"\]/);
    expect(compose.services.ekos.volumes).toContain('ekos-data:/data');
    expect(compose.volumes).toHaveProperty('ekos-data');
  });

  it('keeps xlsx on the SheetJS distribution, not the abandoned npm release', () => {
    // `npm install xlsx` gives you 0.18.5 and always will: SheetJS stopped
    // publishing to npm after it, so that version is permanently unpatched
    // against CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS) —
    // `npm audit` says "No fix available" and means it. This app parses
    // user-uploaded spreadsheets (src/utils/extractFileText.ts), which is exactly
    // the input those advisories describe.
    //
    // The fixed releases exist only on SheetJS's own CDN, which is why this one
    // dependency is a URL. The cost is that `npm ci` must reach cdn.sheetjs.com —
    // written down in docs/README.md rather than discovered in a broken build.
    //
    // Asserted because the regression is a single innocent-looking command:
    // anyone running `npm install xlsx` silently reverts to the vulnerable
    // release, and nothing else in the repository would notice.
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies.xlsx, 'xlsx must come from the SheetJS CDN').toMatch(/^https:\/\/cdn\.sheetjs\.com\//);
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.packages['node_modules/xlsx'].resolved).toMatch(/^https:\/\/cdn\.sheetjs\.com\//);
  });

  it('keeps the build toolchain out of the production dependency tree', () => {
    // `npm ci --omit=dev` decides what lands in the image, so anything in
    // `dependencies` ships whether the container runs it or not. Vite, its React
    // plugin and its Tailwind plugin were all runtime dependencies while being
    // used only by vite.config.ts and by the development-only middleware — and
    // they dragged esbuild in with them. The first completed Trivy scan charged
    // 30 CVEs (2 CRITICAL) to two esbuild binaries the container never executes,
    // plus postcss, picomatch and the rest of that tree.
    const pkg = JSON.parse(read('package.json'));
    for (const buildOnly of ['vite', '@vitejs/plugin-react', '@tailwindcss/vite', 'esbuild', 'typescript']) {
      expect(
        pkg.dependencies,
        `${buildOnly} is a runtime dependency — it will be installed into the image`,
      ).not.toHaveProperty(buildOnly);
    }
  });

  it('never imports vite on the production path', () => {
    // The other half of the same rule, and the half a package.json cannot express:
    // esbuild bundles server.ts with --packages=external, so a top-level
    // `import ... from "vite"` survives as a real require() in dist/server.cjs and
    // is resolved at startup — in production too, where the branch that uses it
    // never runs. It has to be a dynamic import inside the development branch.
    const server = read('server.ts');
    expect(server, 'vite must not be imported at the top level of server.ts').not.toMatch(/^import .*from ["']vite["']/m);
    expect(server, 'vite is still needed for the dev middleware — dynamically').toMatch(/await import\(["']vite["']\)/);
  });

  it('applies Debian security upgrades in the stage that actually ships', () => {
    // The first completed Trivy scan found 11 fixable CVEs — 2 CRITICAL — every
    // one a base-image Debian package whose patched version was already in the
    // archive (libgnutls30 deb12u5 against a fixed deb12u7, gpgv, libcap2).
    // Nothing from this repository's own dependencies.
    //
    // The published node:X-bookworm-slim images are not rebuilt on Debian's
    // security cadence, so bumping NODE_VERSION closes it today and reopens it in
    // a few weeks. This upgrade is what keeps the scan gate passable on its own
    // terms — and it is one line, easy to drop in a refactor, invisible until the
    // next scan.
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('AS runtime'));
    expect(runtimeStage, 'the runtime stage must apply security upgrades').toMatch(/apt-get upgrade -y/);
  });

  it('ships the migration files, which the server bundle cannot embed', () => {
    expect(dockerfile).toMatch(/COPY --from=build \/app\/src\/db\/migrations \.\/migrations/);
    expect(dockerfile).toMatch(/ENV DRIZZLE_MIGRATIONS_DIR=\/app\/migrations/);
  });

  it('pins the app to a single replica', () => {
    // SQLite coordinates with per-host advisory locks. Two containers on one
    // volume interleave writes and corrupt the file rather than queueing.
    expect(compose.services.ekos.deploy.replicas).toBe(1);
  });

  it('allows the shutdown sequence to finish before the container is killed', () => {
    // 10s connection drain + 2s telemetry flush (src/server/shutdown.ts). A grace
    // period shorter than that turns every redeploy into a SIGKILL, which skips
    // closing the SQLite handle and leaves the WAL unmerged.
    const grace = String(compose.services.ekos.stop_grace_period);
    expect(Number(grace.replace(/[^0-9]/g, ''))).toBeGreaterThanOrEqual(15);
  });

  it('runs as a non-root user', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it('never bakes the working database or the secrets file into the image', () => {
    // src/data/ holds real internal corporate content and .env holds live provider
    // keys. An image layer is readable by anyone who can pull the image.
    const ignore = read('.dockerignore');
    for (const entry of ['db.sqlite', '.env', 'node_modules/']) {
      expect(ignore.split('\n').map(l => l.trim())).toContain(entry);
    }
  });

  it('builds the image on the same Node major that CI tests against', () => {
    // better-sqlite3 is a native addon compiled against a specific V8 ABI. A gate
    // that passes on one Node major proves nothing about an image built on another.
    const dockerNode = dockerfile.match(/ARG NODE_VERSION=(\d+)/)?.[1];
    const ci = YAML.parse(read('.github/workflows/ci.yml'));
    const ciNode = String(
      ci.jobs['quality-gate'].steps.find((s: any) => s.uses?.startsWith('actions/setup-node'))?.with['node-version'],
    );
    expect(dockerNode).toBe(ciNode);
  });

  it('publishes an immutable tag, not only a moving one', () => {
    // "What is actually running?" has to be answerable during an incident, and
    // `latest` cannot answer it.
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/type=sha,format=long/);
  });

  it('loads the built image into the local daemon so the smoke test can start it', () => {
    // setup-buildx-action installs the docker-container driver, whose output stays
    // in the build cache. Without `load: true` the image exists nowhere `docker run`
    // can see it, and the smoke test fails on every run that does not publish --
    // which is every pull request, the exact case the job was built to cover.
    const ci = YAML.parse(read('.github/workflows/ci.yml'));
    const build = ci.jobs.image.steps.find(
      (s: any) => s.uses?.startsWith('docker/build-push-action') && s.with?.push !== true,
    );
    expect(build?.with?.load).toBe(true);
  });

  it('smoke-tests the image before publishing it, not after', () => {
    // A sha- tag on GHCR is something a human may deploy. An image that cannot
    // start must never acquire one.
    const steps = YAML.parse(read('.github/workflows/ci.yml')).jobs.image.steps;
    const smoke = steps.findIndex((s: any) => /smoke-test/i.test(s.name ?? ''));
    const publish = steps.findIndex(
      (s: any) => s.uses?.startsWith('docker/build-push-action') && s.with?.push === true,
    );
    expect(smoke).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(smoke);
  });

  it('exercises docker compose in CI, not only a bare `docker run`', () => {
    // Before this, `backup`, `alert-sink`, `alertmanager`, `prometheus`, the named
    // volumes and container-to-container DNS had never been started anywhere —
    // the smoke test only ever ran `docker run` against the bare `ekos` image.
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/docker compose --profile observability up -d/);
    // It has to actually wait for a cycle and check the artifact, not merely
    // start the stack and assume it worked.
    expect(ci).toMatch(/\*\.sqlite\.gz/);
    expect(ci).toMatch(/\.heartbeat/);
  });

  it('proves a backup can be restored, in CI, not just written', () => {
    // A backup nobody has restored is a hypothesis. This has to open the
    // gzipped archive back up with the same better-sqlite3 build the image
    // ships and check for a real table, not merely that gunzip exited 0.
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/gunzip -c/);
    expect(ci).toMatch(/better-sqlite3/);
    expect(ci).toMatch(/kb_documents/);
  });

  it('checks alertmanager and alert-sink actually came up under the compose stack', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/alertmanager:9093|127\.0\.0\.1:9093\/-\/ready/);
    expect(ci).toMatch(/alert-sink/);
  });

  it('bounds the compose integration step so it cannot become the flaky ten-minute job', () => {
    const ci = YAML.parse(read('.github/workflows/ci.yml'));
    const step = ci.jobs.image.steps.find((s: any) => /compose stack integration/i.test(s.name ?? ''));
    expect(step, 'no compose integration step found').toBeTruthy();
    expect(step['timeout-minutes']).toBeGreaterThan(0);
    expect(step['timeout-minutes']).toBeLessThanOrEqual(10);
  });

  it('scans the published image for vulnerabilities and blocks on fixable High/Critical findings', () => {
    // Reporting-only would let a known-exploitable image reach GHCR under a
    // sha- tag someone might deploy — the same argument the smoke test already
    // makes for "must start". `ignore-unfixed` is required, not optional: without
    // it this gate can fail on an OS-level CVE with no available patch, on a
    // schedule this repository does not control, which is the "gate everyone
    // learns to route around" failure mode.
    const ci = YAML.parse(read('.github/workflows/ci.yml'));
    const scan = ci.jobs.image.steps.find((s: any) => String(s.uses ?? '').startsWith('aquasecurity/trivy-action'));
    expect(scan, 'no Trivy (or equivalent) scan step found in the image job').toBeTruthy();
    expect(String(scan.with.severity)).toMatch(/CRITICAL/);
    expect(String(scan.with.severity)).toMatch(/HIGH/);
    expect(String(scan.with['exit-code'])).not.toBe('0');
    expect(scan.with['ignore-unfixed']).toBe(true);

    // Must run before publish, or a High/Critical finding cannot actually block it.
    const steps = ci.jobs.image.steps;
    const scanIndex = steps.findIndex((s: any) => String(s.uses ?? '').startsWith('aquasecurity/trivy-action'));
    const publishIndex = steps.findIndex(
      (s: any) => s.uses?.startsWith('docker/build-push-action') && s.with?.push === true,
    );
    expect(scanIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(scanIndex);
  });

  it('pins every third-party action to a tag that still resolves', () => {
    // CI was red on every run for days over this, and the failure told you
    // nothing about the code: the Trivy scan was pinned to `@0.28.0`, the action
    // now publishes immutable `vX.Y.Z` tags only, and the unprefixed tag stopped
    // resolving. The image job died in 3 seconds — before checkout — so the log
    // showed no failing step at all, just a red run.
    //
    // A test cannot reach GitHub to ask which tags exist. What it CAN do is
    // forbid the shape that broke: a version reference must carry the `v`, or be
    // a full commit sha. That is the difference between the two forms here.
    const ci = read('.github/workflows/ci.yml');
    const refs = [...ci.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) {
      const [action, version] = ref.split('@');
      expect(version, `${action} is not pinned to any version`).toBeTruthy();
      expect(
        /^(v\d+(\.\d+)*|[0-9a-f]{40})$/.test(version),
        `${ref} — pin to a v-prefixed tag or a full commit sha; a bare "${version}" is the form that stopped resolving`,
      ).toBe(true);
    }
  });

  it('gates publishing on the repository default branch, not a hardcoded ref', () => {
    // The workflow triggers on both main and master. A literal refs/heads/main
    // comparison passes review and then quietly never fires on the other one.
    const image = YAML.parse(read('.github/workflows/ci.yml')).jobs.image;
    expect(image.env.PUBLISH).toContain('github.event.repository.default_branch');
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/refs\/heads\/main/);
  });

  it('runs a scheduled backup against the same volume the app writes', () => {
    // The single copy of the corpus lives on ekos-data, so a backup sidecar has to
    // read that volume and write its output somewhere else.
    const backupVolumes: string[] = compose.services.backup?.volumes ?? [];
    expect(backupVolumes).toContain('ekos-data:/data');
    expect(backupVolumes).toContain('ekos-backups:/backups');
    expect(compose.volumes).toHaveProperty('ekos-backups');
  });

  it('runs the backup script somewhere it can both resolve and parse', () => {
    // Two crashes, in sequence, from the same one-line decision — where the script
    // lives and what it is called. Both left the container in a restart loop and
    // the CI wait timing out on a snapshot, which points nowhere near either cause.
    //
    // 1. At /deploy/backup.js: Node resolves require() by walking up from the
    //    FILE's directory, never from the working directory, so it searched
    //    /deploy/node_modules and /node_modules while the image keeps its
    //    dependencies at /app/node_modules (Dockerfile WORKDIR /app).
    //    `require('better-sqlite3')` threw MODULE_NOT_FOUND.
    // 2. Moved to /app/backup.js, resolution worked and PARSING broke: package.json
    //    at /app declares "type": "module", so a .js file there is ESM and
    //    `require` is not defined in it at all.
    //
    // Both halves are asserted because fixing either alone reproduces the other.
    const command: string[] = compose.services.backup?.command ?? [];
    const script = command.find((arg) => /backup\.(c?js)$/.test(arg));
    expect(script, 'the backup service must run a backup script').toBeTruthy();
    expect(
      script!.startsWith('/app/'),
      `backup script runs from ${script} — it must live under /app so require() finds /app/node_modules`,
    ).toBe(true);
    expect(
      script!.endsWith('.cjs'),
      `${script} must be .cjs — /app/package.json declares "type": "module", so a .js file there is ESM and require() is not defined`,
    ).toBe(true);

    // The name on disk has to match, or the mount silently creates a new empty file.
    expect(fs.existsSync(path.join(REPO, 'deploy/backup.cjs'))).toBe(true);
    const mount = (compose.services.backup?.volumes ?? []).find((v: string) => v.includes('backup.'));
    expect(mount, 'the backup script must be mounted into the container').toBeTruthy();
    expect(mount).toContain(`:${script}`);
  });

  it('does NOT mount the database read-only, because WAL cannot be read that way', () => {
    // This looks like the safe choice and is the opposite. The app runs
    // journal_mode = WAL (src/db/db.ts), and SQLite cannot open a WAL database for
    // reading without write access to its -shm wal-index, or to the directory when
    // that file does not exist yet. A `:ro` mount here does not harden the backup;
    // it makes every cycle fail with SQLITE_CANTOPEN, and it fails at runtime in a
    // container nothing in CI starts, so the suite is where it has to be caught.
    //
    // What actually prevents this container writing the database is
    // `new Database(path, { readonly: true })` in deploy/backup.cjs — SQLite refuses
    // writes at the statement level regardless of the mount.
    const backupVolumes: string[] = compose.services.backup?.volumes ?? [];
    expect(
      backupVolumes.filter((v) => v.startsWith('ekos-data:') && v.endsWith(':ro')),
      'ekos-data is mounted read-only into the backup service; WAL reads need a writable -shm'
    ).toEqual([]);
    expect(
      read('deploy/backup.cjs'),
      'backup.cjs must open the database with { readonly: true } — that is the guard the mount cannot be'
    ).toMatch(/readonly:\s*true/);
  });

  it('does not back up a database whose schema is not initialized yet', () => {
    // The backup and ekos services start together and share ekos-data. The ekos
    // process CREATES the sqlite file (new Database) before it runs migrations, so
    // there is a first-boot window where the file exists with zero tables. A
    // readonly backup taken then is a structurally-valid, quick_check-passing,
    // completely EMPTY database that still gzips, verifies, and stamps the
    // heartbeat — a backup that reports "protected" and restores to nothing. CI
    // caught it once as "restored database is missing kb_documents"; this pins the
    // guard so it cannot silently return. The readiness signal is drizzle's
    // migration ledger, so an empty-but-migrated database (a legitimate state) is
    // still backed up.
    const src = read('deploy/backup.cjs');
    expect(
      src,
      'backup.cjs must check __drizzle_migrations before taking a snapshot'
    ).toMatch(/__drizzle_migrations/);
    expect(
      src,
      'a not-yet-initialized database must be skipped, not backed up as an empty snapshot'
    ).toMatch(/schema not initialized yet/);
  });

  it('runs the backup sidecar on the same image as the app, not a separate build', () => {
    // better-sqlite3 is a native addon compiled against a specific V8 ABI. A
    // backup process built from a different image could silently be unable to
    // open the file the app just wrote, or write a copy nothing else can restore.
    expect(compose.services.backup.image).toBe(compose.services.ekos.image);
  });

  it('does not gate the backup service behind the observability profile', () => {
    // Metrics and alerting are optional; the only copy of the corpus is not.
    // Gating this the same way as Prometheus/Alertmanager would make backups an
    // opt-in a deployer has to know to ask for.
    expect(compose.services.backup.profiles).toBeUndefined();
  });

  it('creates /backups with the right ownership so the backup volume is not born root-owned', () => {
    // The same failure mode README.md documents for a bind-mounted /data: a
    // volume populated with root ownership and a uid-1000 process trying to write
    // to it fails as SQLITE_CANTOPEN-style permission errors, not obviously.
    expect(dockerfile).toMatch(/mkdir -p \/data \/backups.*chown -R node:node.*\/backups/);
  });

  it('mounts the backup heartbeat into the ekos service, read-only', () => {
    // The heartbeat gauge (ekos.backup.last_success.timestamp, src/server/metrics.ts)
    // is read by the ekos process from a file the backup service writes. Without
    // this mount the gauge silently never reports — the "safely" wrapper in
    // metrics.ts turns a missing file into no data point rather than an error, so
    // there is nothing else that would catch a dropped mount.
    const ekosVolumes: string[] = compose.services.ekos?.volumes ?? [];
    expect(ekosVolumes.some((v) => v.startsWith('ekos-backups:') && v.endsWith(':ro'))).toBe(true);
  });

  it('gives every service a resource ceiling, not only backup', () => {
    // A single VM runs all of these side by side. Before this, only `backup` had
    // deploy.resources.limits — one noisy service (a traffic spike through the
    // collector, a TSDB compaction) could starve every other container with
    // nothing here to stop it.
    for (const name of ['ekos', 'otel-collector', 'prometheus', 'alertmanager', 'alert-sink', 'backup']) {
      const limits = compose.services[name]?.deploy?.resources?.limits;
      expect(limits, `${name} has no deploy.resources.limits`).toBeTruthy();
      expect(limits.cpus, `${name}.deploy.resources.limits.cpus`).toBeTruthy();
      expect(limits.memory, `${name}.deploy.resources.limits.memory`).toBeTruthy();
    }
  });
});

describe('alert rules', () => {
  const rules = YAML.parse(read('deploy/alerts.yaml'));
  const allRules = rules.groups.flatMap((g: any) => g.rules);
  const compose = YAML.parse(read('deploy/docker-compose.yml'));

  it('parses, and every rule has a severity and a description', () => {
    expect(allRules.length).toBeGreaterThan(0);
    for (const rule of allRules) {
      expect(rule.labels?.severity, `${rule.alert} has no severity`).toBeTruthy();
      expect(rule.annotations?.description, `${rule.alert} has no description`).toBeTruthy();
    }
  });

  it('alerts on the failure this system actually has: a 200 with a bad answer', () => {
    // The characteristic EKOS incident is silent retrieval degradation, not a 5xx.
    // If someone ever prunes these rules down to "the usual four", this fails.
    const names = allRules.map((r: any) => r.alert);
    expect(names).toContain('EkosSemanticSearchOff');
    expect(names).toContain('EkosRetrievalReturningNothing');
  });

  it('stamps a backup heartbeat that the run loop cannot skip on a failed cycle', () => {
    // The top finding of the audit this suite exists to answer: deploy/backup.cjs
    // logged success and failure but nothing watched it. The fix is this file
    // writing a heartbeat after every verified backup, and alerting on its age
    // rather than on a failure counter — a failure counter cannot see the backup
    // container simply not running.
    const backupSrc = read('deploy/backup.cjs');
    expect(backupSrc).toMatch(/writeHeartbeat\s*\(\s*\)/);
    expect(backupSrc).toMatch(/HEARTBEAT_PATH/);
  });

  it('alerts on backup age, not only on failure count', () => {
    const names = allRules.map((r: any) => r.alert);
    expect(names).toContain('EkosBackupStale');
    const rule = allRules.find((r: any) => r.alert === 'EkosBackupStale');
    // Must react to the metric being stale AND to it being entirely absent — a
    // heartbeat file that was never written observes as "no data", not as a
    // number a simple threshold could catch.
    expect(String(rule.expr)).toMatch(/ekos_backup_last_success_timestamp/);
    expect(String(rule.expr)).toMatch(/absent_over_time/);
  });

  it('couples the backup staleness threshold to the default backup interval, not to an unrelated number', () => {
    // alerts.yaml is static YAML that nothing templates from the environment,
    // so this threshold cannot read BACKUP_INTERVAL_SECONDS
    // at evaluation time. What this test can hold is that the hardcoded threshold
    // is a sane multiple of the hardcoded default interval in docker-compose.yml —
    // if one changes without the other, this is the assertion that notices.
    const rule = allRules.find((r: any) => r.alert === 'EkosBackupStale');
    const thresholdSeconds = Number(String(rule.expr).match(/>\s*(\d+)\)/)?.[1]);
    expect(thresholdSeconds).toBeGreaterThan(0);

    const defaultIntervalSeconds = Number(
      String(compose.services.backup.environment.BACKUP_INTERVAL_SECONDS).match(/:-(\d+)\}/)?.[1],
    );
    expect(defaultIntervalSeconds).toBeGreaterThan(0);

    // At least double the interval (so one missed-by-a-hair cycle cannot page),
    // and less than 10x (so the alert still means something within a working day).
    expect(thresholdSeconds).toBeGreaterThanOrEqual(defaultIntervalSeconds * 2);
    expect(thresholdSeconds).toBeLessThan(defaultIntervalSeconds * 10);
  });

  it('only references metrics the code actually emits', () => {
    // A rule naming an instrument that does not exist never fires, and looks
    // exactly like a rule whose condition is healthy.
    const metricsSrc = read('src/server/metrics.ts');
    const emitted = new Set(
      Array.from(metricsSrc.matchAll(/create\w+\(\s*'([a-z0-9._]+)'/g)).map((m) => m[1].replace(/\./g, '_')),
    );
    // Instruments that come from the OpenTelemetry instrumentations rather than
    // from metrics.ts, so they are not derivable from that file.
    const fromInstrumentation = ['http_server_request_duration', 'nodejs_eventloop_delay_p99_seconds'];

    const referenced = new Set<string>();
    for (const rule of allRules) {
      for (const m of String(rule.expr).matchAll(/\b(ekos_[a-z0-9_]+|http_server_[a-z0-9_]+|nodejs_[a-z0-9_]+)/g)) {
        referenced.add(m[1]);
      }
    }

    const unknown = [...referenced].filter((name) => {
      if (fromInstrumentation.some((p) => name.startsWith(p))) return false;
      // Prometheus histogram encodings of an emitted instrument.
      const base = name.replace(/_(bucket|sum|count)$/, '');
      return !emitted.has(base);
    });
    expect(unknown, 'deploy/alerts.yaml references metrics that src/server/metrics.ts does not emit').toEqual([]);
  });
});

describe('alert delivery (deploy/alertmanager.yml, docker-compose.yml)', () => {
  const alertmanagerConfig = YAML.parse(read('deploy/alertmanager.yml'));
  const compose = YAML.parse(read('deploy/docker-compose.yml'));

  it('does not route the default or critical route to the built-in null receiver', () => {
    // A rule that fires into an Alertmanager with no receiver configured is a rule
    // that fires into nothing, and Alertmanager's own "null" receiver is silent by
    // definition. If this ever regresses back to "null", every alert in
    // alerts.yaml is once again reaching no one — see the header of this file for
    // why that failure mode does not raise an error anywhere.
    expect(alertmanagerConfig.route.receiver).not.toBe('null');
    for (const route of alertmanagerConfig.route.routes ?? []) {
      expect(route.receiver).not.toBe('null');
    }
  });

  it('points the default receiver at a webhook this deployment actually runs', () => {
    // The receiver Alertmanager is configured to use must resolve to a real
    // service in this compose file, not a name that merely looks configured.
    const receiver = alertmanagerConfig.receivers.find(
      (r: any) => r.name === alertmanagerConfig.route.receiver,
    );
    expect(receiver?.webhook_configs?.[0]?.url).toBe('http://alert-sink:9094/');
    expect(compose.services).toHaveProperty('alert-sink');
  });

  it('passes alertmanager only flags alertmanager has', () => {
    // This assertion used to REQUIRE `--config.expand-env`, on the belief that it
    // was what let alertmanager.yml reference ${ALERTMANAGER_WEBHOOK_URL}. No such
    // flag exists in Alertmanager — it belongs to other Prometheus-family
    // binaries. kingpin rejects an unknown flag and exits, so the container
    // "Started" and was dead before it could bind :9093, restarted forever, and
    // the CI readiness check got a bare connection-refused.
    //
    // A green test asserting the presence of the thing that made the container
    // unable to start is worse than no test, so this one is inverted: an
    // allowlist. Adding a flag now means checking it exists first.
    const args: string[] = compose.services.alertmanager.command ?? [];
    const SUPPORTED = ['--config.file', '--storage.path', '--web.listen-address', '--web.external-url', '--cluster.listen-address', '--log.level'];
    for (const arg of args) {
      const flag = arg.split('=')[0];
      expect(SUPPORTED, `${flag} is not in the set of alertmanager flags this repo has verified`).toContain(flag);
    }
    expect(args.some((a) => a.startsWith('--config.file'))).toBe(true);
  });

  it('documents url_file — the mechanism alertmanager actually has — for a real receiver', () => {
    // The secret has to stay out of this tracked file either way. Alertmanager
    // does not expand environment variables, but webhook_configs does support
    // `url_file`, which reads the URL from a mounted path at notify time.
    const raw = read('deploy/alertmanager.yml');
    expect(raw).toContain('url_file');
    // The placeholder, not the flag name: the header explains at length why that
    // flag does not exist, and a test that forbids naming it would forbid saying
    // so. What must not survive is a config that USES the expansion.
    expect(raw, 'a ${VAR} in this file expands to nothing — Alertmanager does not substitute').not.toContain('${ALERTMANAGER_WEBHOOK_URL}');
  });

  it('runs the log-only sink under the observability profile, alongside what it serves', () => {
    expect(compose.services['alert-sink'].profiles).toContain('observability');
  });
});
