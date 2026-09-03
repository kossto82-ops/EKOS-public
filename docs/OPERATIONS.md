# Operations

What EKOS reports about itself, what is alerted on, and what is still not covered.

For *how to deploy*, see `deploy/README.md`. This document is about what you can
see once it is running.

---

## 1. The problem this is designed around

The obvious monitoring setup for a web service watches request rate, error rate and
latency. For EKOS, that setup would have been flat and green through every incident
this system has actually had.

The characteristic EKOS failure is **a 200 response containing a wrong answer**.
The retrieval pipeline is deliberately built to degrade rather than fail: with no
embedding provider, no vectors, or a failing provider, it falls back to term
matching and keeps answering. Measured on the labelled set, lexical-only retrieval
finds the right document for 5% of queries against 83% for hybrid (`docs/RAG.md`
§5.8). Every one of those requests is a 200 with a plausible, confident, wrong
answer.

So the instrumentation is weighted towards answer quality and corpus state, and the
5xx rate is present but last. See `src/server/metrics.ts` for the code.

---

## 2. What is emitted

Telemetry is OTLP only. There is no `/metrics` endpoint on the application — the
collector owns the question of where data goes, so that swapping backends is a
config change to one container rather than a change to EKOS.

**Everything below is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.** That is a
supported state, not a broken one: `npm run dev` and the test suite must not be
trying to reach a collector. The boot banner says which state the process is in.

### Traces

| Span | Source | Carries |
| --- | --- | --- |
| HTTP server spans | `instrumentation-http` | Method, route, status. Probe and Vite-asset requests are excluded — see below. |
| Express middleware/route spans | `instrumentation-express` | Which handler the time went to. |
| Outbound HTTP | `instrumentation-undici` | The AI provider calls, which are the slowest thing any request does. |
| `ai.generate` | `src/server/aiClient.ts` | `gen_ai.system`, `gen_ai.request.model`, token usage. A transport span cannot say which *model* was called. |
| `retrieval.hybrid` | `src/server/hybridRetrieval.ts` | Mode, candidate count, result count, and `ekos.retrieval.degraded_reason` — why the semantic side was skipped. |

`/healthz` and `/readyz` are deliberately not traced. A probe runs every few
seconds forever; those spans would be most of the trace volume and none of the
signal, and they would flatten every latency percentile computed over "all
requests". Probe *failures* still surface, as the readiness gauges below.

**Not recorded, on purpose:** query text, prompts, model responses, document
contents. Spans leave the network, and this corpus is real internal corporate
content.

### Metrics

| Instrument | Type | Why it exists |
| --- | --- | --- |
| `ekos.corpus.chunks` | gauge | Denominator for coverage. |
| `ekos.corpus.chunks.embedded` | gauge | **The most important number here.** At zero, semantic search is off and every answer is coming from keyword matching. |
| `ekos.retrieval.empty` | counter | Earliest observable sign of a bad reindex, a failed sync, or an embedding signature change that orphaned the stored vectors. |
| `ekos.retrieval.duration` / `.results` | histogram | Latency and result-set size, by mode. The `mode` label is what exposes a silent fallback to lexical. |
| `ekos.llm.requests` | counter | By provider, model, outcome. |
| `ekos.llm.duration` | histogram | Against the 30s hard timeout in `aiClient.ts`. |
| `ekos.llm.tokens` | counter | Input and output separately, because they are priced differently. The closest thing to a cost meter that does not require a price list that goes stale. |
| `ekos.db.migrations.pending` | gauge | Non-zero means the schema is behind the running build. |
| `ekos.backup.last_success.timestamp` | gauge | Unix seconds of the last backup `deploy/backup.cjs` verified with `quick_check`. Read from a heartbeat file on a volume shared read-only with the `ekos` process — see the comment above `ekosBackupLastSuccess` in `src/server/metrics.ts` for why this, not the backup container talking to the collector, is where the signal has to originate. Age, not a failure counter: the failure mode that matters is the backup container silently not running. |
| `http.server.*` | histogram | From the HTTP instrumentation. |
| `nodejs.eventloop.*`, GC, heap | various | This process does synchronous SQLite work and CPU-bound vector scoring on the main thread. "Is the event loop blocked" was previously unanswerable. |

Token counts are new information, not a new view of old information: `callAI`
previously pulled the text out of each provider response and discarded the `usage`
block, so AI spend was not merely unmonitored but unavailable to monitor.

### Logs

`src/server/logger.ts` is unchanged and still writes structured JSON to stdout. The
pino instrumentation attaches a second stream, so every line also goes to the OTLP
logs endpoint carrying the `trace_id` and `span_id` of the request that produced it.

stdout is kept rather than replaced: `docker logs` has to keep working when the
collector is the thing that is broken.

Secrets are redacted before either sink sees them. The instrumentation receives
lines pino has already serialized, so the `redact` configuration in `logger.ts`
applies to the exported copy too. The collector then deletes a short list of
attributes again as a backstop (`deploy/otel-collector.yaml`).

