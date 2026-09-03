# EKOS master prompt (v1 — generated 2026-07-23 by the self-improve harness)

EKOS operating brief (React+Vite front end, Express + better-sqlite3 + Drizzle back end).

## Architecture invariants
- RBAC is an unsigned Bearer that is literally the user id; the server trusts it, so every mutating route must re-check permissions server-side. Never trust client-supplied identity/provenance fields (e.g. reportedBy) — set them from req.user.id.
- SQLite is the source of truth; localStorage is an offline cache plus cross-tab events. Server writes must be awaited and the cache/UI reconciled to the server's response (including sanitizer signals like blockedCount). Optimistic-then-forget is a bug.
- Documents are paginated (GET returns a page + nextOffset/hasMore). Never resolve a mutation target by scanning the loaded/brand-filtered array; carry a stable document id and act server-side.

## Document model
- Classification = Function (departmentScope 'global'|'specific' + departmentIds string[]) x Region (scope 'global'|'brand' + brandId) + a responsible owner (ownerId). departmentIds supports MULTIPLE ids — preserve the whole array. Keep the scope/brandId and departmentScope/departmentIds invariants coupled (no scope='brand' with null brandId). departmentIds is stored as JSON text; parse it back to string[] on EVERY read and write response.
- PATCH permission tiers: approvalStatus = governance role that matches the review queue (NOT the broad upload_kb); content = assigned owner OR KB manager; classification = KB manager. On a content change, reset approvalStatus for re-review and append a new version + re-chunk in a transaction — never mutate content of an Approved doc in place.

## Governance / retrieval
- Retrieval must ground ONLY on approvalStatus==='Approved' (and not expired), enforced server-side on all three paths (/api/search, /api/kb-chat, /api/copilot-draft). A not-Banned denylist is insufficient and kb-chat/copilot-draft currently trust client arrays.
- Keep intake status and terminal/resolved status disjoint so the re-approval guard doesn't revert first approvals.
- Report intake is open to low-priv callers: whitelist + length-cap fields, force server-set provenance, validate referenced docs, cap queue size.

## Correctness
- Version bumps must parse structured major/minor with carry, not parseFloat.
- Batch/multi-row inserts run in one transaction with up-front NOT NULL validation.
- Fix the KnowledgeBaseTab Rules-of-Hooks ordering (all hooks before any early return).

## Invariants added by the re-audit (v2)
- **Authorization parity**: any field mutated by more than one endpoint (esp. `approvalStatus` via PATCH tier-1 AND `governance-decision`) MUST share the same gate. Approve/ban = Administrator/LocationManager only (`canAccessTab('governance')`); `upload_kb` (includes TeamLeader) is NOT sufficient. Audit the direct-API PATCH path, not just the UI route.
- **Version/history coherence**: never bump `kbDocuments.version` without inserting the matching `kbDocumentVersions` (+chunk) row in the same transaction — or don't bump at all (a content-less approval is a status transition, not a revision).
- **Scope on resolve**: resolve a governance target by document id (or scope by tenant+brand+department), never by bare name across the whole table.
- **Client reconciliation**: any mutation whose server response changes fields the client didn't send (version, approvalStatus) must merge `response.data.document` into both the list row and the open drawer/`selectedDoc`.
- Keep server gate, client eligibility check, comments, and 403 messages in lockstep; drift is a defect.
- Async handlers own their outcome toast; callers must not pre-emit success.

## Auth/RBAC invariants (S3, standing brief)
- **rbac.ts is the sole source of truth**; the `PortalUser.permissions` object is currently inert (dead) — don't imply enforcement it lacks.
- **Every mutating/sensitive route** applies requireUser **plus** the right requireTab/requireAction. Tab visibility authorizes reads only. Enforced now: brand writes = `manage_rates` (Admin); source writes = `upload_kb`; ai-config/desk-settings writes = governance tab (Admin/LM), reads stay on settings.
- **Tab matrix and action matrix must agree** about who acts on a feature. The review queue UI is gated on `canAccessTab('governance')` to match the server decision routes (NOT the broader `view_review_queue`).
- **`'*'` departmentIds = all departments (incl. IT) BY DESIGN** — asserted in auth.test.ts. Don't "fix" it; if a service account shouldn't get IT tabs, don't give it `'*'`.
- Identity is written to `auth_token` synchronously on every user switch (before child effects). Default identity is the owner Administrator (portfolio demo decision).
- No unmasked secrets in any response (debug-db redacts the apiKey).
- **GET /api/db/documents enforces the caller's own brand/department scope server-side** (global docs + docs intersecting the caller's brandIds/departmentIds; '*' = unrestricted; client filter only narrows). Counts/categories reflect the accessible set.
- **Still open**: standardize ai.ts error envelopes to {success,error:{code,message}}.

