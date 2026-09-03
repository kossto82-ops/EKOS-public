/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Global application and environment configuration constants
 */
export const API_TIMEOUT_MS = 30000;
export const RETRY_ATTEMPTS = 2;
export const BACKOFF_FACTOR = 2;
export const INITIAL_DELAY_MS = 300;

/**
 * Returns the base URL for API communication depending on the environment.
 * - Dev: http://localhost:3000 (or falls back to same host if needed, but defaults to specified port)
 * - Prod: Uses the configured VITE_API_URL environment variable
 */
export function getApiBaseUrl(): string {
  const metaEnv = (import.meta as unknown as { env: Record<string, string | boolean | undefined> }).env || {};

  // In development mode, we default to empty string for relative URLs
  if (metaEnv.DEV) {
    return '';
  }

  // In production, grab VITE_API_URL from Vite's compiled environment variables
  return (metaEnv.VITE_API_URL as string) || '';
}

export type AuthMode = 'oauth' | 'legacy';

/**
 * Which authentication mode the frontend runs in. Defaults to 'legacy' — the
 * interim unsigned-id + impersonation scheme — so local development, the demo
 * and the test suite are unaffected. Set `VITE_AUTH_MODE=oauth` at build time
 * (alongside the backend's AUTH_* config) to drive the corporate BFF login:
 * the SPA then hydrates its identity from `GET /auth/me`, sends no Bearer id,
 * and redirects to `/auth/login` on a 401. See docs/AUTH_INTEGRATION_PLAN.md §2c.
 */
export function getAuthMode(): AuthMode {
  const metaEnv = (import.meta as unknown as { env: Record<string, string | boolean | undefined> }).env || {};
  return (metaEnv.VITE_AUTH_MODE as string) === 'oauth' ? 'oauth' : 'legacy';
}
