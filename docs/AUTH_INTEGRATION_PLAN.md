# Authentication Integration Plan — Corporate OAuth2 / OIDC

**Owner:** Security Engineering / Core Backend Engineering
**Status:** Design — approved for phased implementation, Test environment first
**Last Updated:** 2026-08-13
**Implements:** [KNOWN_LIMITATIONS.md §5 → Security → OAuth2 / OIDC Integration](./KNOWN_LIMITATIONS.md) (Sprint 1) and the residual half of *Server-Side RBAC Enforcement* (Sprint 2).
**Supersedes nothing** — this is the concrete recipe for the item both `SECURITY.md §1` and `KNOWN_LIMITATIONS.md` have described only in the abstract.

---

## 1. Why this document exists

The single security item gating any network-reachable deployment of EKOS is authentication.
Everything else on the hardening roadmap is either landed or DevOps-owned; this is not.

Today (see the callout in [KNOWN_LIMITATIONS.md §4](./KNOWN_LIMITATIONS.md) and
[SECURITY.md §1](./SECURITY.md)):

- The backend requires `Authorization: Bearer <id>` on every `/api/*` route and re-runs
  the full RBAC matrix server-side (`src/server/middleware/auth.ts` + `src/utils/rbac.ts`).
  This is real and stays.
- But `<id>` is an **unsigned user id** (`u1`, `u_admin_rrc`, …) resolved against
  `src/constants/users.ts`. Anyone who knows or guesses a valid id impersonates that user.

The remaining work is therefore **narrow and well-defined**: replace the unsigned id with a
cryptographically verified session issued after a real corporate login. The RBAC layer does
not change — only *how we trust the identity that feeds it*.

---

## 2. Key architectural finding — opaque tokens, not RS256 JWTs

`SECURITY.md §1` states the target token format as "cryptographically signed JWT (RS256)".
That is the generic enterprise template. **The actual corporate authorization server does
not issue JWTs.** Per `coding-guidelines/Rules/guidelines/apis/authentication-server.md`, it
issues **opaque bearer tokens** (UUID-shaped, e.g. `91523e29-a7d4-4127-b41b-6d458fb1a974`)
backed by Active Directory (LDAP) with 2FA.

Consequences for the design:

- **We cannot verify a token by checking a local signature.** There is no public key / JWKS.
- **Validation is via token introspection:** `POST /oauth/check_token` returns
  `{ active, exp, user_name, authorities, client_id, scope }`. Identity comes from
  `GET /userdetails`.
- Introspection is a network round-trip per validated token, so it **must be cached**
  (short TTL, bounded, keyed by token) or every EKOS request becomes two upstream calls.
- The `SECURITY.md §1` wording should be reconciled in a follow-up edit: the guarantee EKOS
  actually provides is "server-verified session backed by AD + 2FA via OAuth2 introspection",
  not "RS256 JWT". Functionally equivalent for our threat model (spoofing), different mechanism.

---

## 3. Corporate auth server — the surface we integrate against

Base URLs (integrate against **Test first**):

| Env  | Base                                              |
| :--- | :------------------------------------------------ |
| Test | `https://rest.tsrv.northwind.internal/authorization/v1`    |
| Live | `https://rest.northwind.internal/authorization/v1` |

Endpoints used:

| Endpoint                | Method | Used for                                                        |
| :---------------------- | :----- | :-------------------------------------------------------------- |
| `/oauth/authorize`      | GET    | Browser redirect to the corporate login page (starts the flow). |
| `/oauth/token`          | POST   | Exchange authorization code → tokens; refresh. Requires `Authorization: Basic base64(client_id:client_secret)`. |
| `/oauth/check_token`    | POST   | Introspect an access token (`active`, `exp`, `user_name`, …).   |
| `/userdetails`          | GET    | `{ username, email, authorities, enabled }` for the token.      |
| `/permissions/check`    | POST   | *(Phase 4, optional)* entity-level ACL in CNF — only if EKOS ever needs per-entity permissions beyond role/department RBAC. |

Client registration required from the auth-server team (do **not** reuse the `cline`
credentials from the MCP doc — those are for the developer LLM proxy, and that doc leaks its
secret in plain text):

- A **dedicated `ekos` client_id + client_secret**, per environment.
- Grant types: `authorization_code`, `refresh_token`.
- Redirect URI: the backend callback, e.g. `https://<ekos-host>/auth/callback`
  (and `http://localhost:<port>/auth/callback` for Test/dev).
- Scopes: `read write`.

---

## 4. Target architecture — Backend-for-Frontend (BFF)

The React SPA never holds an OAuth token. The Express backend runs the OAuth flow, holds the
tokens server-side, and hands the browser only an `httpOnly` session cookie.

