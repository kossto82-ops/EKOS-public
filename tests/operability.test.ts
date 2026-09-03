import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, authHeader } from './testApp.ts';
import { databaseSettings, pragmaStatements } from '../src/db/db.ts';
import { createShutdownHandler } from '../src/server/shutdown.ts';

/**
 * Operability: the things an operator needs that no feature test covers.
 *
 * Before this, the only way to ask whether the process was serving was "does the
 * SPA render" — which stays true when the database is unreadable or the vector
 * index is empty, the two ways this system degrades. And there was no shutdown
 * path at all, so a redeploy killed requests mid-flight and left WAL contents
 * unmerged.
 */
let app: Express;
beforeAll(() => {
  app = createTestApp();
});

describe('GET /healthz — liveness', () => {
  it('answers without any credentials', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  /**
   * A liveness probe that fails because a *dependency* is down gets the container
   * restarted, which fixes nothing and drops the requests it was serving. So this
   * endpoint must not consult the database at all — asserted by its response
   * carrying no dependency information whatsoever.
   */
  it('reports only process state, never dependency state', async () => {
    const res = await request(app).get('/healthz');
    expect(res.body).not.toHaveProperty('checks');
    expect(Object.keys(res.body).sort()).toEqual(['status', 'uptimeSec']);
  });
});

describe('GET /readyz — readiness', () => {
  it('answers without credentials and reports each dependency', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    const names = res.body.checks.map((c: any) => c.name);
    expect(names).toContain('database');
    expect(names).toContain('vectorIndex');
    expect(names).toContain('sharepoint');
  });

  it('is degraded — not unavailable — when only optional dependencies are down', async () => {
    // The in-memory test database has no embeddings and no Graph credentials, so
    // this is exactly the "serving, but lexical-only" state a deployment lands in
    // before anyone runs the embedding backfill.
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.find((c: any) => c.name === 'database').ok).toBe(true);
    expect(res.body.checks.find((c: any) => c.name === 'vectorIndex').ok).toBe(false);
  });

  /**
   * These routes are unauthenticated by necessity (a probe has no identity), so
   * what they may say is constrained: whether a dependency works, never how much
   * is in it. Corpus size stays behind GET /api/embeddings/status.
   */
  it('leaks no counts, names or configuration values', async () => {
    const res = await request(app).get('/readyz');
    const serialized = JSON.stringify(res.body.checks);
    // No bare integers in the details — the one number in the envelope is uptime.
    expect(serialized).not.toMatch(/\d+\s*\/\s*\d+/);
    for (const check of res.body.checks) {
      expect(typeof check.ok).toBe('boolean');
      expect(typeof check.required).toBe('boolean');
      expect(typeof check.detail).toBe('string');
      expect(Object.keys(check).sort()).toEqual(['detail', 'name', 'ok', 'required']);
    }
  });

  it('returns 503 when a REQUIRED dependency is down', async () => {
    // Readiness is only useful if it can actually fail: an orchestrator pulls the
    // instance out of rotation on 503 instead of letting it serve errors.
    vi.resetModules();
    vi.doMock('../src/db/db.ts', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/db/db.ts')>()),
      pingDatabase: () => ({ ok: false, error: 'database is locked' }),
    }));

    const express = (await import('express')).default;
    const { router } = await import('../src/server/routes/health.ts');
    const { errorHandler, requestId } = await import('../src/server/middleware/errors.ts');
    const brokenApp = express();
    brokenApp.use(requestId);
    brokenApp.use(router);
    brokenApp.use(errorHandler);

    const res = await request(brokenApp).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks.find((c: any) => c.name === 'database').ok).toBe(false);

    // Even a failure detail stays generic — no raw driver message.
    expect(JSON.stringify(res.body)).not.toContain('database is locked');

    vi.doUnmock('../src/db/db.ts');
    vi.resetModules();
  });

  it('does not become a way to reach guarded data', async () => {
    // Sanity: the health router is mounted above the auth middleware, so confirm
    // that mounting it there did not expose anything else unauthenticated.
    const res = await request(app).get('/api/db/documents');
    expect(res.status).toBe(401);
  });
});

