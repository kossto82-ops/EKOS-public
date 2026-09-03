# EKOS self-improve — learnings log

Durable rules the harness has extracted. Newest iteration on top.

## Backlog sprint — Tier 3 sync resilience & UX — 2026-07-31

- **"Silently skipped" and "kills the whole run" are the same missing try/catch.** In the SharePoint crawl an unreadable file either produced an empty body indistinguishable from success (unsupported binary) or threw and rejected out of the recursive walk, aborting the ENTIRE crawl. One per-item catch plus explicit counters (`filesSeen`/`skippedEmpty`/`failed`/`truncated`) turns both failure modes into reported facts.
- **A crawl can only add and update — deletion needs its own reconciliation pass.** Nothing in an upsert loop can ever notice a file that disappeared upstream, so orphans kept grounding answers forever. Tombstoning (soft-delete of previously-synced ids the crawl didn't return) is the missing half of "sync".
- **Guard a destructive reconciliation on evidence of completeness.** Tombstoning from a partial view deletes live data, so it is opt-in, the caller only opts in when the crawl was neither capped nor had extraction failures, and only `sp_`-prefixed (sync-owned) ids are eligible. "Absent from this crawl" only means "deleted upstream" if the crawl actually saw everything.
- **Claim the job row before the work, not after.** Writing only a terminal Completed/Halted row means an in-flight or hard-killed run leaves no trace and the board looks idle. Insert 'Started' first, then update the same row — and close as 'Warning' (not 'Completed') when the run hit a cap or skipped files, so a partial sync can't read as clean.
- **Any unbounded walk over external storage needs a ceiling.** `SP_MAX_FILES` bounds one crawl; without it a grown library or a mis-pointed root folder downloads everything in a single request.
- **A disabled button is not feedback.** The empty-search submit was swallowed silently because the guard was an early `return`; the form still submits on Enter. When a handler declines to act, say so (role=alert + aria-describedby), and clear it on the next keystroke.
- **Render guards belong where the size is unbounded.** Documents may be 60k chars, so the drawer renders a bounded prefix with an explicit opt-in to the rest rather than handing the whole string to the markdown renderer.

## Backlog sprint — Tier 2 data integrity & contracts — 2026-07-31

- **A per-row loop is a half-applied write waiting to happen.** The bulk upserts (`POST /api/db/sources`, `/governance/gaps`) inserted/updated row by row with no transaction, so a mid-batch failure committed the earlier rows and returned 500 — the caller reads that as "nothing happened". Wrap any batch that represents ONE user intent in `db.transaction()`, and prove it with a test whose second row violates a NOT NULL column: the assertion that the FIRST row is absent is what actually detects the missing transaction.
- **Check for consumers before "fixing" an API contract.** Standardizing the AI routes' error envelopes looked risky until a grep showed the client only calls 11 paths — `kb-chat`, `copilot-generate`, `copilot-draft`, `crm/cases`, `test-ai-connection` and `debug-db` have NO caller in the UI. That turned a compatibility question into a free cleanup, and surfaced a bigger finding (documented API surface unreachable from the product).
- **Additive first when standardizing a response shape.** Errors moved to the canonical `{success:false,error:{code,message}}`, but successes only GAINED `success:true` and kept their existing payload keys — so any future/external caller keeps working while new code can branch uniformly.
- **Dead code is graded by what contract it encodes, not by its size.** Every method deleted from `governanceRepository` read/wrote localStorage while the project invariant says SQLite is the source of truth; a future wire-up of `getReviewTasks()` would have quietly followed the wrong path. Delete on that basis — and check for mutually-referencing pairs (`documentProcessingService` ↔ `chunkRepository` each looked "used" because the other imported it, while nothing else reached either).

## Backlog sprint — Tier 1 security — 2026-07-31

- **A validation predicate applied to caller-supplied data validates nothing.** `/kb-chat` and `/copilot-draft` ran `isRetrievableDoc()` over `req.body.globalDocs/brandDocs` — the attacker controls the object, so they just send `{content:'…', approvalStatus:'Approved', status:'trained'}` and the guard passes. A governance/authorization check is only meaningful against data the server loaded itself. Same shape as trusting a client `approvalStatus` (S5) — the fix is always "re-fetch server-side, then check".
- **Filtering by the requested scope is not the same as enforcing the caller's scope.** `/api/search` filtered on the `brandId` the client sent, which looks like isolation but is self-selected: passing another brand's id returned that brand's documents. Every scoped read needs BOTH — the caller's own allowed set (authoritative) AND optional narrowing from the request, where narrowing can only shrink the set. Verify with the negative case: a scoped user explicitly requesting a foreign id must still get nothing.
- **Client-sent domain objects are an injection vector, not just docs.** `copilot-draft` accepted the whole `activeBrand` (VAT rate, pricing plans) and put it in the prompt, so a caller could make the model quote fabricated tariffs to a customer. Take the id from the request; resolve the facts from the DB.
- **Pick the KDF for where it runs.** Upgrading to a per-value salt naively means scrypt per value — and `decryptValue` runs on every AI call, so that is ~100ms added per request. Two-stage instead: scrypt ONCE at load to stretch the human secret into a master key, then HKDF per value with the random salt. Slow-KDF work stays where it belongs (against the weak input) without taxing the hot path.
- **A crypto format change needs a read path for the old format and a version tag.** `v2:salt:iv:tag:ct` vs the legacy 2-part `iv:ct`, dispatched on part count, so already-stored keys keep working and new writes upgrade in place. Prove it with a test that re-encrypts in the OLD scheme and reads it back — and against a real stored value, not only synthetic ones.
- **Re-verify a backlog before working it.** Three of the "still open" S2 items were stale: rate-limiting was already implemented, and several S6/S7 entries had been fixed in later sprints. Cheap greps first stopped work on an already-solved problem.
- **Never POST a real credential field in a smoke test.** Verifying the encrypt path by saving a canary `apiKey` overwrote a genuine stored provider key that existed nowhere else — unrecoverable. Test the round trip at the module level; when exercising a live save route, either omit the secret field (the route preserves the stored value) or capture the current value first.

## S7 App shell, layout & Settings — 2026-07-30

- **A "read-only" role must be enforced server-side, not by a disabled button.** Governance write routes used `requireTab('governance')`, which LocationManager (a legitimate tab-VIEWER) passes; the UI showed read-only but a direct POST succeeded. Tab-visibility ≠ write-authorization — gate mutations on an action the read-only role lacks (added Admin-only `manage_governance`).
- **A save that writes to a localStorage key nobody reads, with a success toast, is a lie.** BrandManager persisted to `brand_override_*` (zero readers) and claimed "calculations updated". When a real endpoint exists (PATCH /api/db/brands/:id), call it and reconcile from the response; a green toast must reflect a real server result. Grep for the storage key's readers before trusting a "save".
- **Fabricated telemetry is worse behind a "System Health" title.** SettingsTab hardcoded 99.8%/latencies/sync-logs "to feel integrated". Wire the parts with real backing (indexIntegrity + sync history from /sync/status), degrade the rest to "—"/"unavailable" or a labelled "Illustrative", and never render invented numbers as live status.
- **Partial saves that omit a field erase it.** AiProviderSettings rebuilt the config without `customEndpointUrl`, so every save wiped a stored endpoint. When PATCHing a serialized blob, round-trip every field (or have the server merge-preserve unspecified ones).
- **On a context switch, reconcile ALL scoped view state — including the active tab.** Brand/Dept auto-corrected but `activeTab` didn't, stranding a demoted user on a forbidden screen. Add an effect that redirects when the current tab is no longer viewable (same class as the S1 tenant-switch invalidation).
- **Modals need a shared stack, not per-instance document listeners.** Each Modal listening on `document` for Escape closed the whole stack, and none locked body scroll. A module-level stack fixes both: only the top responds to Escape; first-open locks scroll, last-close restores.
- **Visual-only barriers aren't barriers for assistive tech.** The idle lock trapped Tab focus but left the background readable by a screen reader's virtual cursor. Mark the background `inert` (not just `aria-modal`) and render the overlay OUTSIDE the inert subtree.
- **Under strict `TranslationDict = typeof en`, one key touches all 8 locales at once.** Adding to en breaks tsc until every locale matches; the structural-parity test is the guardrail. A hardcoded literal is still worse than an untranslated key — it can never localize (three settings panels imported no `useLocale` at all). A class component i18n's via a functional fallback sub-component, not hooks in the class.

## S6 Brands, Departments & i18n — 2026-07-29

- **i18n drift is two distinct problems — measure both.** Key-structure drift (missing/extra keys) and value drift (English left in a non-English locale) fail differently. All 8 locales here had identical key sets (0 structural drift) yet 12 keys were untranslated English — invisible to a key-count check. Script both: flatten + diff key sets, AND flag keys whose value === the English value (and contains Latin letters). ja/th are the oracle: an untranslated value shows as Latin among non-Latin, so "untranslated in ja/th === 0" is a strong, stable regression assert; European locales carry legit cognates (Marketing, Finance, "No", German loanwords Governance/Repository/Optimal) that must NOT be "fixed".
- **A color/enum→asset map must cover every value that can reach it.** COLOR_MAP listed 9 of 14 brand colors; the other 5 silently fell to the indigo default, colliding with a brand that is legitimately indigo. When a lookup has a fallback, test that every real input avoids the fallback (unless its value *is* the fallback) — a silent default is invisible without that assert.
- **Every lazy/async load needs a stale-request guard, not just an isMounted guard.** LocaleContext guarded unmount but not supersession: en→de(loading)→fr could let de resolve last and paint German under `locale==='fr'`. Same class as S1 tenant-switch invalidation and BrandContext's isMounted — capture the requested key in a ref and bail in then/catch/finally if it is no longer current.
- **A safeguard that corrects state must persist the correction.** Brand/Department auto-corrected an out-of-scope active id with the bare state setter (no localStorage write), so the stale stored id was re-read every reload and the wrong-value flash recurred forever. Use the public persisting setter.
- **Never fabricate a uniform lifecycle date across a whole dataset.** kbMapping stamped every synced doc with `expirationDate:'2026-12-31'`; since isGroundableDoc excludes expired docs, the entire KB would silently go non-groundable on 2027-01-01. Absent a real per-doc expiry, leave it undefined — a fabricated date is a time-bomb, not a harmless placeholder.
- **The outermost provider's initializer must never throw.** LocaleProvider (outermost in main.tsx) read localStorage unguarded; a throw there fails the whole app mount. Any provider initializer touching storage needs try/catch (the sibling providers already had it).
- **A hardcoded user-facing string is worse than an untranslated key.** An un-`t()`'d literal (e.g. BrandManager.tsx) can't be translated even where the locale has coverage — grep panels for raw strings, not just for missing keys.

## S5 Data layer — 2026-07-29

- **A soft-delete must be honored on EVERY read path, not just the obvious one.** DELETE set deletedAt and the library GET/governance filtered it, but `/api/search` retrieval and sync telemetry read the raw table — so deleted docs kept grounding answers and inflating counts. Centralize the exclusion (put deletedAt in the shared `isGroundableDoc` predicate) so a new read path can't forget it.
- **Any field mutated by more than one endpoint must share the same gate.** approvalStatus was gated on PATCH and the governance-decision route but trusted raw on POST — a create became a governance-queue bypass. When you harden a field's write path, grep for EVERY endpoint that writes it and apply the same authorization + enum check.
- **Denormalized nullable pointers rot silently.** `kb_document_chunks.document_id` was nullable and the seed left it NULL; a cleanup keyed on it silently matched nothing and the re-insert collided on the PK. Either make the pointer NOT NULL, or key mutations on the primary key you actually control — never on a denormalized column a writer might have skipped.
- **CREATE TABLE IF NOT EXISTS is not a migration.** New columns added only to the CREATE block never land on an existing DB; the ORM's explicit SELECT then throws "no such column". Every schema column needs a matching idempotent `ALTER TABLE … ADD COLUMN` (or a real migration tool). Add the ALTER in the same change that adds the column.
- **Client-side Zod is not validation.** BrandSchema/AiProviderConfigSchema/etc. were enforced only in React components; a direct API call bypassed them and wrote unvalidated values (an unclamped vatRate flowing into AI pricing). Validate at the server boundary — the client schema is a UX affordance, not a guarantee.
- **Don't trust an LLM to honor a response contract.** `/api/search` returned the model's JSON verbatim; a model omitting required fields produced "undefined%"/"Invalid Date" downstream. Normalize model output to the full contract server-side, same as the S4 lastSync lesson.
- **Seeds must be idempotent AND resilient to partial runs.** Gating "one-time" inserts on a single table's emptiness (kb_documents) crashed on UNIQUE when another table survived a truncate, and permanently skipped later steps after an interrupted first seed. Make every seed insert `onConflictDoNothing` and run it every boot so it self-heals.
- **Dead code that carries a contradicting value is a latent trap, not neutral.** Two unused repositories still hardcoded the fabricated telemetry / 'Approved' default that live code had fixed — a future wire-up would silently reintroduce the closed bug. Delete dead modules that encode a stale contract rather than leaving them "just in case". A bug in unreachable code is at most LOW — always state dead-vs-live explicitly.

## S4 Sources & Sync (SharePoint) — 2026-07-29

- **A sync must be subordinate to governance, never the reverse.** An idempotent "upsert the whole row" re-ingestion silently reverted every in-app decision (un-banned banned docs, reset approvalStatus/departmentIds/version, zeroed ratings) on each scheduled crawl. Rule: a re-sync refreshes ONLY content-derived fields; governance/user-owned state is preserved; a banned doc stays banned; content changes drop a doc to 'Under Review' rather than force-approving it. Never let an automated job overwrite a human decision.
- **Resolve reviewer contradictions empirically, not by vote.** Two lanes said "Run Sync always FK-500s"; one said "it fabricates a 154-record success." A curl settled it in seconds (FK error fires first). When lanes disagree on observable behavior, run it — and beware the dev server running stale code (tsx doesn't hot-reload server.ts; restart before trusting a live probe).
- **Honest telemetry must measure what the system actually does.** Replacing a fabricated 99.8%/142,500 with a real number is only half the fix — basing "index integrity" on the chunk table (a sparse secondary structure) would have shown a misleading ~1% when retrieval actually grounds on kb_documents.content (100% populated). Derive the metric from the mechanism that's really used.
- **FK + client-supplied ids: validate, don't default to a fiction.** A hardcoded default `sourceId: 'src_1'` that doesn't exist turned a NOT NULL FK into a guaranteed 500 on the happy path. Resolve to a real row or return 400 — never insert a placeholder that the schema will reject.
- **Outbound-call timeout is a codebase-wide invariant, not a per-module choice.** The AI client wrapped every fetch in withTimeout; the SharePoint client (written later) used bare fetch and could hang the request forever. When one integration establishes a resilience invariant, apply it to every peer that makes the same class of call.
- **Loading ≠ empty ≠ error.** A list that starts `[]` and fills async rendered a "no sources match your filter" message during load and on failure — telling users to fix a filter they never set. Track and render the three states distinctly.
- **Status domains must round-trip losslessly.** Mapping the client 'warning' onto a DB 'active' and reading it back as 'healthy' silently erased a governance-relevant state. Persist every value the UI can express (or the state is a lie on reload).

## S1 follow-up — search relevance & multi-doc — 2026-07-29

- **Don't let the LLM decide the citations.** `/api/search` was trusting the model's self-reported `sources` field — models cite one doc, or invent ids. The server already ranks candidates by content (`retrieval.ts`); make THAT ranking authoritative for `sources` and override whatever the model returned. Deterministic, content-based, and it naturally surfaces every similar document instead of one guess.
- **Retrieval ≠ what you show.** `selectRelevantDocuments` pads with non-matching docs (so the model always has *something* to ground on); that padding must NOT leak into user-facing "sources". Split it: `rankDocuments` returns matched-only best-first for display; the padding fallback stays internal to grounding. Empty matches ⇒ honest "no linked sources", never a fabricated citation.
- **Show WHY a doc matched.** A ranked list is far more useful with a query-centered excerpt per hit (`buildSnippet`) — it lets the user disambiguate between several similar documents at a glance. Snippet indexing must preserve length/accents (lowercase, don't NFD-strip) so the returned excerpt reads naturally.
- **Ambiguity is a feature, not an error.** When 2+ docs match with comparable score (2nd ≥ 50% of top), tell the user "N related documents matched — review the sources or refine" instead of pretending the top answer is definitive. Gate the hint on real retrieval scores so the offline fallback's decorative source pairs don't trigger a false claim.

## S1 Assistant & Copilot UX — 2026-07-29

Durable rules extracted:
- **Never render fabricated metadata as fact.** The Assistant UI was inventing a file extension (`.pdf`/`.docx` from `idx===0`) and a document version (`v1.4`/`v2.3` keyed off the answer id) that have no backing field on `KnowledgeAnswer`/`KnowledgeAnswerSource`. Rule: if a field isn't in the data model, don't display a made-up value — derive it from real data (extension from the actual source name) or drop the row. A confident-looking fake is worse than an honest omission in a governance/compliance tool.
- **Simulated content must never wear a "verified" costume.** The local keyword fallback answer was shown with a green "Verified Policy" badge and a real-looking confidence %, contradicting the "simulated response" banner. Tie trust affordances (badge, score) to `retrievalSource`: `local_fallback` ⇒ force "Review Required" + suppress the score. Thread the provenance flag all the way to the leaf component rather than recomputing trust locally.
- **`navigator.clipboard` throws synchronously when absent** (insecure context / unsupported) — a trailing `.catch()` does NOT catch it, so the handler crashes. Guard with `if (!navigator.clipboard?.writeText) { …manual-copy toast…; return; }` before calling.
- **Tenant-scoped results must be invalidated on context switch.** A brand/department change issues no new search, so the request-id guard doesn't cover it; an answer scoped to the previous tenant would stay on screen. Add an effect keyed on `${brand}|${dept}` that bumps the request id and clears result/error/source (skipping the initial-mount no-op so a preloaded query survives).
- **Persistent live region beats swapped-in aria-live.** Loading/result/error views mount and unmount, so a live region living inside them is unreliable for SR announcement. Keep one always-mounted `role=status aria-live=polite sr-only` region whose text changes with state; add `role=alert` to error alerts.
- **Panel pattern that finally stuck: reviewers-only, no synthesis agent.** The StructuredOutput synthesis agent kept hitting the retry cap; running just the reviewers and synthesizing their findings manually is robust and repeatable (same lesson as S2).
- **i18n discipline:** every new user-facing string added to all 8 locales in the same batch (`documentGeneric`, `statusSearching`/`statusResultsReady`/`statusSearchFailed`) — grep the anchor key across `src/locales/*.ts` to place them consistently.

## Iteration 4 — 2026-07-23 (fix re-audit findings + full multi-department select)

Fixed and verified (tsc + 103 vitest + curl/DB + UI):
- **[HIGH] #8 residual CLOSED**: PATCH tier-1 `approvalStatus` now gates on `canAccessTab('governance')` (Admin/LocationManager), matching the decision route. Verified TeamLeader → 403, Admin → 200. Route comment updated.
- **[MED] content-edit reconcile CLOSED**: `handleUpdateDoc` now merges the authoritative server row (version + approvalStatus) and returns it; `KnowledgeBaseTab.onSave` sets `selectedDoc` from that row. Drawer/library no longer show a stale version/Approved badge after a content edit.
- **[LOW] approve version-without-history CLOSED**: `governance-decision` no longer bumps version on approve (status transition, not a revision); the multi-target loop runs in a `db.transaction`. Verified approve leaves version unchanged.
- **[LOW] premature toast CLOSED**: `handleTransitionTask` no longer pre-emits a success toast; `updateDocumentApproval` owns the async outcome.
- **[LOW] upload response CLOSED**: POST /documents returns `parseDocRow(enriched)` (departmentIds as array).
- **[LOW] tier-3 message CLOSED**: 403 now says "Administrator, Team Leader or Location Manager".
- **FEATURE — full multi-department select**: `DocumentDetailDrawer` function editor is now a multi-select chip cloud over the whole `departmentIds` array (was a single `<select>` bound to `[0]`). `editDepartments: string[]`, order-insensitive dirty-tracking, view label joins all names. Verified: assigning IT+Sales persists `departmentIds:["it","sales"]`; no-op unrelated save no longer collapses it.

Still open (by choice): [MED] governance-decision resolves BY NAME with no brand scope (latent — no duplicate names; proper fix = carry doc id on ReviewTask); retrieval Approved-only allowlist (needs corpus re-baseline).

## Re-audit (verification pass) — 2026-07-23

Panel verdict: **9/10 original defects genuinely closed**. Closure votes: #1×8, #2×5, #3×4, #4×6, #5×6, #6×4(partial), #7×7, #9×6, #10×6; **#8 = OPEN** (0 verified). The fixes also introduced regressions. Master-prompt invariants added (authorization parity, version/history coherence, scope-on-resolve, client reconciliation, comment/message lockstep, async-owns-toast).

Open after fixes (to close):
- **[HIGH] #8 residual** — `governance-decision` is gated to `canAccessTab('governance')` but PATCH tier-1 `approvalStatus` still gates on `upload_kb` (includes TeamLeader) → TeamLeader can still approve/ban via PATCH. Two endpoints mutating one field disagree on authority.
- **[MED, regression from #4] content-edit not reconciled** — server resets to Under Review + bumps version but `handleUpdateDoc` only applies the optimistic content patch → drawer/library show stale 'Approved' + old version until refetch.
- **[MED, regression from #1/#2] governance-decision by-name is global** — no brand/scope filter → could approve/ban every same-named doc across brands (latent: no dup names); loop not in a transaction.
- **[LOW] approve bumps version with no history row** — breaks the version↔history invariant fix #4 set.
- **[LOW] premature success toast** — `handleTransitionTask` toasts success before the async `updateDocumentApproval` resolves → double/contradictory toast on failure.
- **[LOW] upload POST response** still returns `departmentIds` as JSON string (latent).
- **[LOW] tier-3 403 message** omits LocationManager (comment/message drift).

## Iteration 3 — 2026-07-23 (fixes: medium-severity items)

Fixed and verified (tsc + 103 vitest + curl/DB + UI):
- **#7 localStorage corpus mirror**: removed the effect that JSON.stringify'd the whole `documents` array on every change. Its only reader (`documentRepository`) is dead code; the server is the source of truth. No more O(n²) main-thread stringify / swallowed quota errors.
- **#9 upload integrity**: the doc + version + chunk inserts now run in one `db.transaction`, and the chunk row carries `documentId` (was NULL). Verified: upload → 1 version, 1 chunk withDocumentId, status Under Review.
- **#10 fabricated signal**: `backfillTaskFields` no longer derives priority/confidence/flags from array index. Constant neutral fallbacks (`priority 'Medium'`, `similarIncidents 0`, `flags []`), aiConfidence left untouched (drawer derives its own display fallback). A freshly reported task is no longer shown as 95%/'Price Mismatch'.
- **DocumentDetailDrawer**: Cancel/Escape now re-seed ALL edit buffers (incl. the department/region selects — previously left dirty). `handleSave` dirty-tracks: only changed fields are sent, so a no-op save doesn't hit the server (no 400) or re-version the doc, and an unrelated manager save no longer collapses a multi-department doc to a single id. Verified: no-op save exits edit cleanly and leaves the doc at v1.0/Under Review.

Remaining: retrieval Approved-only allowlist (deferred — needs corpus re-baseline). A full multi-department multi-select UI (vs the current single-select + dirty-tracking guard) is a possible enhancement.

## Iteration 2 — 2026-07-23 (fixes: critical cluster #1–#5)

Fixed and verified (tsc + 103 vitest + curl/DB + UI-reload):
- **#1 re-approval guard**: removed `'Feedback Received'` from `RESOLVED_TASK_STATUSES` (now `Grounded & Updated / Rejected / Banned`). First approval of a reported task no longer reverts; verified it STAYS resolved after a cache-cleared reload, and the doc reads Approved/v1.1 in SQLite.
- **#2 approve/ban off-page**: new `POST /api/db/documents/governance-decision` resolves the target BY NAME server-side (returns updated count + parsed docs). `updateDocumentApproval` rewritten to call it (no longer scans the paginated in-memory array); toasts when 0 docs matched.
- **#3 retrieval safety**: shared `isGroundableDoc` (exclude Banned/Draft/expired) applied to ALL three grounding paths (`/api/search`, `/api/kb-chat`, `/api/copilot-draft`). Uploads now default `approvalStatus:'Under Review'` (server + client). Kept a denylist (Approved + Under Review allowed) NOT an Approved-only allowlist — the seeded corpus is 62 Approved / 115 Under Review, so allowlist would empty retrieval; documented as a deliberate deviation.
- **#4 content edit**: PATCH content now bumps the version, resets approvalStatus to Under Review (unless a status is set in the same request), and appends a version + chunk row (with documentId) in a transaction.
- **#5 reconcile**: approval path awaits + toasts on failure/0-match; `saveReviewTasks` inspects `blockedCount` and re-fetches from the server + toasts on any rejection/failure.
- Bonus: **#6** responses parse `departmentIds` back to string[] (PATCH + decision routes via `parseDocRow`); **#8** governance decisions gated to `canAccessTab('governance')` (TeamLeader → 403), matching who may act on the queue; structured `bumpVersion` (no parseFloat).

Still open (not in this batch): #7 localStorage full-corpus mirror (perf); #9 UPLOAD path transaction + upload chunk documentId still null; #10 position-based backfill fabrication; multi-department `<select>` collapse + Cancel/Escape buffer reset in DocumentDetailDrawer; retrieval Approved-only allowlist (needs corpus re-baseline).

## Iteration 1 — 2026-07-23 (audit of recent governance/metadata/upload/preview work)

Panel: 8 reviewers (QA, Security, Performance, React, Backend, Knowledge Architect, Docs, Architecture Board) → 40 raw findings → synthesized.

### Learnings
1. Never derive a server mutation target from a paginated/filtered client array — carry a stable id and resolve/persist server-side, then update local state opportunistically.
2. Optimistic UI against a declared source-of-truth must await the response and reconcile (roll back + toast) on any failure or sanitized result; fire-and-forget `.catch(log)` guarantees silent divergence.
3. A safety allowlist beats a single-value denylist: gate retrieval on `approvalStatus==='Approved'` (and not expired), on EVERY grounding path, not just one endpoint.
4. When adding a PATCH field, decide its permission tier explicitly and make the gate match who is allowed to act in the corresponding UI/queue — reusing a broader permission (upload_kb) creates privilege-boundary mismatches.
5. Any status/enum that doubles as both a fresh-intake and a terminal state will break guard logic — keep intake and resolved states disjoint (or track terminal state with a separate marker).
6. Write-path responses must return the exact same field shapes as the read path (parse JSON-text columns back to arrays); mismatched shapes cause intermittent client crashes a refresh hides.
7. Group multi-row inserts (doc+version+chunk, batched gaps) in a transaction and validate NOT NULL fields up front so a partial failure never leaves a live-but-inconsistent row.
8. Never fabricate governance/risk signal from array position/index-based defaults, and never mirror full-content corpora into localStorage on every render.

### Top findings (most severe first) — status
- **[HIGH] Approve/ban no-ops for docs off the loaded/other-brand page** — `updateDocumentApproval` matches by `doc.name` against the paginated in-memory `documents`; off-page targets get no PATCH yet the task is marked resolved. CONFIRMED.
- **[HIGH] Re-approval guard blocks the FIRST approval** — `RESOLVED_TASK_STATUSES` includes `'Feedback Received'`, which is also the report intake status; server reverts the first approve while the doc is already PATCHed → permanent task/doc desync on reload. CONFIRMED (activated once the queue started using POST /tasks).
- **[HIGH] Retrieval safety is a denylist on one path** — only `/api/search` excludes Banned; `/api/kb-chat` & `/api/copilot-draft` don't check approvalStatus; uploads are hardcoded Approved. CONFIRMED (scope of the ban filter was /api/search only).
- **[HIGH] Content edits keep Approved without re-review/re-version** — owner/manager PATCH of `content` leaves approvalStatus Approved; versions/chunks not updated. CONFIRMED (design gap).
- **[HIGH] Optimistic writes never reconciled** — `updateDocumentApproval` + `saveReviewTasks`/`saveSearchGaps` are fire-and-forget, ignore `blockedCount`/failures. CONFIRMED.
- **[HIGH] PATCH/upload responses return `departmentIds` as JSON string** — read path parses to array, write path echoes raw. Latent contract break (current callers ignore the response body). CONFIRMED as inconsistency.
- **[HIGH] localStorage mirrors the full doc corpus on every change** — O(n²) stringify, quota error swallowed. PRE-EXISTING perf issue.
- **[MED] TeamLeader can approve/ban via API** despite being excluded from the governance tab (tier-1 gated on upload_kb). CONFIRMED.
- **[MED] Single-select department collapses multi-department docs** to `[departmentIds[0]]` on save; Cancel/Escape don't reset the function/region buffers. CONFIRMED.
- **[MED] Position-based backfill fabricates confidence/flags** for reported tasks (index 0 → 95% + invented flags). CONFIRMED (`backfillTaskFields`).
- **[MED] Upload path: no transaction, chunk `documentId` null, client row shows APPROVED** before review. CONFIRMED.