```
Browser (React SPA)            EKOS backend (BFF)              Corporate auth server
      │  GET /auth/login             │                          (AD/LDAP + 2FA)
      ├─────────────────────────────>│  302 → /oauth/authorize   │
      │                              │   (state + PKCE challenge) │
      │<─────────────── 302 ─────────┤                            │
      │  ...corporate login + 2FA (on the auth server's own page)─┼──────────────>│
      │<──────────── 302 /auth/callback?code=…&state=… ───────────┤
      ├─────────────────────────────>│  POST /oauth/token         │
      │                              ├───(Basic client:secret,───>│
      │                              │    code + PKCE verifier)    │
      │                              │<──── access + refresh ──────┤
      │                              │  store tokens server-side,  │
      │                              │  set httpOnly session cookie│
      │<──── 302 / (Set-Cookie) ─────┤                            │
      │                              │                            │
      │  GET /api/... (cookie)       │  validate session →        │
      ├─────────────────────────────>│  attach identity → RBAC    │
```

**Why BFF and not tokens-in-the-SPA:**

- Satisfies `SECURITY.md §3` — no raw secret/token in `localStorage`/`sessionStorage`.
- The token never crosses into JS the browser runs, so XSS cannot exfiltrate it.
- Session cookie `SameSite=Lax|Strict` + `Secure` + `httpOnly` closes CSRF without adding a
  CSRF-token dance (there are no cookie-authenticated cross-site form posts).
- Keeps the `client_secret` where it belongs — the backend only.

**Session store:** server-side, keyed by an opaque session id in the cookie. For the current
single-node SQLite deployment a `sessions` table (Drizzle migration) is the least-surprising
fit and survives restart; swap for Redis when the app goes multi-node (matches the
PostgreSQL/scale items already on the roadmap). The stored record holds the corporate
`access_token`, `refresh_token`, `exp`, and the resolved EKOS identity.

---

## 5. Identity → EKOS RBAC mapping

RBAC (`src/utils/rbac.ts`) is unchanged. What changes is the source of the identity object it
consumes. Today `requireUser` looks up `INITIAL_USERS` by id; after this work it resolves the
session's corporate `user_name` to an EKOS user/role/department.

Mapping strategy (decision needed — see §9):

1. **Directory-mapped (preferred, longer):** a `user_directory` table maps corporate
   `user_name` → `{ role, departmentIds, brandId }`, seeded from `INITIAL_USERS` and
   maintained by admins via the existing `manage_users` capability.
2. **Claims-mapped (faster to ship):** derive role/department from the auth server's
   `authorities` array (`ROLE_USER`, etc.) via a translation table. Cheaper, but couples EKOS
   roles to AD group naming we don't control.

Either way: a successfully authenticated corporate user with **no EKOS mapping** must fail
closed — authenticated ≠ authorized. Recommended default is `Agent`-equivalent least
privilege *only if* product explicitly wants auto-provisioning; otherwise deny with a clear
"no EKOS access provisioned" message.

---

## 6. Phased plan

### Phase 0 — Hygiene *(done 2026-08-13)*
- `ENCRYPTION_SECRET` rotated from the smoke-test value to a strong random secret in `.env`.
- Verified `.env` was never git-tracked and `gsk_` never entered history.
- **Open action (owner: you):** rotate `GROQ_API_KEY` at the Groq console — the working-tree
  value is real and was exposed; not a git leak, but rotate to be safe.

### Phase 1 — Backend token validation (the core) — *landed 2026-08-13*
- **Dual-mode auth** (`src/server/auth/config.ts`): `legacy` (unsigned id, the default so
  local dev / demo / pre-IdP keep working) vs `oauth` (activated by `AUTH_CLIENT_ID` +
  `AUTH_CLIENT_SECRET`, or `AUTH_MODE=oauth`). Defaults to the Test base URL.
- `src/server/auth/introspect.ts`: `POST /oauth/check_token` + `GET /userdetails`, with a
  short-TTL bounded cache (capped by token `exp`) and fail-closed on
  `active:false`/expired/disabled/non-2xx/timeout/malformed.
- `src/server/auth/identityMap.ts`: corporate `user_name` → EKOS `PortalUser` (provisional —
  explicit overrides + email-local-part heuristic; unmapped ⇒ caller fails closed with 403).
- `src/server/middleware/auth.ts` `requireUser` reworked to branch on mode;
  `requireTab`/`requireAction` unchanged. In `oauth` mode a valid-but-unmapped corporate user
  gets **403** (authenticated ≠ authorized); an invalid/absent token gets **401**.
- New env in `.env.example`: `AUTH_MODE`, `AUTH_BASE_URL`, `AUTH_CLIENT_ID`,
  `AUTH_CLIENT_SECRET`, `AUTH_INTROSPECTION_TTL_MS`, `AUTH_REQUEST_TIMEOUT_MS`.