---

## 3. Probes

Unauthenticated by necessity — a load balancer has no user identity to present —
which constrains what they may say. They report *whether* each dependency is
usable, never how much data is in it. Corpus sizes stay behind
`GET /api/embeddings/status`, which requires a role.

- **`GET /healthz`** — liveness. Touches nothing external. A probe that fails
  because a dependency is down gets the container killed, which fixes nothing and
  drops in-flight requests. This is what the image's `HEALTHCHECK` uses.
- **`GET /readyz`** — readiness. Returns 503 when a required check fails
  (database, migrations) so an orchestrator pulls the instance out of rotation.
  Returns 200 with `status: "degraded"` when an optional check fails (no vectors,
  no SharePoint credentials) — serving, but not at full capability.

Readiness is deliberately **not** wired to the container supervisor. Restarting a
container does not fix an unavailable dependency.

---

## 4. Alerts

Rules are in `deploy/alerts.yaml`, grouped by what they protect:

- **Answer quality** — `EkosSemanticSearchOff` (critical), partial coverage,
  retrieval returning nothing, retrieval silently running lexical-only.
- **AI providers** — error rate, p95 latency against the 30s timeout, and an
  unexplained jump in token consumption.
- **Service** — no telemetry at all, pending migrations, 5xx rate, event-loop lag.
- **Backup** — `EkosBackupStale` (critical): no verified backup in the last 18
  hours, or the metric itself is missing entirely, which covers the container not
  running and the heartbeat mount being wrong the same way it covers a backup that
  is actually failing. This is the rule that answers the audit finding "the backup
  subsystem has no heartbeat" — see the comment above it in `deploy/alerts.yaml`.

Two honest caveats, also stated in the file itself:

1. **The thresholds for empty-retrieval rate and token spike are starting points,
   not measured ones.** Nobody knows what the normal baseline is, because until now
   it was not recorded. They should be revisited once there are two weeks of data.
2. **Nothing notifies a person as shipped.** `deploy/alertmanager.yml`'s default
   receiver, `local-log-sink`, is a webhook to a container
   (`deploy/alert-sink.js`) that logs whatever it receives to its own stdout —
   this replaced the previous null receiver, so rules now reach *something* and an
   operator can watch delivery happen with `docker compose logs -f alert-sink`.
   But a log is not a notification. Rules fire, appear in the UI, land in that
   log, and reach no human until a real destination (Slack/Teams webhook, email,
   PagerDuty) is configured — see `deploy/README.md`.

---

## 5. What is still missing

- **No external uptime check.** Every alert is evaluated from telemetry the app
  pushes; if the VM is down, the alerts go quiet rather than firing. A check from
  outside this host is the missing half.
- **Backups are scheduled, retained, watched, and restore has been exercised in
  CI — but still not off-host by default, and the CI half is new.** That claim
  was written when the compose test was written, and the test did not actually
  run until 2026-08-07 (ADR 038). Its first execution found the `backup` service
  crash-looping on startup: it had never produced a snapshot under compose at
  all, in any deployment, while this document said it ran every six hours. Read
  the rest of this item as true since that date and unverified before it. The
  `backup` service
  (`deploy/backup.cjs`, `deploy/docker-compose.yml`) takes an online SQLite
  backup on an interval, verifies it with `quick_check`, prunes old copies, and
  stamps a heartbeat the `ekos` process reports as `ekos.backup.last_success.timestamp`
  (see above) — `EkosBackupStale` alerts on that gauge's age, which is the piece
  that was missing before. What it writes to, `ekos-backups`, is a second named
  volume on the *same* VM as the database it protects; a host loss takes both
  with it. `BACKUP_OFFHOST_URL` closes that gap when set (an HTTP PUT to an
  S3-style presigned URL or your own receiver) and is unset by default, in which
  case every backup cycle says so in its own logs rather than looking finished
  while quietly not being one. **This off-host gap is the part that remains
  unclosed** — a heartbeat and a CI restore check both prove the on-host copy is
  real and openable; neither one moves it off this VM.
- **No traces or logs backend by default.** Metrics have somewhere to land;
  traces and logs go to the collector's debug exporter and are dropped until a
  backend is configured.
- **No dashboards.** The metrics support them; none are committed, because a
  dashboard encodes what a specific team wants to look at.
- **No SLOs.** There is no error budget and no latency objective to burn against,
  which means alert thresholds are absolute rather than derived from a target.
- **Single-node everything.** The app, its database and (under the
  `observability` profile) its metrics store are all on one VM. That store is
  useless for diagnosing that VM being down.
- **Client-side telemetry is still a seam.** `src/utils/telemetry.ts` emits a
  structured `console.error` and nothing collects it; browser errors are not
  correlated with server traces. See `docs/KNOWN_LIMITATIONS.md`.
