---
name: run-enterprise-knowledge-hub
description: Build, run, and drive the Enterprise Knowledge Hub (Express + Vite + React + SQLite web app). Use when asked to start the app, run its dev server, build it, take a screenshot of its UI, exercise the knowledge-assistant search flow, or hit its REST API.
---

This is a single-process web app: an Express server (`server.ts`) that mounts Vite
middleware for the React 19 frontend and exposes a REST API (`/api/db/*`,
`/api/search`, `/api/ai/*`, ...) backed by a local SQLite file (`db.sqlite`,
auto-created and auto-seeded on first boot). All paths below are relative to
the repo root.

Drive it with the `mcp__Claude_Browser__*` tools (`preview_start`,
`read_page`, `javascript_tool`, `read_network_requests`, `computer`,
`form_input`) against `.claude/launch.json`, already configured in this repo.
No custom driver script is needed — the browser tools plus a couple of
`javascript_tool` snippets below are the whole harness. If those tools aren't
available, fall back to `npm run dev` + `curl` for API-only checks (see
"Direct invocation" below).

`preview_start` returns both a `serverId` (the dev-server process — used only
by `preview_logs` and `preview_stop`) and a `tabId` (the browser tab — passed
to `read_page`, `computer`, `javascript_tool` and the rest). They are not
interchangeable.

## Prerequisites

- Node.js 18+ (verified with Node 24.18.0 / npm 11.16.0).
- **On a fresh Windows container Node may not be installed or on PATH at
  all.** If `node --version` fails, install it and fix PATH for *all*
  process trees (see Gotchas — this bit us and cost the most time):

```powershell
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
```

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set a non-empty `ENCRYPTION_SECRET` (required — the server
uses it to derive an AES-256 key for encrypting stored provider API keys; an
empty value still boots via a dev fallback but a real value is what the app
expects):

```bash
# in .env
ENCRYPTION_SECRET=dev-local-smoke-test-secret-please-change
```

`GEMINI_API_KEY` can be left as the placeholder — the app boots and the UI
fully renders without a real key. Only the AI-synthesized answer step of
`/api/search` fails (see Gotchas).

## Build

```bash
npm run build
# → vite build (dist/assets/*, dist/index.html)
#   + esbuild bundles server.ts        → dist/server.cjs
#   + esbuild bundles src/server/otel.ts → dist/otel.cjs
```

`dist/otel.cjs` is a separate bundle because it must be preloaded before the
server: `npm start` runs `node --require ./dist/otel.cjs dist/server.cjs`, and
`npm run dev` does the equivalent via `tsx --require ./src/server/otel.ts`.
Dropping the `--require` leaves the app running with no instrumentation and no
error.

## Run (agent path)

`.claude/launch.json` defines the `enterprise-knowledge-hub-dev` config on port
3000. It does not shell out to `npm run dev` — it invokes tsx directly, through
`node_modules/.bin/node.exe` so the launcher does not depend on Node being
resolvable on PATH (see Gotchas). It carries the same
`--require ./src/server/otel.ts` preload the npm script does; without it the
preview would run uninstrumented and nothing would say so. Keep the two in step
whenever `package.json`'s `dev` script changes.

Start it and drive it with the browser tools:

```
preview_start(name="enterprise-knowledge-hub-dev")   # → { serverId, tabId, port: 3000 }
read_page(tabId)                                     # accessibility tree — PREFER this over screenshots (see Gotchas)
read_network_requests(tabId)                         # inspect API calls, e.g. POST /api/search
read_console_messages(tabId)                         # browser-side errors
preview_logs(serverId)                               # server-side console output (DB init, seeding, AI errors)
```

Example flow — clicking a quick-action question and confirming it reaches the
backend:

```js
// javascript_tool(tabId, action="javascript_exec", text=...)
(() => {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.includes('refund after the cooling-off'));
  btn.click();
  return 'clicked';
})()
```

Then `read_network_requests(tabId)` shows `POST http://localhost:3000/api/search`
and `read_page(tabId)` shows the breadcrumb changing to
`Home / Assistant / Results` with the answer panel rendered.

For clicks and typing, prefer `read_page` (or `find`) to get a `ref_N` for the
target and pass that to `computer` / `form_input` — refs survive re-renders
that coordinates and selectors do not. Text-based targeting has no selector
syntax; use `find` with a natural-language query, or the `javascript_tool` +
`textContent.includes(...)` pattern above.

Stop with `preview_stop(serverId)` when done.

## Direct invocation (API-only checks)

