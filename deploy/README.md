# Deploying EKOS

Single VM, Docker Compose. Everything here assumes one host running one instance —
see [Why one instance](#why-one-instance) before planning anything else.

## What you need

- Docker Engine 24+ with the Compose plugin
- A `.env` file at the repository root (`cp .env.example .env` and fill it in)
- Somewhere for telemetry to go, eventually — see [Telemetry](#telemetry)

## Start it

```bash
cd deploy && docker compose up -d --build
```

The app is published on `127.0.0.1:3000` by default, i.e. **loopback only**. It
speaks plain HTTP and has no TLS termination of its own; put a reverse proxy in
front of it before exposing it to anything. Set `EKOS_BIND=0.0.0.0` only once
something else is terminating TLS and enforcing the security headers that
`docs/KNOWN_LIMITATIONS.md` lists as gateway-layer responsibilities.

With a local metrics backend and executable alert rules:

```bash
cd deploy && docker compose --profile observability up -d --build
```

## Required configuration

| Variable | Required | What breaks without it |
| --- | --- | --- |
| `ENCRYPTION_SECRET` | **Yes, in production** | The process refuses to start. This is deliberate (`src/server/crypto.ts`): the fallback is a key written in the source, and stored provider API keys encrypted with it are not confidential. |
| `ALLOWED_ORIGIN` | Effectively yes | Defaults to `http://localhost:3000`. If the browser reaches EKOS on any other origin, CORS rejects the SPA's own API calls and the UI loads but does nothing. |
| `GEMINI_API_KEY` / provider key | For AI features | Search and the assistant return errors. Retrieval and the knowledge base still work. |
| `SP_*` | No | SharePoint sync is skipped and the ingested snapshot is served instead. `/readyz` reports this as degraded-but-serving. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Telemetry is off entirely. The compose file sets it to the bundled collector. |
| `BACKUP_OFFHOST_URL` | No, but see [Backups](#backups) | Scheduled backups still run and retain, but stay on this host — not an off-host backup. |
| `ALERTMANAGER_WEBHOOK_URL` | No, and only under `--profile observability` | Alerts still fire and log locally via `alert-sink`, but reach no person. |

## Why one instance

EKOS stores everything — documents, chunks, vectors, governance decisions — in one
SQLite file. SQLite coordinates concurrent access using POSIX advisory locks, which
are local to a host and do not work across containers or over a network filesystem.

Two instances pointed at the same volume do not take turns. They interleave writes
and corrupt the database, and they do it without an error. So:

- `deploy.replicas` is `1` in `docker-compose.yml` and must stay there.
- The volume cannot be NFS, SMB, EFS or any other network mount.
- Scaling is vertical only, until the PostgreSQL migration on the roadmap lands.

`tests/deployment.test.ts` asserts the replica count so this cannot be raised by
accident.

## The volume

`ekos-data:/data` holds the entire knowledge base. Two ways to lose it, both quiet:

**Forgetting the volume.** Without it the database lives on the container's
writable layer and disappears on the next `up`. Nothing errors — the schema
self-bootstraps, seeding runs, and the service reports healthy and empty. If a
deployment comes back with a suspiciously small corpus, check this first.

**Bind-mounting from the host without fixing ownership.** The container runs as uid
1000 (`node`). A bind mount arrives owned by the host user and the mismatch surfaces
as `SQLITE_CANTOPEN` at startup. Named volumes inherit the image's ownership and do
not have this problem, which is why the default is a named volume. If you need a
bind mount for backups:

```bash
sudo chown -R 1000:1000 /srv/ekos-data
```

### Backups

**This now runs itself, on this host. It does not, by itself, get the copy off
this host.** That second part matters — read to the end of this section before
treating backups as solved.

`docker-compose.yml` has a `backup` service (`deploy/backup.cjs`) that runs
regardless of the `observability` profile, because the single volume it protects
is the only copy of the corpus. On an interval (`BACKUP_INTERVAL_SECONDS`,
default 6 hours) it takes the same online backup this section used to tell a human
to type by hand — SQLite's own `.backup()` against `DATABASE_PATH`, which is safe
against a live, concurrently-written database, unlike copying the file directly
and risking a half-written write-ahead log — gzips the result, prunes down to
`BACKUP_RETENTION_COUNT` copies (default 28, about a week at the default
interval), and writes to the `ekos-backups` named volume.

It opens the database with `{ readonly: true }`, which is what stops this
container writing it — SQLite refuses writes at the statement level. The
`ekos-data` mount itself is **not** `:ro`, and must not be made `:ro`: the
database runs in WAL mode, and SQLite cannot open a WAL database for reading
without write access to its `-shm` wal-index, or to the directory when that file
does not exist yet. Adding `:ro` reads like hardening and instead fails every
cycle with `SQLITE_CANTOPEN`. `tests/deployment.test.ts` asserts both halves so
the swap cannot be made by accident.

**`ekos-backups` is a second volume on the same VM as `ekos-data`.** A copy on a
second volume on one host is not an off-host backup — it shares that host's disk,
datacenter and account, and losing the host loses both volumes together. Set
`BACKUP_OFFHOST_URL` to close that gap: a URL this process can HTTP PUT the
gzipped backup to (an S3-compatible presigned URL, an Azure Blob SAS URL, a GCS
signed URL, or an HTTPS receiver you run yourself). Node's built-in `fetch` does
the PUT; no cloud CLI or SDK is baked into the image. Leave it unset and the
`backup` service still runs, still schedules, still retains — every cycle just
says so in its own logs (`docker compose logs backup`), rather than a service that
looks finished and is not.

Back up `.env` separately from `BACKUP_OFFHOST_URL`, and keep the two together
wherever they end up: without `ENCRYPTION_SECRET`, the provider API keys in a
restored database are undecryptable ciphertext, not merely inaccessible. The
`backup` container does not have `.env` mounted and cannot do this for you.

The manual procedure below still works if you need a one-off backup, or a
restore verification copy, without waiting for the next scheduled run:

```bash
docker compose exec ekos node -e "
  const D = require('better-sqlite3');
  new D('/data/ekos.sqlite', { readonly: true }).backup('/data/backup.sqlite');
"
```

#### Backups now have a heartbeat

Every verified cycle stamps the current time into a heartbeat file on the
`ekos-backups` volume. `docker-compose.yml` mounts that same volume read-only
into the `ekos` service (at `/backup-status`, separate from the backup
service's own `/backups` — this container has no business reading the archives
themselves), and the app reports its age as `ekos.backup.last_success.timestamp`
(`src/server/metrics.ts`). `deploy/alerts.yaml`'s `EkosBackupStale` fires if that
age passes 18 hours (3x the default interval) or the metric is missing
altogether, which is the same rule covering both "backups are failing" and
"backups stopped running entirely" — the second one is the failure mode that
actually matters and the one a failure counter cannot see.

This works with plain `docker compose up`, no `--profile observability`
required, because the metric is reported by the `ekos` process itself over the
same OTLP path every other `ekos.*` metric already uses — the collector runs in
the default profile. What *does* need `--profile observability` is anything
that evaluates `EkosBackupStale` and shows it in a UI: Prometheus and
Alertmanager. Without that profile the number still exists (visible via your
own OTLP backend, if `OTLP_BACKEND_ENDPOINT` is set) and simply has nothing
local evaluating it — the same as every other rule in `alerts.yaml`.

#### Restoring from a backup

Nobody had verified any of these archives could actually be opened again until
CI started doing it (see `.github/workflows/ci.yml`, the `image` job's compose
step) — a backup nobody has restored is a hypothesis, not a control. That CI
step gunzips the most recent archive the `backup` service produced and opens it
read-only with the same `better-sqlite3` build the image ships, then asserts the
`kb_documents` table is present. It does **not** exercise restoring into a
*running* deployment, wiring the result back into `ekos-data`, or restarting the
app against it — that sequence has never run anywhere, including in CI, and is
the residual risk this section exists to name rather than to hide.

To restore a backup by hand, onto the running deployment:

```bash
# 1. Stop the app so nothing writes to ekos-data while you replace it.
docker compose stop ekos

# 2. Decompress the archive you want into the ekos-data volume, using a
#    throwaway container so you don't need Docker CLI access to the volume's
#    host path (which may not exist — see "The volume" above).
docker run --rm \
  -v ekos-backups:/backups:ro \
  -v ekos-data:/data \
  node:22-bookworm-slim \
  bash -c "gunzip -c /backups/<the-archive>.sqlite.gz > /data/ekos.sqlite"

# 3. Bring the app back up. initDatabase() runs migrations against the restored
#    file at startup and refuses to serve if that fails — a schema mismatch
#    between the backup and the running build surfaces immediately, not as a
#    later corruption.
docker compose start ekos
docker compose logs -f ekos
```

Restoring loses everything written after the backup you chose — there is no
point-in-time recovery narrower than `BACKUP_INTERVAL_SECONDS`. And restoring
the database without also restoring the matching `.env`/`ENCRYPTION_SECRET`
leaves the provider API keys in it as undecryptable ciphertext — see above.

## Upgrading

```bash
EKOS_IMAGE=ghcr.io/kossto82-ops/ekos:sha-<commit> docker compose up -d
```

Pin the `sha-` tag, not `latest`. During an incident the first question is what is
actually running, and `latest` cannot answer it. CI publishes both on every push to
`main` (`.github/workflows/ci.yml`).

Migrations apply at startup and the process refuses to serve on a schema it does
not recognise, so a bad migration fails the container rather than corrupting data.
There is **no automatic rollback** — redeploy the previous `sha-` tag, and note that
a migration that already applied is not undone by doing so.

## Telemetry

The app pushes OTLP to the collector. The collector decides where that goes, and
**by default it does not send traces or logs anywhere** — read the warning at the
top of `otel-collector.yaml`. Metrics are the exception: they are exposed for
Prometheus to scrape, and the `observability` profile runs one.

To point it at a real backend, uncomment the `otlphttp/backend` exporter in
`otel-collector.yaml`, add it to the three pipelines, and set:

```bash
OTLP_BACKEND_ENDPOINT=https://otlp.example.com
OTLP_BACKEND_HEADERS="authorization=Bearer <token>"
```

Grafana Cloud, Honeycomb, Datadog's OTLP intake and a second collector all work
unchanged. The application is never rebuilt for any of this.

### Alerts

`alerts.yaml` holds the rules; `alertmanager.yml` decides who hears them. The
default receiver is `local-log-sink`, a webhook to the `alert-sink` container
(`deploy/alert-sink.js`) that logs whatever it receives — inspect it with
`docker compose --profile observability logs -f alert-sink`. That replaces the
null receiver this used to route to, so every rule in `alerts.yaml` now reaches
something and an operator can watch an alert arrive, instead of it firing into
nothing.

**This still notifies no one.** `local-log-sink` is a local log, not a person.
Filling in a real destination is still a deliberate, manual step: uncomment one of
the receivers in `alertmanager.yml`, point `route.receiver` (and the critical
route) at it, and — for a webhook — set `ALERTMANAGER_WEBHOOK_URL` in `.env`
(consumed via the `--config.expand-env` flag on the `alertmanager` command, so the
URL is never pasted into a tracked file). This repository cannot know your on-call
address and will not invent one, so the alerting axis is not finished until that
step is taken.

`docs/OPERATIONS.md` explains what is measured and why those particular things.

### One thing this cannot watch

Every alert here is evaluated from telemetry the app pushes. If the VM is down, the
app is down, or the network path to the collector is broken, the alerts do not fire
— they go silent, which `EkosNoTelemetry` turns into an alert of its own, but only
if Prometheus itself is still running, which it is not if the VM is the thing that
failed. An external uptime check against `/healthz`, from somewhere that is not this
host, is the missing half and is not something this repository can provide.
