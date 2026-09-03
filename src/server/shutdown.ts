/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from "./logger.ts";

export interface ShutdownDeps {
  /** Stops accepting new connections and invokes the callback once in-flight requests finish. */
  closeServer: (done: (err?: Error) => void) => void;
  /** Closes the SQLite handle (checkpointing WAL back into the main file). */
  closeDatabase: () => void;
  /** Injected so the sequence can be asserted without ending the test process. */
  exit: (code: number) => void;
  /**
   * Flushes buffered telemetry (see src/server/otel.ts). Optional: with no
   * collector configured there is nothing to flush, and the shutdown sequence must
   * not depend on telemetry being switched on.
   */
  flushTelemetry?: () => Promise<void>;
  /** How long to wait for connections to drain before exiting anyway. */
  graceMs?: number;
  /**
   * How long to wait for that flush. Short on purpose — see the call site: an
   * unreachable collector must cost the shutdown a second, not the whole grace
   * period.
   */
  flushMs?: number;
}

/**
 * Builds the signal handler used for SIGTERM/SIGINT.
 *
 * Extracted from server.ts because the ORDER here is the whole point and is easy to
 * get subtly wrong: connections must drain **before** the database closes. Closing
 * the database first would fail exactly the requests the drain is waiting for —
 * and that mistake is invisible in manual testing, where a dev hits Ctrl-C on an
 * idle server. Windows cannot deliver a real SIGTERM to a child process, so the
 * sequence is verified as a unit (tests/shutdown.test.ts) rather than end-to-end.
 *
 * Previously there was no handler at all: a redeploy or Ctrl-C killed the process
 * mid-request and never closed the handle, leaving committed transactions in
 * `db.sqlite-wal` that only merge back on the next open — so a database file copied
 * for backup in that window was not the whole database.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => void {
  const graceMs = deps.graceMs ?? 10_000;
  const flushMs = deps.flushMs ?? 2_000;
  let shuttingDown = false;

  /**
   * Last step before exit: push the buffered spans, metrics and log records out.
   *
   * This is the batch that matters most — it holds the shutdown itself and
   * whatever preceded it — and without an explicit flush it is dropped on
   * `process.exit()`, so every deploy and every crash ends in a blind spot.
   *
   * Bounded, and it never propagates a failure: the collector being down is not a
   * reason to delay or fail an exit. Telemetry is allowed to lose data here; the
   * process is not allowed to hang here.
   */
  const flushThenExit = (code: number) => {
    if (!deps.flushTelemetry) return deps.exit(code);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      deps.exit(code);
    };
    const timer = setTimeout(() => {
      logger.warn({ flushMs }, "Telemetry did not flush in time — exiting without it");
      finish();
    }, flushMs);
    if (typeof timer.unref === "function") timer.unref();
    deps
      .flushTelemetry()
      .catch((err) => logger.warn({ err }, "Telemetry flush failed"))
      .finally(() => {
        clearTimeout(timer);
        finish();
      });
  };

  return function shutdown(signal: string) {
    // A second Ctrl-C (or a SIGTERM arriving while an uncaughtException is already
    // unwinding) must not start a second drain and race the first.
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutdown signal received — draining connections");

    // Backstop: one hung keep-alive connection must not keep the process alive
    // forever. Orchestrators send SIGKILL after their own grace period anyway, so
    // exiting first means we exit having closed the database.
    const forceExit = setTimeout(() => {
      logger.warn({ graceMs }, "Connections did not drain in time — exiting anyway");
      deps.closeDatabase();
      flushThenExit(1);
    }, graceMs);
    if (typeof forceExit.unref === "function") forceExit.unref();

    deps.closeServer((err) => {
      clearTimeout(forceExit);
      if (err) logger.error({ err }, "Error while closing the HTTP server");
      deps.closeDatabase();
      // Logged before the flush, not after, so this line is itself in the batch
      // that gets shipped — "did it shut down cleanly?" is a question you ask of
      // the log backend, which is exactly where it would otherwise be missing.
      logger.info("Shutdown complete");
      flushThenExit(err ? 1 : 0);
    });
  };
}
