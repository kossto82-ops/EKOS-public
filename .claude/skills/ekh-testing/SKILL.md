---
name: ekh-testing
description: >
  Write, run, and maintain automated tests for the Enterprise Knowledge Hub project
  (React 19/TypeScript/Vite frontend + Express/Drizzle/SQLite backend). Use this skill
  whenever the user mentions testing, wants to add tests, fix failing tests, check test
  coverage, or asks "does this work correctly". Also triggers for: "write tests for X",
  "test this endpoint", "check if the search chain works", "integration tests", "vitest",
  "supertest", "accessibility test", or any phrase about verifying correctness of code in
  this project. Always use this skill before suggesting manual verification — automated
  tests are the correct answer.
---

# Enterprise Knowledge Hub — Testing Skill

## Project context

Stack: React 19 + Vite 6 + TypeScript 5.8 + Drizzle ORM + better-sqlite3 + Express.
Runner: **vitest** (`vitest.config.ts` at the root). HTTP: **supertest**.
Tests live in `tests/`. Isolated server: `tests/testApp.ts` (in-memory SQLite,
never touches `db.sqlite`).

Nothing needs scaffolding. There are **34 test files and ~427 assertions**, and
`npm test`, `npm run test:watch` and `npm run test:coverage` all exist. If a
suite for what you are testing already exists, extend it rather than starting a
parallel one.

**Critical rule**: never import `server.ts` in a test. It binds a port on
import. Use `createTestApp()` from `tests/testApp.ts`.

**Local environment**: plain `node` cannot load `better-sqlite3` on this machine
(native ABI mismatch) — vitest runs the suite fine. A bare `node -e` failure is
not evidence of a broken data layer.

## What already exists

Know this before writing anything, so you extend rather than duplicate:

| Concern | Files |
|---|---|
| API surface & contract | `api`, `apiContract`, `apiSurface`, `syncRoutes` |
| Auth & permissions | `auth` (client rule table), `rbacEnforcement` (per-route, server-side) |
| Retrieval & RAG | `hybridRetrieval`, `retrievalRanking`, `retrievalDegradation`, `searchRelevance`, `grounding`, `evaluation`, `chunking`, `rechunk` |
| Data layer | `dataLayer`, `migrations`, `batchAtomicity`, `crypto`, `queryLogging` |
| Ingestion | `ingestGovernance`, `ingestTombstone` |
| Scoping & i18n | `dept`, `i18nBrandS6` |
| Accessibility (jsdom) | `accessibility` (shared primitives), `fullScreenAccessibility` (6 tab screens), `dialogAccessibility` (11 dialogs + a static conformance guard) |
| React units (jsdom) | `docListVirtualization`, `errorBoundary`, `useAssistantSearch`, `useKbGovernanceData` |
| Infrastructure | `deployment` (Docker/compose/CI invariants), `operability`, `telemetry`, `docsDrift` |

## Environments

The config default is `environment: 'node'`. Component and accessibility tests
opt in per file with a first-line pragma:

```tsx
// @vitest-environment jsdom
```

`tests/setup.ts` already polyfills what jsdom lacks: `ResizeObserver`
(react-window), `DOMMatrix` (pdfjs), and it imports `@testing-library/jest-dom`.
Add to that file rather than re-polyfilling per test.

**jsdom traps that produce false confidence:**

- `offsetParent` is always null (no layout engine). Any code filtering on
  visibility sees nothing as visible. `useFocusTrap` falls back to focusing its
  container, which makes a broken focus trap indistinguishable from a working
  one — `tests/dialogAccessibility.test.tsx` shims `offsetParent` to the parent
  element precisely to restore the branch a browser takes. Copy that approach
  rather than asserting around the fallback.
- `color-contrast` cannot be computed, so every axe run here disables that rule.
  Contrast is covered by the manual process in `docs/ACCESSIBILITY.md`.
- Tab does not move focus. Firing `keyDown` with `key: 'Tab'` exercises your
  handlers only; nothing moves on its own.

## Writing tests

### API and route tests

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp } from './testApp';

let app: Express;
beforeAll(() => { app = createTestApp(); });

