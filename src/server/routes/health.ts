/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { migrationStatus, pingDatabase } from "../../db/db.ts";
import { embeddingCoverage } from "../vectorStore.ts";
import { getGraphConfig } from "../sharepoint/graphClient.ts";
import { asyncHandler } from "../middleware/errors.ts";

/**
 * Liveness and readiness.
 *
 * There was no way to ask this process whether it was serving. A deployment had to
 * infer health from "does the SPA render", which stays true even when the database
 * is unreadable or the vector index is empty — the two failure modes that actually
 * matter here, because retrieval silently degrades to lexical-only instead of
 * erroring (see docs/KNOWN_LIMITATIONS.md).
 *
 * **Deliberately unauthenticated**, because a load balancer or container probe has
 * no user identity to present. That constrains what they may say: these routes
 * report *whether* each dependency is usable, never how much data is in it. The
 * numbers stay behind `GET /api/embeddings/status`, which requires a settings-tab
 * role. Nothing here reveals corpus size, document names, or configuration values.
 */
export const router = express.Router();

const startedAt = Date.now();

/**
 * Liveness: is the process up and able to answer? Touches nothing external on
 * purpose — a probe that fails because a *dependency* is down gets the container
 * killed and restarted, which fixes nothing and drops the requests it was serving.
 */
router.get("/healthz", (_req, res) => {
  return res.json({
    status: "ok",
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  });
});

/**
 * Readiness: should this instance receive traffic? Checks the dependencies a
 * request genuinely needs. Returns **503** when a required check fails, so an
 * orchestrator pulls the instance out of rotation rather than serving errors.
 *
 * `required: false` checks report a degraded-but-serving state: with no vectors,
 * retrieval still answers — lexically — and that is a condition an operator must
 * be able to see without reading the database, not a reason to refuse traffic.
 */
router.get("/readyz", asyncHandler(async (_req, res) => {
  const checks: Array<{ name: string; ok: boolean; required: boolean; detail: string }> = [];

  const dbPing = pingDatabase();
  checks.push({
    name: "database",
    ok: dbPing.ok,
    required: true,
    detail: dbPing.ok ? "readable" : "unreadable — schema missing or file locked",
  });

  // A process serving on a schema older than its own code is a required failure,
  // not a degradation: initDatabase() applies migrations at startup, so anything
  // still pending here means the migration run did not complete. Reported as a
  // count only — which migrations exist is not a probe's business.
  const migrations = migrationStatus();
  checks.push({
    name: "migrations",
    ok: migrations.upToDate,
    required: true,
    detail: migrations.upToDate
      ? `schema at migration ${migrations.applied}`
      : `${migrations.pending} migration(s) pending — the schema is behind this build`,
  });

  // Semantic retrieval is optional-but-visible: a deployment that never ran
  // POST /api/embeddings/backfill has no vectors at all and serves lexical-only
  // results while still reporting mode 'hybrid' elsewhere. Surfacing it here is
  // the cheapest way to stop that going unnoticed after a deploy.
  let vectorsOk = false;
  let vectorDetail = "unavailable";
  try {
    const coverage = embeddingCoverage();
    vectorsOk = coverage.embedded > 0;
    vectorDetail = vectorsOk
      ? "vector index present — hybrid retrieval active"
      : "no vectors — retrieval is lexical-only until POST /api/embeddings/backfill runs";
  } catch {
    vectorDetail = "could not read embedding coverage";
  }
  checks.push({ name: "vectorIndex", ok: vectorsOk, required: false, detail: vectorDetail });

  const graphConfigured = getGraphConfig() !== null;
  checks.push({
    name: "sharepoint",
    ok: graphConfigured,
    required: false,
    detail: graphConfigured
      ? "Graph credentials configured"
      : "not configured — serving the ingested snapshot",
  });

  const ready = checks.every((c) => !c.required || c.ok);
  const degraded = ready && checks.some((c) => !c.ok);

  return res.status(ready ? 200 : 503).json({
    status: ready ? (degraded ? "degraded" : "ok") : "unavailable",
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    checks,
  });
}));
