/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
// NOTE: Vite is NOT imported here. It is loaded with a dynamic import inside the
// development branch below, so that production never resolves it — see the
// comment there. A static import would put it back on the runtime path.
import dotenv from "dotenv";
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { closeDatabase, initDatabase, migrationStatus } from "./src/db/db.ts";
import { seedDatabase } from "./src/db/seed.ts";
import { logger, accessLog } from "./src/server/logger.ts";
import { registerRuntimeGauges } from "./src/server/metrics.ts";
import { stopTelemetry, telemetryConfig } from "./src/server/otel.ts";
import { embeddingCoverage, warmVectorCache } from "./src/server/vectorStore.ts";
import { warmEmbeddingProvider } from "./src/server/embeddings.ts";
import { createShutdownHandler } from "./src/server/shutdown.ts";
import { router as healthRoutes } from "./src/server/routes/health.ts";
import { router as authRoutes } from "./src/server/routes/auth.ts";
import { router as aiRoutes } from "./src/server/routes/ai.ts";
import { router as documentsRoutes } from "./src/server/routes/documents.ts";
import { router as sourcesRoutes } from "./src/server/routes/sources.ts";
import { router as syncRoutes } from "./src/server/routes/sync.ts";
import { router as governanceRoutes } from "./src/server/routes/governance.ts";
import { router as brandsRoutes } from "./src/server/routes/brands.ts";
import { apiNotFound, errorHandler, requestId } from "./src/server/middleware/errors.ts";

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

// Correlation id first, so every log line and failure envelope below can carry it.
app.use(requestId);

app.use(helmet({
  frameguard: false,
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://api.anthropic.com", "https://api.openai.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    }
  } : false,
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000', credentials: true }));
// 20mb to match the client's MAX_UPLOAD_BYTES for KB document uploads — the
// extracted text body is always smaller than the source file's raw bytes.
//
// This must be the ONLY express.json() registration. A second, limit-less one
// used to sit above the helmet block: body-parser marks the request as parsed
// (`req._body`) and returns early on the next parser, so the first registration
// always won and this 20mb limit was dead code. Every upload
// whose extracted text exceeded body-parser's 100kb default was rejected with 413
// even though the client had accepted the file — i.e. the effective API limit was
// 0.1mb, not 20mb.
app.use(express.json({ limit: '20mb' }));

// LLM-calling endpoints get their own, much tighter budget layered on top of
// the general API limit below — otherwise a single noisy/buggy client could
// burn through the shared 150-req/15min allowance in expensive AI calls
// alone, starving every other route (and driving up AI provider cost) well
// within what the general limiter would still allow.
app.use(['/api/search', '/api/kb-chat', '/api/copilot-generate', '/api/copilot-draft', '/api/test-ai-connection'], rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { success: false, error: 'Too many AI requests — please wait a few minutes and try again.' }
}));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
}));

// One structured line per API request, with its outcome, duration and correlation
// id. Scoped to /api: in development Vite serves every source module through this
// same app, and those would bury the ~10 API calls a page load actually makes.
app.use('/api', accessLog);

// Liveness/readiness, mounted ABOVE the API routers because probes are
// unauthenticated by necessity — see src/server/routes/health.ts for what that
// means for what they may report. They sit outside /api (and so outside the
// limiter above), with their own generous ceiling: a probe runs every few seconds
// forever, but it should still not be an unmetered way to make this process work.
app.use(['/healthz', '/readyz'], rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
}));
app.use(healthRoutes);

// Corporate OAuth2 BFF login flow (/auth/*). Mounted outside /api: these are
// browser-facing redirects, not JSON API calls, and the login/callback pair
// must stay unauthenticated. See src/server/routes/auth.ts.
app.use(authRoutes);

// AI-provider proxy + search/chat/copilot endpoints (server-side, keeps provider keys off the client)
app.use(aiRoutes);

// Enterprise persistence API (relational SQL, via Drizzle ORM over SQLite)
app.use(documentsRoutes);
app.use(sourcesRoutes);
app.use(syncRoutes);
app.use(governanceRoutes);
app.use(brandsRoutes);

// Unmatched API paths must 404 as JSON here — below this point the SPA fallback
// answers everything with index.html, so a typo'd endpoint used to return
// `200 text/html` and the caller parsed a web page as its payload.
app.use('/api', apiNotFound);