it('rejects an empty query with the shared failure envelope', async () => {
  const res = await request(app).post('/api/search').send({ query: '' });
  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe('ERR_VALIDATION');
});
```

Assert the error **code and shape**, not just the status. The failure envelope
is a contract with `tests/apiContract.test.ts` behind it.

### Permission tests — assert the server, not a copy of it

Do NOT re-implement the permission rules inside the test. A test that
reimplements the logic it is checking passes against a broken server, which is
the single most expensive mistake available here.

`src/utils/rbac.ts` is the **client-side** rule table; it is a usability
affordance, not an enforcement point. Enforcement lives in
`src/server/middleware/auth.ts` and is asserted route-by-route in
`tests/rbacEnforcement.test.ts`. Extend that file:

```typescript
it.each(MUTATING_ROUTES)('%s rejects an Agent', async ({ method, path }) => {
  const res = await request(app)[method](path).set('Authorization', `Bearer ${AGENT_ID}`);
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('ERR_FORBIDDEN');
});
```

Note the standing limitation while writing auth tests: the bearer token is
currently an **unsigned user id**, so tests can impersonate freely. That is the
defect, not the test setup — see `docs/KNOWN_LIMITATIONS.md` §5.

### Accessibility tests

Three layers already exist; put new work in the one that fits.

- Shared primitives → `accessibility.test.tsx`. Note `Breadcrumb` and
  `ToastContainer` need a `LocaleProvider`; the app wraps everything in one, so
  a bare render is a configuration that never occurs in production.
- Whole screens → `fullScreenAccessibility.test.tsx`. Needs the full provider
  tree and a `fetch` stub, and waits for `.animate-spin`/`.animate-pulse` to
  clear so axe audits the settled state rather than a skeleton.
- Dialogs and drawers → `dialogAccessibility.test.tsx`. Scans each dialog while
  **open**, drives Tab/Shift+Tab to prove focus is trapped, and covers the
  Escape path. It also carries a static guard that reads `src/` and fails if any
  component declaring `role="dialog"`/`aria-modal` does not attach
  `useFocusTrap`. A new dialog gets the static guard for free; add it to the
  interaction list too.

### Invariant / drift guards

`tests/deployment.test.ts` and `tests/docsDrift.test.ts` pin things that break
silently — a manifest property, a documented claim that stopped being true.
Read source with `fs`, not by shelling out to grep: grep and ripgrep apply
binary-file heuristics and skip files **without saying so**, which turns a guard
into a silent no-op over exactly the file it should have flagged. This is not
hypothetical — `DocumentDetailDrawer.tsx` carried a raw NUL byte as a `join`
delimiter and was skipped by both tools until it was rewritten as the `\0`
escape. Pair every such guard with an assertion that fails if the scan finds
implausibly little, so it cannot pass by vacuum.

## The rule that matters most

**Confirm a new assertion fails before you trust it.** Write the failing test
first, or — when fixing a defect that is already fixed — restore the pre-fix
state and watch the assertion fail. Every guard added in this repo was verified
that way:

```bash
git stash push -- path/to/file            # or: git show <sha>~1:path > path
npx vitest run tests/thatGuard.test.ts    # expect failure, and read the message
git stash pop                             # restore
```

A security fix with no test that fails without it is a claim, not a change. A
drift guard that passes on the bug it was written for is worth nothing.

## Running

```bash
npm test                          # whole suite
npx vitest run tests/api.test.ts  # one file
npx vitest run -t "partial name"  # one test
npm run test:coverage
```

Report what the run actually printed. Never summarise a suite as passing without
having run it.

## Common failures

| Error | Cause | Fix |
|---|---|---|
| `useLocale must be used within a LocaleProvider` | Component now reads i18n; test renders it bare | Wrap in `LocaleProvider` — match how `main.tsx` composes providers |
| `Cannot find module 'better-sqlite3'` / ABI error under `node` | Native addon vs. local Node major | Run through vitest; `npm rebuild better-sqlite3` if it also fails there |
| `address already in use` | `server.ts` imported somewhere | Use `createTestApp()` |
| axe reports `label` violations | Visible text not programmatically associated | Real `htmlFor`/`id` or `aria-label` — never `aria-hidden` to silence the rule |
| Focus assertions pass suspiciously easily | jsdom `offsetParent` fallback | Shim `offsetParent` as `dialogAccessibility.test.tsx` does |

## What not to test

- AI provider responses (non-deterministic). Test the call construction and the
  handling of a stubbed response.
- The mock retrieval fallback used for demos, except where a test asserts the
  degradation path itself (`retrievalDegradation.test.ts` does, deliberately).
- Third-party library internals.

Component and accessibility tests are **in scope** and there are seven jsdom
suites — an earlier version of this document said otherwise and was wrong.