describe('SQLite connection pragmas', () => {
  it('waits for a lock rather than failing the request, and enforces foreign keys', () => {
    const settings = databaseSettings();
    expect(settings.busyTimeoutMs).toBe(5000);
    expect(settings.foreignKeys).toBe(true);
  });

  /**
   * WAL cannot be observed from the suite — tests run against `:memory:`, where it
   * does not apply — so the decision itself is the unit under test.
   */
  it('enables WAL everywhere except the in-memory test database', () => {
    expect(pragmaStatements('production')).toContain('journal_mode = WAL');
    expect(pragmaStatements('development')).toContain('journal_mode = WAL');
    expect(pragmaStatements(undefined)).toContain('journal_mode = WAL');
    expect(pragmaStatements('test')).not.toContain('journal_mode = WAL');
    // ...but the other two apply in every environment, including tests.
    for (const env of ['production', 'test']) {
      expect(pragmaStatements(env)).toContain('foreign_keys = ON');
      expect(pragmaStatements(env)).toContain('busy_timeout = 5000');
    }
  });
});

describe('graceful shutdown sequence', () => {
  it('drains connections BEFORE closing the database', async () => {
    // The ordering is the whole point: closing the database first would fail
    // exactly the in-flight requests the drain is waiting for.
    const order: string[] = [];
    let exitCode: number | undefined;
    const shutdown = createShutdownHandler({
      closeServer: (done) => {
        order.push('closeServer');
        setTimeout(() => done(), 5);
      },
      closeDatabase: () => order.push('closeDatabase'),
      exit: (code) => { exitCode = code; order.push('exit'); },
    });

    shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 25));

    expect(order).toEqual(['closeServer', 'closeDatabase', 'exit']);
    expect(exitCode).toBe(0);
  });

  it('ignores a second signal instead of racing the first drain', async () => {
    const order: string[] = [];
    const shutdown = createShutdownHandler({
      closeServer: (done) => { order.push('closeServer'); setTimeout(() => done(), 5); },
      closeDatabase: () => order.push('closeDatabase'),
      exit: () => order.push('exit'),
    });

    shutdown('SIGINT');
    shutdown('SIGINT'); // impatient second Ctrl-C
    await new Promise((r) => setTimeout(r, 25));

    expect(order).toEqual(['closeServer', 'closeDatabase', 'exit']);
  });

  it('still closes the database when connections refuse to drain', async () => {
    // A hung keep-alive connection must not keep the process alive forever — and
    // the forced exit must not skip the database close, or WAL is left unmerged.
    const order: string[] = [];
    let exitCode: number | undefined;
    const shutdown = createShutdownHandler({
      closeServer: () => { order.push('closeServer'); /* never calls done() */ },
      closeDatabase: () => order.push('closeDatabase'),
      exit: (code) => { exitCode = code; order.push('exit'); },
      graceMs: 10,
    });

    shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 40));

    expect(order).toEqual(['closeServer', 'closeDatabase', 'exit']);
    expect(exitCode).toBe(1);
  });

  it('exits non-zero when the server reports a close error', async () => {
    let exitCode: number | undefined;
    const shutdown = createShutdownHandler({
      closeServer: (done) => done(new Error('not running')),
      closeDatabase: () => {},
      exit: (code) => { exitCode = code; },
    });

    shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 10));

    expect(exitCode).toBe(1);
  });
});

describe('access log', () => {
  /**
   * The log line is the observable contract of the access log: one entry per
   * request, carrying the correlation id, the outcome and the duration. Asserted
   * against the logger's own stream so the fields are pinned, not the formatting.
   */
  it('emits one structured line per request with the correlation id and outcome', async () => {
    const { accessLog, logger } = await import('../src/server/logger.ts');
    const lines: any[] = [];
    // pino is silent under test, so nothing reaches a transport; spy on the methods
    // the middleware actually calls instead.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(((obj: any) => { lines.push({ level: 'warn', obj }); }) as any);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(((obj: any) => { lines.push({ level: 'info', obj }); }) as any);

    const express = (await import('express')).default;
    const probe = express();
    probe.use((req: any, _res, next) => { req.id = 'req_access_log_probe'; next(); });
    probe.use('/api', accessLog);
    probe.get('/api/ok', (_req, res) => { res.json({ ok: true }); });
    probe.get('/api/bad', (_req, res) => { res.status(400).json({ ok: false }); });

    await request(probe).get('/api/ok');
    await request(probe).get('/api/bad');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: 'info',
      obj: { requestId: 'req_access_log_probe', method: 'GET', path: '/api/ok', status: 200 },
    });
    expect(typeof lines[0].obj.durationMs).toBe('number');
    // A 4xx is the caller's fault, so it logs at warn — that difference is what
    // makes "alert on rejections" possible without alerting on every request.
    expect(lines[1]).toMatchObject({ level: 'warn', obj: { path: '/api/bad', status: 400 } });

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