## AI/LLM invariants (S2, standing brief)
- **Never send the server-stored/env provider API key to a caller-controlled endpoint.** `callAI` only resolves the stored/env key when the endpoint is NOT caller-supplied (`customEndpointUrl` from the request body); otherwise the request must carry its own key. Prevents SSRF key-exfiltration.
- **Every provider fetch is wrapped in `withTimeout`** (gemini/anthropic/openai/groq/custom) — no unbounded external calls.
- **Guardrails go LAST in the system prompt.** A client `systemPromptOverride` is appended, then a NON-NEGOTIABLE grounding/brand-isolation line is appended AFTER it so the override can't countermand it.
- **Decrypt failures fail closed** — never fall back to using the raw ciphertext blob as the key.
- **Billable/external routes** (`test-ai-connection`, `debug-db`) are gated (settings tab), not open to every identity.
- **Grounding NEVER comes from the request body.** All three grounding routes (`/search`, `/kb-chat`, `/copilot-draft`) load candidates via `loadScopedGroundableDocs(req.user, {brandId, departmentId})`: DB-sourced, `isRetrievableDoc`, filtered by the CALLER's own brandIds/departmentIds via the pure `isDocVisibleToCaller` (`'*'` unrestricted), request able only to NARROW, capped by `selectRelevantDocuments`. A client-supplied `globalDocs`/`brandDocs` array is ignored. Likewise `copilot-draft` resolves the brand's commercial facts (VAT, pricing plans, locale) from `kb_brands` by id — never from a client-sent brand object.
- **Stored secrets are AES-256-GCM with a per-value salt** — format `v2:salt:iv:authTag:ciphertext`. scrypt stretches the secret into a master key ONCE at module load; each value derives a subkey via HKDF-SHA256 (decrypt runs on every AI call, so per-value scrypt would cost ~100ms/request). Legacy 2-part CBC values still decrypt for backward compatibility; don't remove that branch until no v1 values remain.
- **Rate limiting exists**: AI routes have their own limiter (30 req/15 min) on top of the global 150/15 min — see `server.ts`.
- **Error envelopes are standardized**: every AI route fails with `{success:false, error:{code, message}}` via the local `fail()` helper (codes `ERR_AI_CONNECTION_FAILED`, `ERR_KB_CHAT_FAILED`, `ERR_COPILOT_GENERATE_FAILED`, `ERR_COPILOT_DRAFT_FAILED`, `ERR_INVALID_INPUT`); successes carry `success:true` alongside their payload keys.
- **Still open (S2)**: non-Latin (ja/th) tokenizer degrades retrieval; per-request full-corpus scan is uncached (every AI call re-reads and re-ranks the whole corpus); upstream provider error text is still relayed to the client in the `message` (masking not yet applied); `kb-chat`/`copilot-generate`/`copilot-draft`/`crm-cases`/`test-ai-connection`/`debug-db` have NO client caller — documented API surface unreachable from the UI (wire or retire).

## Assistant/Copilot UX invariants (S1, standing brief)
- **Don't display fabricated metadata.** Only surface fields that exist on the data model (`KnowledgeAnswer`/`KnowledgeAnswerSource` carry no version and no file type). Derive file extension from the real source name; if absent, use a neutral label — never guess `.pdf`/`.docx` or a version string.
- **Trust affordances follow provenance.** A `local_fallback` (simulated) answer must not show a "Verified" badge or a confidence score — force "Review Required" / "—". Thread `retrievalSource` to the leaf; don't recompute trust locally.
- **Guard `navigator.clipboard`** — it throws synchronously when unavailable (insecure context), so a `.catch()` won't fire; check `navigator.clipboard?.writeText` first and toast a manual-copy fallback.
- **Invalidate tenant-scoped state on brand/department switch** — a context change issues no new request, so bump the request id and clear result/error/source in an effect (skip the initial-mount no-op so a preloaded query survives).
- **Accessibility:** one always-mounted `role=status aria-live=polite sr-only` region for search state (never swapped in/out with the views it describes); `role=alert` on error alerts; document Markdown renders through shared `MarkdownContent` (GFM) with `headingOffset={2}` when it sits under a drawer/modal/panel heading.
- **Declined interactions must say so**: an empty search submit raises `emptyQueryHint`, rendered with role=alert + aria-describedby and cleared on the next keystroke — a disabled button is not feedback.
- **Unbounded content is render-guarded**: FullDocumentDrawer renders a 20k-char prefix with an explicit "show the full text" opt-in (documents reach 60k).
- **Still open (S1)**: the suggestion sections still fetch 200 full documents (content included) to derive a few titles — a metadata-only endpoint is the real fix; "Suggested" section relabel is cosmetic.

