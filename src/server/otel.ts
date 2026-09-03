/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenTelemetry bootstrap. **Loaded before the application**, via
 * `node --require ./dist/otel.cjs dist/server.cjs` (see package.json's `start`
 * and the image's CMD).
 *
 * Why `--require` and not just an import at the top of server.ts: the
 * instrumentations below work by patching modules as they are `require`d. Anything
 * loaded before this file runs is loaded unpatched and is invisible forever —
 * including `express` and `http`, i.e. every request. An import inside server.ts
 * would put the ordering at the mercy of how the bundler hoists external requires,
 * which is not a property to bet observability on.
 *
 * ## What this file is for, and what it is not
 *
 * Before this, the server logged structured JSON to stdout and that was the whole
 * of its observability. Which is to say: none, in operation. stdout on a container
 * that gets replaced on the next deploy is not a record. There was no way to ask
 * "how slow is search at p95", "is the Gemini quota erroring", or "did the last
 * release make retrieval worse" other than reading lines as they scrolled past.
 *
 * This file only *emits*. Where the data lands is the collector's business
 * (deploy/otel-collector.yaml), which is deliberate: EKOS should not know or care
 * whether the backend is Grafana, Datadog, Azure Monitor or a file. Swapping it is
 * a collector config change, not an application change.
 *
 * ## Off unless told otherwise
 *
 * With no `OTEL_EXPORTER_OTLP_ENDPOINT` set, this is a no-op: no SDK, no exporters,
 * no background timers, no connection attempts. That is not laziness — a developer
 * running `npm run dev` and a `vitest` process must not be trying to POST spans to
 * a collector that isn't there, retrying, and printing export failures over the
 * output the developer is actually reading. Production sets the variable; nothing
 * else has to.
 */

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';

/** Endpoints that a probe hits every few seconds forever. */
const PROBE_PATHS = new Set(['/healthz', '/readyz']);

/**
 * Paths that must not become spans.
 *
 * The probes are excluded because they are, by volume, most of the traffic this
 * process ever sees and none of it is interesting: a liveness check that returns
 * 200 in under a millisecond, forever, would be the overwhelming majority of the
 * trace bill and would flatten every latency percentile computed over "all
 * requests". Their *failures* still surface — as `/readyz` returning 503, which is
 * an alert rule over the readiness gauge (deploy/alerts.yaml), not something you
 * want to find by reading traces.
 *
 * In development, Vite serves every source module through this same Express app;
 * a page load is hundreds of requests for .tsx files. Those are excluded for the
 * same reason the access log excludes them (src/server/logger.ts).
 */
export function shouldIgnoreRequest(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  if (PROBE_PATHS.has(path)) return true;
  if (path.startsWith('/@vite') || path.startsWith('/@react-refresh') || path.startsWith('/@fs')) return true;
  if (path.startsWith('/node_modules/')) return true;
  if (path.startsWith('/src/') && /\.(tsx?|jsx?|css|svg|png|woff2?)$/.test(path)) return true;
  return false;
}

/**
 * Whether telemetry should start at all, and where it should send.
 *
 * Exported so a test can assert the enable/disable decision without booting an SDK
 * — the whole point of the switch is that the disabled path does nothing, and
 * "does nothing" is only worth trusting if something checks it.
 */
export function telemetryConfig(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  endpoint: string | null;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  reason?: string;
} {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null;
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || 'ekos-api';
  const serviceVersion = env.EKOS_VERSION?.trim() || '0.0.0-dev';
  const environment = env.NODE_ENV ?? 'development';

  if (env.NODE_ENV === 'test') {
    return { enabled: false, endpoint, serviceName, serviceVersion, environment, reason: 'NODE_ENV=test' };
  }
  if (env.OTEL_SDK_DISABLED === 'true') {
    return { enabled: false, endpoint, serviceName, serviceVersion, environment, reason: 'OTEL_SDK_DISABLED=true' };
  }
  if (!endpoint) {
    return { enabled: false, endpoint, serviceName, serviceVersion, environment, reason: 'OTEL_EXPORTER_OTLP_ENDPOINT is unset' };
  }
  return { enabled: true, endpoint, serviceName, serviceVersion, environment };
}

/**
 * The started SDK, held on a global symbol rather than in a module variable.
 *
 * This module is legitimately loaded twice in production: once by `--require
 * ./dist/otel.cjs`, and again as part of dist/server.cjs, because server.ts imports
 * `telemetryConfig`/`stopTelemetry` from it and esbuild inlines it into that
 * bundle. Those are two distinct module instances with two distinct module scopes,
 * so a plain `let sdk` would not stop the second load from starting a second SDK —
 * with a second metric reader exporting the same instruments on its own timer, i.e.
 * silently doubled counters. A global is the only scope both instances share.
 */
const SDK_KEY = Symbol.for('ekos.otel.sdk');
const globalRef = globalThis as unknown as Record<symbol, NodeSDK | null | undefined>;

export function startTelemetry(env: NodeJS.ProcessEnv = process.env): NodeSDK | null {
  if (globalRef[SDK_KEY]) return globalRef[SDK_KEY]!;

  const config = telemetryConfig(env);
  if (!config.enabled) return null;

  // The SDK's own failures are otherwise silent: a wrong endpoint or an
  // unreachable collector produces no spans and no complaint, which is
  // indistinguishable from a healthy, idle service. Errors go to the console
  // rather than to `logger`, because pino is instrumented below and routing the
  // exporter's own errors back through an instrumented logger invites a loop.
  diag.setLogger(new DiagConsoleLogger(), env.OTEL_LOG_LEVEL === 'debug' ? DiagLogLevel.DEBUG : DiagLogLevel.ERROR);

  const base = config.endpoint!.replace(/\/$/, '');

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      // Not yet a stable semantic-convention constant in this version, so written
      // out — the string is the one every backend groups by.
      'deployment.environment.name': config.environment,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      // 15s rather than the 60s default: the alert rules in deploy/alerts.yaml
      // evaluate over 5-minute windows, and a 60s export interval gives them five
      // samples to work with, which is too few for a rate to be meaningful.
      exportIntervalMillis: Number(env.OTEL_METRIC_EXPORT_INTERVAL_MS) || 15_000,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }) }),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => shouldIgnoreRequest(req.url),
      }),
      new ExpressInstrumentation(),
      // The AI provider calls in aiClient.ts go out through global `fetch`, which
      // is undici. Without this, the single slowest thing a search request does —
      // waiting on an LLM — is a gap in the trace with no explanation.
      new UndiciInstrumentation(),
      // Two jobs, both wanted. It stamps trace_id/span_id onto every pino line —
      // which is what makes a log line and the request that produced it one story
      // rather than two — and it also ships those lines to the OTLP logs endpoint.
      //
      // Note on secrets: it works by adding a second stream to the existing pino
      // logger, so it receives lines that pino has already serialized, i.e. already
      // passed through the `redact` config in src/server/logger.ts. An `apiKey`
      // that would be censored on stdout is censored here too, before anything
      // leaves the network. That ordering is the reason this is preferred over a
      // separate OTLP transport, which would have been a second sink to keep in
      // sync with that redaction list — and a second place to forget.
      new PinoInstrumentation(),
      // Event loop lag, GC pauses, heap. This process does synchronous SQLite work
      // and CPU-bound vector scoring on the main thread; when it gets slow, "is the
      // event loop blocked" is the first question and there was no way to answer it.
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();
  globalRef[SDK_KEY] = sdk;

  return sdk;
}

/**
 * Flush and stop. Called from the shutdown sequence in server.ts, and by tests.
 *
 * Shutting the SDK down is what flushes the pending batches — which are precisely
 * the batches holding whatever just went wrong. Without it, the last few seconds
 * before a crash or a redeploy are the ones you cannot see.
 */
export async function stopTelemetry(): Promise<void> {
  const sdk = globalRef[SDK_KEY];
  if (!sdk) return;
  globalRef[SDK_KEY] = null;
  try {
    await sdk.shutdown();
  } catch {
    /* exiting anyway — never block process exit on an exporter */
  }
}

// Side effect on load — this module exists to be `--require`d.
startTelemetry();
