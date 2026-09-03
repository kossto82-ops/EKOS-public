# syntax=docker/dockerfile:1.7
#
# EKOS — Enterprise Knowledge Operating System
#
# SPDX-License-Identifier: Apache-2.0
#
# ---------------------------------------------------------------------------
# Read this before changing anything below: this image is NOT stateless.
#
# EKOS persists to a single SQLite file. That is a deliberate, documented choice
# (docs/DATABASE.md, docs/KNOWN_LIMITATIONS.md) and it has consequences no
# Dockerfile can paper over:
#
#   * **Exactly one container per volume.** SQLite's WAL uses POSIX advisory locks
#     that do not work across containers or over a network filesystem. Two replicas
#     on one volume do not "share" the database — they corrupt it. deploy/
#     docker-compose.yml pins the replica count to 1 for this reason.
#   * **/data must be a real volume.** Without one, the database lives on the
#     container's writable layer and is destroyed on the next `docker compose up`.
#     Nothing errors when this happens: the schema self-bootstraps, seeding runs,
#     and the service comes up healthy and empty. That is the whole reason
#     DATABASE_PATH exists (src/db/db.ts) and why it is set to /data here.
#
# The fix for both is PostgreSQL, which is on the roadmap and is not this change.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22.20.0

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
#
# better-sqlite3 is a native addon compiled by node-gyp against a specific V8 ABI.
# It therefore needs a toolchain to install, and the result is only valid for the
# exact Node major it was built against — which is why every stage below pins the
# same NODE_VERSION, and why the runtime stage copies node_modules from here
# rather than running its own install against a possibly different base.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# `npm ci` (not `install`): the lockfile is the input, and a build that silently
# resolves a different dependency tree than CI tested is not a build of this commit.
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build
#
# Produces dist/: the Vite client bundle, dist/server.cjs, and dist/otel.cjs.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .
RUN npm run build

# Second, pruned tree for the runtime stage. Installed into a separate directory
# so the full tree above (which the build still needs) is not clobbered. The native
# better-sqlite3 addon is rebuilt here against the same Node as the runtime base.
RUN mkdir -p /prod \
 && cp package.json package-lock.json /prod/ \
 && cd /prod \
 && npm ci --omit=dev \
 && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 3 — runtime
#
# No toolchain, no source, no dev dependencies. Runs as the `node` user that the
# official image already provides (uid 1000) rather than root.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# The commit this image was built from, reported as `service.version` on every
# span, metric and log record (src/server/otel.ts). Passed by CI; defaults to
# something obviously non-authoritative so a hand-built image cannot masquerade as a
# released one in the telemetry.
ARG EKOS_VERSION=unversioned-local-build
ENV EKOS_VERSION=${EKOS_VERSION}

# The mounted volume. See the header — this one being wrong fails silently.
ENV DATABASE_PATH=/data/ekos.sqlite

# dist/server.cjs is a bundle and bundles cannot embed .sql files, so the migration
# files travel as real files and the app is told where they are. This one being
# wrong is loud, not silent: initDatabase() refuses to serve on an unknown schema
# (src/db/db.ts).
ENV DRIZZLE_MIGRATIONS_DIR=/app/migrations

# tini as PID 1. Node started directly as PID 1 inherits the special init
# semantics of that pid and does NOT get the default SIGTERM behaviour, so a
# `docker stop` would sit through the full 10s timeout and then SIGKILL —
# skipping the drain-then-close-database sequence in src/server/shutdown.ts
# entirely, which is the sequence that checkpoints WAL back into the database file.
# `upgrade` before `install`, and that is a deliberate security decision rather
# than the usual Docker advice to leave the base image alone.
#
# The first Trivy scan this repository ever completed (CI had never got that far
# — see the git history around the trivy-action pin) found 11 fixable CVEs, 2 of
# them CRITICAL, every one of them a Debian package in the base image with a
# patched version already in the archive: libgnutls30 3.7.9-2+deb12u5 against a
# fixed 3.7.9-2+deb12u7, gpgv, libcap2, and so on. Nothing in this repository's
# own dependency tree; the base image simply predates those security uploads.
#
# The published node:X-bookworm-slim images are rebuilt periodically but not on
# Debian's security cadence, so pinning a newer NODE_VERSION closes today's gap
# and reopens it a few weeks later. Applying the security upgrades at build time
# tracks the archive instead of the image publisher, which is what the scan gate
# is actually asking for. The cost is that two builds of the same commit can
# differ in OS package versions — accepted here, because the alternative is
# shipping known-exploitable packages until someone notices.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Delete the package managers the base image ships. This container runs
# `node dist/server.cjs` and its healthcheck is `node -e` — npm, npx, corepack
# and yarn are never invoked, at build time or after it. The `deps` and `build`
# stages have their own copies and are unaffected.
#
# It is a vulnerability decision, not a size one. The scan reports findings
# against every package.json in the filesystem, and npm bundles a large
# dependency tree of its own:
#
#   usr/local/lib/node_modules/npm/node_modules/minimatch          3
#   usr/local/lib/node_modules/npm/.../tinyglobby/.../picomatch    1
#   opt/yarn-v1.22.22                                              ...
#
# None of it is reachable by this service, none of it is in this repository's
# dependency tree, and no change here can patch it — only a new base image can,
# on the publisher's cadence rather than the security archive's. Removing the
# tools removes the finding and the attack surface at the same time: a container
# that cannot install packages cannot be made to install one.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./migrations
COPY --from=build /app/package.json ./package.json

# Created here, with the right owner, so that a volume mounted over it inherits
# that ownership. A bind mount from the host will not — see deploy/README.md.
#
# /backups is not used by this service — it exists so that the `backup` sidecar
# in docker-compose.yml, which runs this same image against a second volume
# (deploy/backup.cjs), gets correct ownership the first time that volume is
# mounted, without needing its own toolchain or its own uid.
RUN mkdir -p /data /backups && chown -R node:node /data /backups /app
VOLUME ["/data"]

USER node
EXPOSE 3000

# Uses the liveness probe, not the readiness one, and that distinction is the whole
# point (src/server/routes/health.ts): /readyz returns 503 when a dependency is
# down, and a container that is restarted for a dependency failure drops the
# requests it was serving without fixing anything. Readiness belongs to whatever is
# routing traffic, not to the supervisor deciding whether to kill the process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# `--require ./dist/otel.cjs` must stay: the OpenTelemetry instrumentations work by
# patching modules as they load, so anything required before this file runs is
# invisible for the life of the process — including express and http, i.e. every
# request. See the header of src/server/otel.ts.
CMD ["node", "--require", "./dist/otel.cjs", "dist/server.cjs"]