## Sources & Sync invariants (S4, standing brief)
- **Sync is subordinate to governance.** A SharePoint re-sync refreshes only content-derived fields (name/type/content); it MUST preserve approvalStatus, version, departmentIds, brandId, owner, ratings, views. A banned doc stays banned; a real content change drops the doc to 'Under Review', never force-approves it. An automated job never overwrites a human decision.
- **Never insert a placeholder that violates a FK.** `kb_sync_jobs.source_id` is a NOT NULL FK to `kb_sources` with FK enforcement ON — resolve to a real source id or return 400; don't default to a nonexistent id.
- **Telemetry is derived from the real mechanism.** `/sync/status` integrity/keys come from kb_documents (indexable content), the same thing retrieval uses — not hardcoded constants and not the sparse chunk table.
- **Every outbound Graph/Azure fetch is timeout-bounded** (AbortController, ~30s) — same invariant as the AI client's withTimeout. Raw upstream (Azure AD/Graph) error bodies are logged server-side but never relayed to the client. Failed syncs write a job row (visible in the log), never leave zero trace.
- **UI honesty:** no fabricated sync counts/metrics/dates; manual "Run Sync" calls the real crawl and honestly reports configured:false; a "re-validate" action reflects the server's real status, never force-'healthy' on a timer. Loading/error/empty are distinct states; source status ('healthy'|'warning'|'error'|'syncing') round-trips losslessly.
- **The crawl is resilient and self-accounting**: per-file extraction is wrapped (one bad file no longer aborts the run), `crawlKnowledgeBase` returns a `CrawlResult` with filesSeen/skippedEmpty/failed/truncated/capped, and `SP_MAX_FILES` (default 2000) bounds one run.
- **Deletions are reconciled by tombstoning** — `upsertKbDocuments({tombstoneMissing})` soft-deletes sync-owned (`sp_`-prefixed) documents the crawl didn't return. ONLY opt in for a complete crawl (not capped, zero extraction failures): a partial view is not evidence a document is gone. Never widen the id prefix — in-app uploads (`kb_`) and the `rm_` snapshot must stay untouched.
- **The job row is claimed as 'Started' before crawling** and updated to Completed/Warning/Halted; a run that hit the cap or skipped files closes as 'Warning', never 'Completed'.
- **Still open (S4)**: per-source coverage/trust/monthlyQueries are static seed values under a live-sounding heading.

