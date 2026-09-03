/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The metrics EKOS emits about itself.
 *
 * Separate from src/server/otel.ts on purpose. That file is the SDK bootstrap and
 * must load before anything else; this one is imported by ordinary application
 * code and depends only on `@opentelemetry/api`, whose instruments are no-ops when
 * no SDK is registered. So a call site can record freely without knowing or caring
 * whether telemetry is switched on, and nothing here can break a developer's
 * `npm run dev`.
 *
 * ## Why these instruments and not the usual ones
 *
 * Request rate, latency and error rate come free from the HTTP instrumentation.
 * They are also, for this system, the least informative numbers available: the
 * characteristic EKOS failure is not a 500. It is a **200 with a bad answer**.
 *
 * The two ways that happens are already documented and were already known
 * (docs/RAG.md §5.8, docs/KNOWN_LIMITATIONS.md) — and neither was measurable in a
 * running deployment:
 *
 *  1. **The vector index is empty or stale.** Retrieval silently degrades to
 *     lexical-only, which finds the right document for 5% of queries against 83%
 *     for hybrid. Every request still returns 200. server.ts shouts about this once
 *     at boot; nothing said anything ever again, and nothing said it to anywhere
 *     but stdout.
 *  2. **Retrieval returns nothing, or nothing above threshold.** The pipeline
 *     answers anyway, from the model's own weights rather than from the corpus.
 *     Also a 200.
 *
 * So the instruments below are weighted towards *answer quality* and *provider
 * cost*, which are the things that actually page someone here, and the gauges are
 * deliberately the kind you can alert on directly (`embedded == 0`) rather than
 * having to derive.
 */

import { metrics, type Attributes, type ObservableResult } from '@opentelemetry/api';
import fs from 'fs';

const meter = metrics.getMeter('ekos', '1.0.0');

// -- AI providers -----------------------------------------------------------
// Attributes are always {provider, model} and never the prompt, the response, or
// anything derived from user content: these go to a third-party backend.

export const llmRequests = meter.createCounter('ekos.llm.requests', {
  description: 'AI provider calls, by provider, model and outcome (ok | error).',
});

export const llmDuration = meter.createHistogram('ekos.llm.duration', {
  description: 'Wall-clock duration of an AI provider call.',
  unit: 'ms',
});

/**
 * Token consumption, split input/output because they are priced differently by
 * every provider. This is the closest thing to a cost meter that does not require
 * hardcoding a price list that goes stale — multiply by the current rate at
 * dashboard time instead of at emit time.
 *
 * The call sites had to start *reading* usage to record this: `callAI` previously
 * pulled the text out of each provider response and dropped the usage block on the
 * floor, so the spend was genuinely unknowable from inside the process.
 */
export const llmTokens = meter.createCounter('ekos.llm.tokens', {
  description: 'Tokens consumed by AI provider calls, by provider, model and kind (input | output).',
  unit: '{token}',
});

// -- Retrieval --------------------------------------------------------------

export const retrievalDuration = meter.createHistogram('ekos.retrieval.duration', {
  description: 'Duration of a retrieval pass, by mode (hybrid | lexical).',
  unit: 'ms',
});

export const retrievalResults = meter.createHistogram('ekos.retrieval.results', {
  description: 'How many chunks a retrieval pass returned, by mode.',
  unit: '{chunk}',
});

/**
 * Retrieval passes that came back with nothing.
 *
 * The single most useful number in this file. A rising empty-result rate is the
 * earliest observable sign of every interesting failure — a bad reindex, a
 * corpus that failed to sync, an embedding model whose signature changed under
 * the stored vectors — and all of them otherwise present as "users say the answers
 * got worse", weeks later.
 */
export const retrievalEmpty = meter.createCounter('ekos.retrieval.empty', {
  description: 'Retrieval passes that returned zero chunks, by mode.',
});

// -- Runtime state gauges ---------------------------------------------------

