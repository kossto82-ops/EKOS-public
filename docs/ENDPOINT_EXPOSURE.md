# Endpoint Exposure Classification

**Owner:** Core Backend Engineering / Security
**Status:** Enforced (Phase 3 of the auth integration)
**Last Updated:** 2026-08-13
**Implements:** `coding-guidelines/Rules/guidelines/SecurityGuidelines.md` §12, translated to EKOS.

---

## 1. Why exposure is a separate axis from authentication

Authentication answers *"who may call this?"*. Exposure answers *"from which
network can this be reached?"*. They are **orthogonal** — a route can be correctly
`requireUser`/`requireTab`-guarded **and** still be a public, browser-reachable
surface; another can be unauthenticated **and** safe only because nothing outside
the infrastructure can reach it.

The trap §12 exists to close: at development time *every* route is reachable —
there is no load balancer or gateway in front of the dev server — so "external vs
internal" is an **intent that cannot be inferred from the code or its runtime
behaviour**. It has to be **declared**, or it is silently forgotten (the corporate
EB-3900 incident: a correctly-authenticated endpoint 403'd in production for a week
because nobody captured that it was externally reached).

## 2. How EKOS applies it

EKOS is a **standalone application** — its own Express server and its own
deployment (`deploy/`, Cloud Run) — not one of the services behind the corporate
shared load balancer whose `external_lb_whitelist.yaml` §12 governs. So there is
**no corporate whitelist file to edit in this repo**; inventing one would be
fiction. What §12 still buys EKOS is the **decision** and the **CI gate**:

| Class | Meaning in EKOS | Routes |
| :--- | :--- | :--- |
| `internal` | Reached only by infrastructure (orchestrator/LB health checks); never the public browser. Must not be exposed publicly. | `GET /healthz`, `GET /readyz` |
| `external` | Reachable from the end-user browser — the React SPA is served to users and calls these directly. | everything else (all `/api/*` and `/auth/*`) |

If EKOS is ever fronted by a path-whitelisting LB or gateway, the `external` set is
exactly the allowlist to configure — and it is derivable from the source of truth
below, not re-typed by hand.

## 3. Source of truth and enforcement

- **Declaration:** `src/server/exposure.ts` — one entry per route, keyed
  `"METHOD /path"`. This is the single place the exposure decision lives.
- **Gate:** `tests/exposureClassification.test.ts` fails if the map drifts from the
  route registry (`src/server/apiRegistry.ts`) — a new route with no classification
  is a failing test, not an oversight. It also pins the invariants: only the two
  probes are `internal`; every `external` route is authenticated except the OAuth
  login handshake (`/auth/login`, `/auth/callback`, `/auth/logout`), which cannot
  carry a caller identity yet; and an `internal` route's unauthenticated posture is
  only allowed while it stays internal.
- **Contract:** `src/server/openapi.ts` stamps each operation with `x-exposure`
  (alongside `x-authorization`), so the generated `docs/openapi.json` documents both
  axes. `npm run api:spec` regenerates it; a test fails if it is stale.

## 4. Adding or changing an endpoint

1. Add the route to `apiRegistry.ts` (already required — ADR-026).
2. Add its exposure to `src/server/exposure.ts`. If it is `external` and EKOS is
   deployed behind a whitelisting LB, create the corresponding allowlist entry in
   that (ops-owned) config — whitelisting is a developer responsibility, not a
   "tell ops" (§12).
3. `npm run api:spec` and commit the regenerated `docs/openapi.json`.

The exposure test will fail until step 2 is done, which is the point.
