/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auth mode + corporate OAuth2 authorization-server configuration.
 *
 * See docs/AUTH_INTEGRATION_PLAN.md. The mode is deliberately `legacy` unless
 * OAuth is explicitly configured, so local development, the demo, and the
 * existing test suite keep working against the interim unsigned-id scheme
 * without any environment set. The moment real client credentials exist (or
 * AUTH_MODE=oauth is forced), the backend validates every caller's token by
 * introspection against the corporate authorization server instead.
 *
 * Config is read from process.env on each call — cheap, and lets tests flip the
 * mode between cases without a module-cache reset.
 */

export type AuthMode = "legacy" | "oauth";

export interface AuthConfig {
  mode: AuthMode;
  /** Base URL of the corporate authorization server, e.g. `.../authorization/v1`. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** How long an introspection result may be cached, in ms (capped by token exp). */
  introspectionTtlMs: number;
  /** Per-request timeout for the two upstream auth calls, in ms. */
  requestTimeoutMs: number;
  /** redirect_uri registered with the auth server; where /oauth/authorize returns to. */
  callbackUrl: string;
  /** Where the browser is sent after a successful login (the SPA). Same-origin. */
  postLoginRedirect: string;
  /** OAuth scopes requested at authorize time. */
  scopes: string;
}

// Default to the Test environment (docs/AUTH_INTEGRATION_PLAN.md §3) so a
// half-configured setup can never silently point at Live.
const DEFAULT_TEST_BASE_URL = "https://rest.tsrv.northwind.internal/authorization/v1";

export function getAuthConfig(): AuthConfig {
  const baseUrl = (process.env.AUTH_BASE_URL || DEFAULT_TEST_BASE_URL).replace(/\/+$/, "");
  const clientId = process.env.AUTH_CLIENT_ID || "";
  const clientSecret = process.env.AUTH_CLIENT_SECRET || "";

  // OAuth is on when explicitly forced, or when a full client credential pair is
  // present. Anything short of that stays in the interim legacy mode.
  const forced = (process.env.AUTH_MODE || "").toLowerCase() === "oauth";
  const hasClientCreds = clientId !== "" && clientSecret !== "";
  const mode: AuthMode = forced || hasClientCreds ? "oauth" : "legacy";

  const origin = (process.env.ALLOWED_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");

  return {
    mode,
    baseUrl,
    clientId,
    clientSecret,
    introspectionTtlMs: Number(process.env.AUTH_INTROSPECTION_TTL_MS) || 60_000,
    requestTimeoutMs: Number(process.env.AUTH_REQUEST_TIMEOUT_MS) || 5_000,
    callbackUrl: process.env.AUTH_CALLBACK_URL || `${origin}/auth/callback`,
    postLoginRedirect: process.env.AUTH_POST_LOGIN_REDIRECT || `${origin}/`,
    scopes: process.env.AUTH_SCOPES || "read write",
  };
}