## Data-layer invariants (S5, standing brief)
- **Soft-delete is honored everywhere.** `deletedAt` lives in the shared `isGroundableDoc` predicate (ai.ts) so no grounding path (search/kb-chat/copilot-draft) or aggregate (sync telemetry) ever reads a deleted row. New read paths that touch kb_documents must exclude `deletedAt`.
- **Shared field ⇒ shared gate.** approvalStatus is governance-gated on POST, PATCH and the decision route identically: 'Under Review' unless the caller is a governance role AND the value ∈ ALLOWED_APPROVAL_STATUSES. Any field written by >1 endpoint gets the same authorization + enum validation on all of them.
- **Chunk/version mutations key on the deterministic PK**, not on the denormalized document_id (which the old seed left NULL). Seed populates chunk.documentId; every kb_documents column has a matching idempotent ALTER in db.ts (CREATE TABLE IF NOT EXISTS does not migrate).
- **Validate at the server boundary.** Zod schemas in validation.ts are client UX only; server routes independently validate (brand vatRate ∈ [0,1], displayName/shortCode length, document type/name, approvalStatus enum). Never trust the client to have validated.
- **Normalize LLM output to the response contract** server-side — `/api/search` fills every required KnowledgeAnswer field so a model omitting one can't render "undefined%"/"Invalid Date".
- **Seeds are idempotent + self-healing:** one-time inserts use onConflictDoNothing and run every boot, so a truncate-and-reseed or an interrupted first seed never crashes on UNIQUE or permanently skips later steps.
- **Delete dead code that encodes a stale contract** (it's a re-introduction trap), and always classify a finding as dead-vs-live — a bug in unreachable code is at most LOW.
- **Batch writes are atomic**: `POST /api/db/sources` and `/api/db/governance/gaps` wrap their per-row upsert loops in `db.transaction()` (tests/batchAtomicity.test.ts asserts a failing later row leaves NO partial write). Any new batch route does the same.
- **Still open (S5)**: per-source coverage/trust/monthlyQueries are static seed values shown under live-sounding headings (recordCount is now derived); `getPolicies/savePolicies` remain localStorage-backed (no server route for policies yet); no non-PK indexes (trivial at current scale).

## Brands/Departments/i18n invariants (S6, standing brief)
- **Brand roster is 14** (13 customer-facing + `internal_it`, the internal IT brand, shortCode `ITD`). `kb_brands` is the source of truth; `constants/brands.ts` is the fallback — keep them in exact parity. The 16 fabricated brands are deleted; never reintroduce them. `shortCode` is NOT unique (2×DE, 3×FR, IT vs ITD) — don't key logic on it.
- **`brandUtils.COLOR_MAP` must contain every `color` used in `brands.ts`** — a missing color silently renders the indigo default (collides with the legitimately-indigo brand). Adding a brand color ⇒ add its hex. (tests/i18nBrandS6 asserts this.)
- **Department is UI scope only.** `activeDepartment` / `DepartmentContext` never feed authorization; `rbac.ts`'s `isIT` reads `currentUser.departmentIds` from AuthContext. Never wire the active-department picker into permissions.
- **i18n: 8 locales, kept structurally identical (252 keys; tests/i18nBrandS6 enforces parity).** ja/th must have 0 untranslated (Latin) values; European cognates (Marketing/Finance/"No"/German loanwords) are acceptable and must not be "fixed". Route ALL user-facing strings through `t()` — a hardcoded English literal is worse than an untranslated key (BrandManager.tsx is a known offender, deferred to S7).
- **LocaleContext guards**: lazy loads are protected against supersession (latest-locale ref) and unmount; `t()` falls back en→path; the initializer is try/catch'd (outermost provider). Preserve these on any change.
- **Context safeguards persist**: Brand/Department out-of-scope correction uses the persisting setter, not the bare state setter.
- **Still open (S6)**: BrandManager VAT/label "override" is a dead localStorage write with a false success toast + the panel bypasses `t()` (S7/Settings); sources.ts recordCount(40 vs real 119)/coverage/trust are static/fabricated (S4 residue); routingmgr snapshot (58 docs) has no KnowledgeSource entry; ai.ts:296 hardcodes 'Vorzimmer' fallback and governanceRepository seed still names Standély/Vorzimmer (brand-cleanup residue).

## App shell / Settings invariants (S7, standing brief)
- **Tab visibility ≠ write authorization.** `canAccessTab` governs what a role SEES; mutations are gated on rbac actions. Governance writes require Admin-only `manage_governance` (LocationManager views governance read-only). Never gate a write on `requireTab` alone if a lower role can see that tab.
- **Settings persistence is server-backed, awaited, reconciled.** BrandManager → PATCH /api/db/brands/:id (manage_rates) via `BrandContext.updateBrand`; AiProvider/Team → governanceService. No localStorage "save", no optimistic success toast. AiProvider config must round-trip `customEndpointUrl` (partial saves erase omitted fields).
- **SettingsTab "System Health" shows only real telemetry** (indexIntegrity + sync history from /api/db/sync/status), "—"/unavailable for non-sync roles, and the un-instrumented service table is labelled "Illustrative". Don't reintroduce hardcoded metrics.
- **Shared primitives:** Modal uses the module-level modalStack (top-most Escape + body scroll-lock); the app tree is `inert` while idle-locked (lock screen rendered outside it); ErrorBoundary takes `resetKeys` ([activeTab]); RoleGate fails closed; NavItem has `aria-current`; settings forms use aria-invalid/aria-describedby.
- **App redirects off a forbidden tab on role/impersonation switch**, and the responsive banner respects its dismissed flag.
- **i18n: route EVERY user-facing string through `t()`** — a hardcoded literal can't be localized. All 8 locales stay structurally identical (tests/i18nBrandS6 enforces parity); a class component i18n's via a functional fallback sub-component.
- **Still open (S7)**: TeamManager is orphaned (i18n'd, not mounted — wire or remove); Toast nested live-region refinement deferred (a11y test expects role='alert' + container aria-live); brand-cleanup code residue (ai.ts:296 'Vorzimmer' fallback, governanceRepository seed) and S4 sources.ts fabricated metrics are task-chipped.

## Verification expectations
Run `tsc` (no new errors) and vitest; then exercise the real app via the run-enterprise-knowledge-hub skill — verify approve/ban actually flips the server row and drops the doc from retrieval, that a first approval of a reported task sticks after reload, and check the DB directly. Do not report done on tests alone.