/**
 * Gauges over state that lives in the database, registered as a callback rather
 * than pushed.
 *
 * This is a function and not module-level code because it reads the database, and
 * this module is imported from places that load before `initDatabase()` has run.
 * server.ts calls it once, after bootstrap. If it is never called the instruments
 * simply never report, which is the correct behaviour for a process that failed to
 * open its database — a gauge reporting 0 there would be a lie, not a datum.
 */
export function registerRuntimeGauges(sources: {
  // Structurally typed to just the two counts, not to vectorStore's full return
  // shape — this module must stay importable without dragging the database layer
  // in behind it. The embedding-model `signature` is deliberately not read: it is a
  // string, gauges are numbers, and it belongs on the boot log where it already is.
  embeddingCoverage: () => { total: number; embedded: number };
  migrationStatus: () => { applied: number; pending: number; upToDate: boolean };
  // Absolute path to the heartbeat file the `backup` service stamps after every
  // verified backup (deploy/backup.cjs). Optional and omitted entirely under test —
  // there is no backup service in that environment, and a gauge reporting on a
  // path that will never exist is not a meaningful default. See
  // ekosBackupLastSuccess below for why this, and not the collector, is where the
  // signal has to originate.
  backupHeartbeatPath?: string;
}): void {
  const chunksTotal = meter.createObservableGauge('ekos.corpus.chunks', {
    description: 'Chunks in the knowledge base.',
    unit: '{chunk}',
  });
  const chunksEmbedded = meter.createObservableGauge('ekos.corpus.chunks.embedded', {
    description: 'Chunks with a vector. Below ekos.corpus.chunks, retrieval is partly lexical-only; at zero, semantic search is off entirely.',
    unit: '{chunk}',
  });
  const migrationsPending = meter.createObservableGauge('ekos.db.migrations.pending', {
    description: 'Migrations on disk that this database has not recorded. Non-zero means the schema is behind the running build.',
    unit: '{migration}',
  });

  const safely = (result: ObservableResult, read: () => number, attrs?: Attributes) => {
    try {
      result.observe(read(), attrs);
    } catch {
      // A failed read must not report a number. Observing nothing leaves a gap in
      // the series, which is honest; observing 0 would fire the "no embeddings"
      // alert on what is actually a database problem.
    }
  };

  chunksTotal.addCallback((r) => safely(r, () => sources.embeddingCoverage().total));
  chunksEmbedded.addCallback((r) => safely(r, () => sources.embeddingCoverage().embedded));
  migrationsPending.addCallback((r) => safely(r, () => sources.migrationStatus().pending));

  if (sources.backupHeartbeatPath) {
    ekosBackupLastSuccess.addCallback((r) => safely(r, () => readHeartbeat(sources.backupHeartbeatPath as string)));
  }
}

// -- Backups ------------------------------------------------------------------

/**
 * Epoch seconds of the last verified backup, read from the heartbeat file
 * `deploy/backup.cjs` stamps after every successful cycle.
 *
 * This is the metric answer to "the backup subsystem logs success and failure
 * but nothing watches it". It deliberately does NOT come from the backup
 * container talking to the collector: the `backup` service in
 * docker-compose.yml runs in the default profile, but the collector's Prometheus
 * exporter is only ever scraped under `--profile observability`, and even that
 * only covers what reaches the collector, not the collector's own reachability
 * from a container that would need its own OTel SDK to push there. Making the
 * backup container instrumented would mean a second telemetry surface, on by
 * default, for a container that already has no HTTP endpoint of its own.
 *
 * Instead the signal lands where the rest of ekos.* already lands: the `ekos`
 * process (always running, always pushing OTLP whenever
 * OTEL_EXPORTER_OTLP_ENDPOINT is set — which the compose default is,
 * unconditionally) reads the heartbeat file off a volume shared read-only with
 * the backup container and reports its age. That means this gauge is live
 * whether or not the `observability` profile, Prometheus or Alertmanager are
 * running — exactly the constraint asked for — and the only thing gated behind
 * that profile is whether anything *evaluates* an alert on it locally
 * (deploy/alerts.yaml's EkosBackupStale), same as every other rule in that file.
 *
 * A stale gauge (age growing without bound) and an absent gauge (the mount is
 * missing, or the backup container never started) are both meaningful and are
 * deliberately not collapsed into one number — see EkosBackupStale's `or
 * absent_over_time(...)` clause.
 */
