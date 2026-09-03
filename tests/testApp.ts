/**
 * Isolated Express app for tests: same routers as server.ts, but backed by
 * an in-memory SQLite instance (see src/db/db.ts's NODE_ENV==='test' branch)
 * and with no Vite middleware / app.listen. Never import server.ts directly
 * in tests — it starts a real server on a real port.
 */
import express from 'express';
import type { Express } from 'express';
import { initDatabase } from '../src/db/db.ts';
import { seedDatabase } from '../src/db/seed.ts';
import { router as aiRoutes } from '../src/server/routes/ai.ts';
import { router as documentsRoutes } from '../src/server/routes/documents.ts';
import { router as sourcesRoutes } from '../src/server/routes/sources.ts';
import { router as syncRoutes } from '../src/server/routes/sync.ts';
import { router as governanceRoutes } from '../src/server/routes/governance.ts';
import { router as brandsRoutes } from '../src/server/routes/brands.ts';
import { router as healthRoutes } from '../src/server/routes/health.ts';
import { router as authRoutes } from '../src/server/routes/auth.ts';
import { apiNotFound, errorHandler, requestId } from '../src/server/middleware/errors.ts';

let initialized = false;

export function createTestApp(): Express {
  if (!initialized) {
    initDatabase();
    initialized = true;
  }

  const app = express();
  // Same middleware order as server.ts (correlation id → body parser → routers →
  // API 404 → error handler), so tests exercise the real request/failure path.
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  // Unauthenticated liveness/readiness, mounted above the guarded routers exactly
  // as in server.ts.
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(aiRoutes);
  app.use(documentsRoutes);
  app.use(sourcesRoutes);
  app.use(syncRoutes);
  app.use(governanceRoutes);
  app.use(brandsRoutes);
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}

export async function seedTestDatabase(): Promise<void> {
  await seedDatabase();
}

/** Builds the Authorization header requireUser (src/server/middleware/auth.ts) expects. */
export function authHeader(userId: string): [string, string] {
  return ['Authorization', `Bearer ${userId}`];
}