For backend/API-only changes you don't need the browser at all — once
`npm run dev` (or `preview_start`) is up, hit the REST API directly:

```bash
curl -s http://localhost:3000/api/db/brands            # → {"success":true,"data":[seeded brands]}
curl -s -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"refund policy","brandId":"recepta_es"}'
```

## Run (human path)

```bash
npm run dev   # → http://localhost:3000, Ctrl-C to stop
```

## Test

```bash
npm run lint            # tsc --noEmit — passes clean, no output on success
npm test                # vitest run — the full suite under tests/
npm run test:coverage   # vitest run --coverage
```

There is a substantial suite under `tests/` (API contract, retrieval,
grounding, accessibility, i18n, deployment invariants, docs drift, ...). Use
the `ekh-testing` skill when writing or repairing tests rather than improvising
a harness. `tests/deployment.test.ts` asserts the container/manifest invariants
without needing Docker.

Note: `node` cannot load `better-sqlite3` directly on this machine (native ABI
mismatch), but vitest runs the suite fine.

---

## Gotchas

- **`node` not on PATH breaks the preview tool even after `npm install`
  succeeds in a plain shell.** On this container, `winget install
  OpenJS.NodeJS.LTS` installs Node but the registry PATH update doesn't
  propagate to already-running process trees (PowerShell tool calls need
  `$env:Path` rebuilt from the registry each call; the browser-tool
  server process inherits a *different*, older PATH snapshot entirely and
  can't be fixed that way). The actual failure: `npm run dev` runs
  `tsx server.ts`, and `node_modules/.bin/tsx.cmd` only resolves `node.exe`
  from its own directory or, failing that, from `PATH` — it does not inherit
  a shell's updated `$env:Path`. Fix that generalizes to the preview tool's
  process, too:
  ```bash
  cp "/c/Program Files/nodejs/node.exe" node_modules/.bin/node.exe
  ```
  This makes `tsx.cmd`'s `%dp0%\node.exe` check succeed without depending on
  PATH at all. (Also created a `C:\Users\<user>\bin` → `C:\Program Files\nodejs`
  junction so plain shells pick it up too, since `C:\Users\<user>\bin` was
  already first on the default PATH but didn't exist yet.)
- **`/api/search` returns HTTP 500 with the placeholder `GEMINI_API_KEY`** —
  expected, not a bug: `{"error":{"code":"ERR_SEARCH_FAILED","message":"[gemini] AI request failed: ... API_KEY_INVALID"}}`.
  The rest of the app (DB-backed views, brand switching, quick-action
  navigation, breadcrumbs) works fully without a real key; only the final
  AI-synthesized-answer step needs one. Get a real key from Google AI Studio
  to exercise that path end-to-end.
- **Screenshots reliably time out (30s) in this container** even when the app
  is fully rendered and responsive — `read_page` (accessibility tree) and
  `read_network_requests`/`preview_logs` work fine and are the reliable way to
  verify state. Do not treat a screenshot timeout alone as a sign the app is
  stuck; cross-check with `read_page` first.
- **`npm install` can partially fail the first time** with
  `EPERM: operation not permitted, rmdir ... node_modules\...` cleanup
  warnings and a `better-sqlite3` build failure — this happens if Node
  wasn't fully resolvable yet when npm's own cleanup/rebuild step ran.
  Re-running `npm install` after fixing PATH (see above) completes cleanly.

## Troubleshooting

- **`'"node"' is not recognized as an internal or external command` when
  running `npm run dev` via `preview_start`**: `tsx.cmd` can't find
  `node.exe`. Copy it into `node_modules/.bin/` as shown in Gotchas.
- **`npm error command failed ... prebuild-install || node-gyp rebuild`
  for `better-sqlite3`**: same root cause (node unresolvable during
  `npm install`'s own scripts). Fix PATH/copy node.exe, then re-run
  `npm install`.
- **`PowerShell` tool: `node`/`npm` "not recognized" even right after a
  successful `winget install`**: PATH changes from `winget` land in the
  registry but not in the current process's `$env:Path`. Rebuild it
  explicitly at the top of the PowerShell command:
  ```powershell
  $machine = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name PATH).Path
  $user = (Get-ItemProperty 'HKCU:\Environment' -Name PATH -ErrorAction SilentlyContinue).Path
  $env:Path = "$machine;$user"
  ```
  (Shell state, including `$env:Path`, does not persist between separate
  PowerShell tool calls — repeat this at the top of each one that needs
  `node`/`npm` if you don't rely on the `node_modules/.bin/node.exe` copy.)