export const ekosBackupLastSuccess = meter.createObservableGauge('ekos.backup.last_success.timestamp', {
  description: 'Unix timestamp (seconds) of the last backup verified good by deploy/backup.cjs. Compare against time() to alert on age, not on failure count — the failure mode that matters is "stopped happening", which a failure counter cannot see once nothing runs at all.',
  unit: 's',
});

// Exported for tests. An audit pointed out that the only coverage of this path
// was a grep asserting the string `HEARTBEAT_PATH` appears in the backup script,
// which would survive any change to what this function actually does — and what
// it does is decide whether a missing or corrupt heartbeat becomes a gap in the
// series or a lying zero. Throwing is the contract: the caller wraps it and a
// throw means "no observation".
export function readHeartbeat(heartbeatPath: string): number {
  const raw = fs.readFileSync(heartbeatPath, 'utf8').trim();
  // The empty check is not redundant: Number('') is 0, and 0 is finite, so an
  // empty or truncated heartbeat would have been reported as a real reading of
  // "last succeeded at the epoch" rather than as no reading at all. That is the
  // exact lying-zero this function exists to avoid, and it survived until a test
  // asked for the empty case.
  const seconds = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(seconds)) throw new Error(`heartbeat file did not contain a number: ${JSON.stringify(raw)}`);
  return seconds;
}

/**
 * Records one AI provider call. Kept here rather than inlined at the call site so
 * the attribute set stays identical across all five providers — a histogram whose
 * label keys differ per branch cannot be aggregated, and that mistake is invisible
 * until someone tries to build the dashboard.
 */
export function recordLlmCall(args: {
  provider: string;
  model: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}): void {
  const attrs: Attributes = { provider: args.provider, model: args.model };
  llmRequests.add(1, { ...attrs, outcome: args.outcome });
  llmDuration.record(args.durationMs, { ...attrs, outcome: args.outcome });
  if (typeof args.inputTokens === 'number' && args.inputTokens > 0) {
    llmTokens.add(args.inputTokens, { ...attrs, kind: 'input' });
  }
  if (typeof args.outputTokens === 'number' && args.outputTokens > 0) {
    llmTokens.add(args.outputTokens, { ...attrs, kind: 'output' });
  }
}

/** Records one retrieval pass. See retrievalEmpty above for why the zero case is counted separately. */
export function recordRetrieval(args: { mode: string; durationMs: number; results: number }): void {
  const attrs: Attributes = { mode: args.mode };
  retrievalDuration.record(args.durationMs, attrs);
  retrievalResults.record(args.results, attrs);
  if (args.results === 0) retrievalEmpty.add(1, attrs);
}

/**
 * Normalizes the usage block each provider returns into {input, output}.
 *
 * Every provider spells this differently and two of them spell it differently from
 * each other while both claiming to be OpenAI-compatible. Isolated here, and
 * returning undefined rather than 0 for absent fields, so a provider that reports
 * no usage produces no data point instead of a false zero that would drag a
 * token-count average down.
 */
export function normalizeUsage(provider: string, payload: any): { input?: number; output?: number } {
  if (!payload || typeof payload !== 'object') return {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  if (provider === 'gemini') {
    const u = payload.usageMetadata;
    return { input: num(u?.promptTokenCount), output: num(u?.candidatesTokenCount) };
  }
  if (provider === 'anthropic') {
    const u = payload.usage;
    return { input: num(u?.input_tokens), output: num(u?.output_tokens) };
  }
  // openai, groq, and OpenAI-compatible custom endpoints
  const u = payload.usage;
  return { input: num(u?.prompt_tokens), output: num(u?.completion_tokens) };
}
