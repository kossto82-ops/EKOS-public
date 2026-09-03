/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import pino from "pino";

/**
 * The server's single log sink.
 *
 * Every server-side line used to be a bare `console.log/warn/error` with an
 * ad-hoc prefix. That is fine to read over a developer's shoulder and useless in
 * operation: there is no level to filter on, no way to correlate the three lines a
 * single failing request produced, and no machine-readable field to alert on. A
 * production incident meant grepping prose.
 *
 * So: one structured JSON line per event, every request-scoped line carrying the
 * same `requestId` the client sent (see src/server/middleware/errors.ts), and one
 * import surface — swapping stdout for an OTel/Datadog transport later is a change
 * to this file only, not to 40 call sites.
 *
 * That export now exists, and in the end it cost this file nothing: the pino
 * instrumentation in src/server/otel.ts attaches a second stream to this logger at
 * startup, so every line below goes to stdout *and* to the OTLP logs endpoint,
 * carrying the trace and span id of the request that produced it. stdout is kept
 * deliberately rather than replaced — `docker logs` has to keep working when the
 * collector is the thing that is broken.
 *
 * Levels: `LOG_LEVEL` wins if set. Otherwise `info` in production, `debug` in
 * development, and **silent** under test — a test suite asserting on behavior
 * should not have to read past the log of the behavior.
 */
const NODE_ENV = process.env.NODE_ENV ?? "development";

const defaultLevel = NODE_ENV === "test" ? "silent" : NODE_ENV === "production" ? "info" : "debug";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? defaultLevel,
  base: { service: "ekos-api", pid: process.pid },
  // ISO instead of pino's epoch-millis default: these lines are read by people
  // as often as by tools here, and correlating with a UI-side report means
  // matching timestamps by eye.
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  /**
   * Backstop, not the primary control. Nothing below is *supposed* to log a
   * secret — the call sites pass explicit fields, never whole request bodies —
   * but an AI provider key travels in `aiConfig.apiKey` on several routes and in
   * the `ai_provider_config` row, so one careless `logger.info({ body })` during
   * future debugging must not be able to write a live key to disk.
   */
  redact: {
    paths: [
      "apiKey",
      "*.apiKey",
      "aiConfig.apiKey",
      "config.apiKey",
      "body.apiKey",
      "headers.authorization",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
});

/**
 * Per-request access log. Mounted on `/api` only: in development Vite serves
 * hundreds of module requests through this same app, and an access log that
 * drowns the ~10 API calls a page load makes is one nobody reads.
 *
 * Logged on `finish` (not on entry) so the line carries the outcome and the
 * duration — one line per request rather than two half-lines to correlate.
 */
export function accessLog(req: any, res: any, next: any) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const fields = {
      requestId: req.id,
      method: req.method,
      path: String(req.originalUrl || "").split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      // Present once requireUser has run; absent on a 401, which is itself the
      // useful signal.
      userId: req.user?.id,
    };
    // A 5xx is ours, a 4xx is the caller's, everything else is routine.
    if (res.statusCode >= 500) logger.error(fields, "request failed");
    else if (res.statusCode >= 400) logger.warn(fields, "request rejected");
    else logger.info(fields, "request");
  });
  next();
}