async function startServer() {
  // Synchronously initialize database schemas and seed default records
  try {
    initDatabase();
    await seedDatabase();
  } catch (dbErr) {
    logger.error({ err: dbErr }, "Database self-bootstrap failed");
  }

  // Gauges over database-resident state, registered here rather than at module load
  // because they read the database and this is the first point at which there is
  // one. See src/server/metrics.ts for why embedding coverage in particular is a
  // gauge and not a log line: the boot-time warning below fires once, and the
  // condition it warns about lasts until someone acts on it.
  // BACKUP_HEARTBEAT_PATH is only meaningful when the volume it points at is
  // actually mounted into this container (deploy/docker-compose.yml mounts
  // ekos-backups read-only into the ekos service for exactly this). Passed
  // through as-is, undefined and all: registerRuntimeGauges treats an absent
  // path as "no backup heartbeat gauge", not as a default it should guess at.
  registerRuntimeGauges({ embeddingCoverage, migrationStatus, backupHeartbeatPath: process.env.BACKUP_HEARTBEAT_PATH });

  // Say out loud whether semantic retrieval is actually available.
  //
  // Without vectors the pipeline degrades to term matching and keeps answering,
  // which sounds like graceful degradation and is not: measured on the labelled
  // set, lexical-only retrieval finds the right document for 5% of queries
  // (hit@1 0.0%) against 83% for hybrid — see docs/RAG.md §5.8. That is not "a bit
  // worse", and until now nothing said so at boot. An operator learned about it
  // from users reporting bad answers, if at all.
  try {
    const coverage = embeddingCoverage();
    if (coverage.total === 0) {
      logger.warn("Knowledge base has no chunks yet — retrieval will return nothing until documents are ingested.");
    } else if (coverage.embedded === 0) {
      logger.error(
        { chunks: coverage.total, embedded: 0, signature: coverage.signature },
        "NO EMBEDDINGS INDEXED — semantic search is OFF and retrieval is keyword-only, which misses most paraphrased or cross-lingual questions. Run POST /api/embeddings/backfill.",
      );
    } else if (coverage.embedded < coverage.total) {
      logger.warn(
        { chunks: coverage.total, embedded: coverage.embedded, signature: coverage.signature },
        "Partial embedding coverage — documents whose chunks are not vectorized are reachable by keyword only.",
      );
    } else {
      logger.info({ chunks: coverage.total, signature: coverage.signature }, "Semantic retrieval active — embedding coverage complete.");
    }
  } catch (covErr) {
    logger.error({ err: covErr }, "Could not determine embedding coverage at startup");
  }

  // Build the vector cache BEFORE the server starts listening, so no user's
  // request pays for it. Measured at ~77ms for 685 vectors here — small, and
  // spent while nothing is being served, which is what boot time is for.
  //
  // Deliberately NOT deferred behind listen(): the work is synchronous, so a
  // "background" warmup would block the event loop with real requests already
  // queued behind it. If this ever grows past a second on a larger corpus, the
  // answer is to make it incremental, not to move it after the port opens.
  const warm = warmVectorCache();
  if (warm.warmed) {
    logger.info({ vectors: warm.vectors, durationMs: warm.durationMs }, "Vector cache warmed");
  } else if (warm.reason) {
    logger.info({ reason: warm.reason }, "Vector cache not warmed");
  }

  if (process.env.NODE_ENV !== "production") {
    // Dynamic, and inside the development branch, so the production bundle never
    // requires Vite. It used to be a static top-level import: `--packages=external`
    // leaves it as a real `require('vite')` in dist/server.cjs, which meant Vite —
    // and through it esbuild, postcss and their trees — had to be a runtime
    // dependency and travelled into the image. The first Trivy scan charged 30
    // CVEs to two esbuild binaries alone (Go stdlib, 1 CRITICAL each) for a
    // toolchain the container never executes.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Immutable cache for fingerprinted assets (JS chunks, CSS, fonts, images)
    // These filenames contain a content hash — safe to cache for 1 year.
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));

    // Short cache for index.html and other root files — must revalidate
    // so users always get the latest entry point.
    app.use(express.static(distPath, {
      maxAge: '0',
      etag: true,
    }));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Terminal error middleware — must be registered after every router and after
  // the Vite/static middleware. Turns anything thrown (including async rejections
  // routed through asyncHandler) into one standard envelope, and keeps internal
  // messages in the log instead of the response body.
  app.use(errorHandler);

  const server = app.listen(PORT, "0.0.0.0", () => {
    // Telemetry state is part of the boot banner because "we have no data for that
    // window" is otherwise discovered weeks later, during an incident. An operator
    // who set the endpoint variable and typo'd it sees it here.
    const otel = telemetryConfig();
    logger.info(
      {
        port: PORT,
        env: process.env.NODE_ENV ?? "development",
        telemetry: otel.enabled ? { endpoint: otel.endpoint, service: otel.serviceName, version: otel.serviceVersion } : `off (${otel.reason})`,
      },
      "EKOS API listening",
    );

    // Take the embedding provider's first-call penalty here rather than on the
    // first user to search. Measured against the configured endpoint, call 1 is
    // 2265ms and calls 2-5 are 318-383ms — that gap IS the slow first search,
    // and it dwarfs both the vector cache (77ms) and the lexical scan.
    //
    // Covers the restart case ONLY. The endpoint also unloads its model when
    // idle (7 minutes quiet -> 3452ms), so a quiet afternoon costs the next
    // searcher the same seconds. That one is fixed where the model runs, not
    // here — see the note on warmEmbeddingProvider.
    //
    // After listen() and not awaited, unlike the vector cache warmed above: this
    // is network I/O, so it costs no event-loop time, and blocking boot on a
    // provider that might hang would trade a slow first search for a server that
    // never comes up.
    void warmEmbeddingProvider().then((warm) => {
      if (warm.warmed) {
        logger.info({ durationMs: warm.durationMs }, "Embedding provider warmed");
      } else if (warm.reason) {
        logger.info({ reason: warm.reason }, "Embedding provider not warmed");
      }
    });
  });

  // A failed bind used to surface as a raw stack trace with the actual cause
  // (usually "port already in use") buried in it.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: PORT }, `Port ${PORT} is already in use — is another EKOS instance running?`);
    } else {
      logger.fatal({ err }, "HTTP server failed to start");
    }
    process.exit(1);
  });

  // Graceful shutdown: drain connections, THEN close the database. The sequence
  // lives in src/server/shutdown.ts so it can be unit-tested — see the note there
  // on why the order matters and why it isn't verified end-to-end.
  const shutdown = createShutdownHandler({
    closeServer: (done) => server.close(done),
    closeDatabase,
    flushTelemetry: stopTelemetry,
    exit: (code) => process.exit(code),
  });

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Last-resort visibility. An unhandled rejection used to print a bare stack with
  // no request context and no level for a log pipeline to alert on; an uncaught
  // exception left the process in an undefined state, still accepting traffic.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — shutting down");
    shutdown("uncaughtException");
  });
}

startServer();