- Tests: `tests/authTokenValidation.test.ts` (introspection mocked at the fetch boundary) —
  401 no/invalid token, 200 valid admin, RBAC still applies to a mapped Operator, 403 for a
  valid-but-unmapped token, and introspection-cache reuse. `tests/rbacEnforcement.test.ts`
  (legacy mode) unchanged and still green. `tsc --noEmit` clean.

### Phase 2a — Directory-backed identity mapping — *landed 2026-08-13*
Implements open decision #1 (DB directory, not AD claims) and replaces Phase 1's provisional
email heuristic with a real table.
- `user_directory` table (`src/db/schema.ts`) + migration `0001_messy_xorn.sql` (plain
  `CREATE TABLE`, per ADR-025).
- Seeded from `INITIAL_USERS` in `src/db/seed.ts` (corporate_username = email local-part,
  idempotent `onConflictDoNothing`) — the bridge from the interim roster.
- `src/server/auth/identityMap.ts` `resolveEksUser` now queries the table and rebuilds a full
  `PortalUser` (role/department/brand/permissions); no active row ⇒ `undefined` ⇒ caller fails
  closed. Case-insensitive.
- Tests: `tests/identityDirectory.test.ts`; `tests/authTokenValidation.test.ts` now seeds the
  directory. Full suite (541) + `tsc --noEmit` green.

### Phase 2b — Login flow (BFF), backend — *landed 2026-08-13*
- Routes (`src/server/routes/auth.ts`): `GET /auth/login`, `GET /auth/callback`,
  `POST /auth/logout`, `GET /auth/me`. login/callback are `guard:none` (no identity yet);
  logout idempotent; `/auth/me` behind `requireUser`.
- PKCE (S256) + single-use `state` held in a TTL'd in-memory map for the handshake window.
- `auth_sessions` table (`src/db/schema.ts`) + migration `0002_shiny_grim_reaper.sql`;
  `src/server/auth/session.ts` stores the corporate access/refresh tokens **encrypted at rest**
  (`crypto.ts`) and issues a signed, `httpOnly`, `SameSite=Lax` session cookie (HMAC, no new
  dependency). Absolute session TTL 8h (`SECURITY.md §1`).
