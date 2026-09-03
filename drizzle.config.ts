/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration — used by `npm run db:generate` to diff
 * `src/db/schema.ts` against the existing migrations and emit the SQL for the
 * difference.
 *
 * Migrations are applied at startup by `initDatabase()` (src/db/db.ts), not by
 * drizzle-kit: `drizzle-kit push` is deliberately NOT part of any script here,
 * because it mutates a database to match the schema without leaving a recorded,
 * reviewable migration — which is the exact problem this replaces.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    // `DATABASE_PATH` is the variable the server itself reads (src/db/db.ts), so
    // it is honoured here too — otherwise `db:check` would inspect the repo-root
    // file while the running instance served one from a mounted volume, and the
    // two could disagree without anything saying so. `DATABASE_URL` is kept as the
    // higher-precedence override for pointing the generator at a scratch copy.
    url: process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? 'db.sqlite',
  },
  // Every schema change should be a reviewed file, so keep the generator strict
  // about what it emits and never let it silently drop data.
  strict: true,
  verbose: true,
});