- `requireUser` (oauth mode) now accepts a valid session cookie first (the SPA's credential),
  falling back to a Bearer token for direct/service callers.
- Registered in `apiRegistry.ts` (ADR-026); `apiSurface.test.ts` scan + "unauthenticated"
  assertion + SKIPPED list updated; `docs/openapi.json` regenerated (40 operations).
- Tests: `tests/authFlow.test.ts` drives login → callback → cookie → `/auth/me` → API →
  logout, plus bad-state, tampered-cookie, and not-configured paths. Full suite (548) + `tsc`
  green. Runtime smoke over HTTP confirms `server.ts` mounting.
- **Config (new in `.env.example`):** `AUTH_CALLBACK_URL`, `AUTH_POST_LOGIN_REDIRECT`,
  `AUTH_SCOPES`, `SESSION_COOKIE_SECRET`, `SESSION_TTL_HOURS`, `SESSION_COOKIE_NAME`.

### Phase 2c — Login flow, frontend — *landed 2026-08-13*
Guarded by `VITE_AUTH_MODE` (default `legacy`), so the demo/impersonation path and the whole
test suite are byte-unchanged; `VITE_AUTH_MODE=oauth` switches the SPA to the real session.
- `src/config/envConfig.ts`: `getAuthMode()`.
- `src/config/apiClient.ts`: sends `credentials:'include'` (cookie); attaches the Bearer id
  only in legacy mode; on a 401 in oauth mode navigates to `/auth/login` (the activated stub).
- `src/context/AuthContext.tsx`: in oauth mode hydrates `currentUser` from `GET /auth/me`,
  gates children behind a sign-in screen until a real identity exists, and exposes
  `authMode` + a real `logout()` (POST `/auth/logout` → reload). Legacy path untouched.
- `src/components/layout/Header.tsx`: in oauth mode shows a read-only identity chip + Sign out
  and hides the impersonation switcher; legacy keeps the switcher. New i18n key `header.signOut`
  in all eight locales.
- Tests: `tests/authContextOAuth.test.tsx` (hydration + sign-in gate). Full suite (550) +
  `tsc --noEmit` + `npm run build` green.

**Auth integration is now functionally complete** across backend and frontend. Remaining before
production: register the `ekos` OAuth client with the auth-server team, set the `AUTH_*` /
`SESSION_*` / `VITE_AUTH_MODE=oauth` config per environment, and Phase 3 (endpoint exposure
classification + LB whitelist).

### Phase 3 — Exposure classification — *landed 2026-08-13*
Applies `SecurityGuidelines §12`, translated for a standalone app.
- `src/server/exposure.ts`: every route declared `internal` (infra-only probes) or `external`
  (browser-reachable — all `/api/*` and `/auth/*`), keyed `"METHOD /path"`.
- `tests/exposureClassification.test.ts`: the §12 gate — fails if the map drifts from the route
  registry (an unclassified new route fails CI), pins the invariants (only probes internal;
  external⇒authenticated except the login handshake; internal⇒guardless-by-design pairing).
- `src/server/openapi.ts`: each operation carries `x-exposure` alongside `x-authorization`;
  `docs/openapi.json` regenerated.
- `docs/ENDPOINT_EXPOSURE.md`: the model, EKOS's posture, and the "add an endpoint" workflow.
- **No corporate `external_lb_whitelist.yaml` is fabricated here:** EKOS is standalone, not
  behind the corporate shared LB that file governs. If EKOS is later fronted by a whitelisting
  LB/gateway, the `external` set is exactly the allowlist and is derivable from `exposure.ts`.

### Phase 4 — Refinements — *idle timeout landed 2026-08-13; rest deferred with cause*
- **Session lifetime — done.** Absolute 8h cap (`SESSION_TTL_HOURS`, Phase 2b) **plus** an
  inactivity timeout (`SESSION_IDLE_MINUTES`, default 30): `getActiveSession` kills a session
  with no authenticated request in the window, making the server session — not just the
  client `IdleLockScreen` — the real boundary (`SECURITY.md §1`). Test in `authFlow.test.ts`.
- **Reactive token refresh — deferred, no consumer yet.** In the BFF model identity is read
  from the session row, and EKOS does not (yet) call any corporate API with the stored access
  token, so nothing produces the 401 a refresh would answer. The refresh/refresh-token are
  stored (encrypted) ready for when EKOS proxies corporate calls; building the refresh loop
  before that would be unused machinery.
- **`/permissions/check` (CNF ACL) — deferred, not required.** EKOS authorizes by
  role/department (`rbac.ts`), not entity-level permissions. Wire it only if that need appears.

---

## 7. Config / environment

```dotenv
# Corporate OAuth2 authorization server (Test shown; Live swaps the host)
AUTH_BASE_URL=https://rest.tsrv.northwind.internal/authorization/v1
AUTH_CLIENT_ID=ekos            # dedicated client, NOT the cline MCP client
AUTH_CLIENT_SECRET=            # backend-only secret, from the secret manager
AUTH_CALLBACK_URL=http://localhost:3000/auth/callback
SESSION_COOKIE_SECRET=         # signs the session cookie
```

`AUTH_CLIENT_SECRET`/`SESSION_COOKIE_SECRET` follow the same rule as `ENCRYPTION_SECRET`:
never in code, prod boot refuses to start without them.

---

## 8. Security checklist (SecurityGuidelines cross-reference)

- [ ] Token never reaches the browser (BFF) — §5 Session Management, §3 Client Credential Protection.
- [ ] Session cookie `httpOnly` + `Secure` + `SameSite` — §5.3.
- [ ] `state` + PKCE on the authorization-code flow — CSRF/interception on redirect.
- [ ] Introspection result cached with a bounded, short TTL; fail closed.
- [ ] Unmapped-but-authenticated user fails closed — authN ≠ authZ.
- [ ] `client_secret` only in the backend / secret manager — §6.3 Key Management.
- [ ] Generic auth error messages, no "which part failed" — §4.1.
- [ ] Every new route registered in `apiRegistry.ts` and declared `EXTERNAL`/`INTERNAL` — §12.

---

## 9. Open decisions

1. ~~**Identity mapping** — directory-mapped table vs AD `authorities` claims (§5).~~
   **Decided 2026-08-13: directory-mapped table** (`user_directory`), landed in Phase 2a.
2. ~~**Auto-provisioning** — least-privilege access vs hard deny for an authenticated user
   with no EKOS mapping.~~ **Decided 2026-08-13: hard deny** (403) — already the behaviour
   since Phase 1.
3. ~~**Session store** — SQLite `sessions` table now, Redis at multi-node?~~
   **Decided 2026-08-13: SQLite `sessions` table now**, Redis when multi-node. Implemented in
   Phase 2b.
4. ~~**`SECURITY.md §1` reconciliation** — update the "RS256 JWT" wording to "opaque token +
   introspection".~~ **Decided 2026-08-13:** `SECURITY.md §1`'s status callout now records the
   BFF opaque-token-by-introspection reality alongside the generic template wording.

---

## 10. What this does *not* change

- `src/utils/rbac.ts` and the RBAC matrix — untouched.
- Data-scope isolation in `src/server/grounding.ts` / `ai.ts` — untouched.
- The encryption-at-rest, rate-limiting, validation, and error-envelope work already landed.

The whole change is: *stop trusting an unsigned id; start trusting a server-verified corporate
session.* Nothing downstream of the identity object needs to know the difference.
