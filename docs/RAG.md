# Retrieval-Augmented Generation (RAG) Architecture

**Purpose:** This document details the algorithmic strategies, embedding configurations, indexing topologies, hybrid search models, and context optimization guidelines used in the platform's RAG pipeline.
**Owner:** Principal AI Scientist / Architect
**Last Updated:** 2026-06-26
**Status:** Approved Template

> **Target vs. actual.** §1–§4 describe the aspirational pipeline. **§5 is the
> only normative section** — it documents what the code actually does. The gap
> is now narrow but real: chunking, embeddings, a vector index, hybrid search
> and reranking all exist; the vector index is a brute-force cosine scan rather
> than HNSW, and the reranker is an LLM judge rather than a cross-encoder. Both
> deviations are deliberate and explained in §5. See also
> [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

---

## 1. Document Chunking & Ingestion Strategy

To ensure precise context delivery to the conversational agent, documents are split into logical segments:

- **Chunking Method**: Text-boundary aware chunking with character-count overlaps.
- **Segment Bounds**: Target length of 500 tokens (approximately 2000 characters) per chunk.
- **Overlap Baseline**: 10% overlap (50 tokens / 200 characters) to ensure continuity at segment boundaries.
- **Special Formatting Handling**: Code blocks, JSON objects, and data tables must be preserved as single cohesive chunks.

---

## 2. Embedding Model & Vector Schema

- **Embedding Model**: Industry-standard high-dimensionality representation (e.g., 768-dimension or 1536-dimension vectors).
- **Metric Distance Calculation**: Cosine Similarity or Inner Product metrics are preferred for distance assessments.
- **Indexing Topology**: Specialized tree-based indexes (e.g., Hierarchical Navigable Small World - HNSW) are utilized to achieve sub-second lookup performance under high loads.

---

## 3. Hybrid Search & Retrieval Workflows

The platform leverages a hybrid query pipeline to balance literal keyword precision with semantic contextual awareness:

```
                              +-------------------------+
                              |    User Query Input     |
                              +-------------------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
                    v                                             v
       +-------------------------+                   +-------------------------+
       |   Keyword Match Index   |                   |    Vector Search Index  |
       |  (BM25 / Database SQL)  |                   |     (Semantic Match)    |
       +-------------------------+                   +-------------------------+
                    |                                             |
                    +----------------------+----------------------+
                                           v
                              +-------------------------+
                              |   Reranking / Filtering |
                              | (Cross-Encoder / RBAC)  |
                              +-------------------------+
                                           |
                                           v
                              +-------------------------+
                              |   Optimized Context     |
                              |  (To Conversational API)|
                              +-------------------------+
```

---

## 4. Context Window Optimization

- **Citation Aggregation**: Every text chunk returned by the search engine must retain its source document identifier, page index, and business owner.
- **Prompt Isolation**: System instructions must be isolated from retrieved context chunks using structured markup tags (e.g., `<context>` blocks) to prevent prompt injection attempts.
- **Token Budget Allotment**: The system reserves a fixed budget (e.g., 20% of the model context window) for system prompts and user questions, with the remaining 80% dynamically allocated for retrieved source context.

---

## 5. Actual Retrieval (Normative)

Retrieval is **hybrid**: a lexical ranker fused with semantic chunk search, with an optional LLM reranking stage. Every component degrades to the lexical path rather than failing.

### 5.1 Modules

| Concern | Implementation |
| --- | --- |
| Chunking | `src/server/chunking.ts` |
| Embeddings (multi-provider) | `src/server/embeddings.ts` |
| Vector index + backfill | `src/server/vectorStore.ts` |
| Lexical ranking | `src/server/retrieval.ts` |
| Fusion + grounding assembly | `src/server/hybridRetrieval.ts` |
| Reranking (opt-in) | `src/server/reranker.ts` |
| Provider key resolution | `src/server/providerConfig.ts` |
| Groundability gate | `src/server/grounding.ts` |

### 5.2 Chunking

`chunkText()` groups the body into structural blocks (fenced code, markdown tables, paragraphs, headings) and packs whole blocks into ~2000-character chunks with ~200 characters of overlap, splitting a block internally only when it alone exceeds the 3000-character ceiling. Fenced code and tables are kept cohesive, per §1. Each chunk records the heading it sits under, so a retrieved passage can be attributed to a section and not just a file.

Every ingestion path writes real chunks — SharePoint sync, document upload, in-app content edit, and the seed. Chunk ids are deterministic (`<versionId>_c<index>`), so re-ingesting a version overwrites its own rows; a content edit deletes the previous version's chunks so superseded text cannot stay searchable.

Sizes are in **characters, not tokens**: a tokenizer would be another dependency and the ~4 chars/token heuristic is accurate enough to size a budget.

### 5.3 Embeddings

Multi-provider (`gemini`, `openai`, `custom` — any OpenAI-compatible endpoint, e.g. Ollama), configured independently of the chat provider via the `ai_embedding_config` governance row or `EMBEDDING_*` environment variables. The chat and embedding providers are separate choices on purpose: a deployment may chat via Groq, which serves no embedding models.

- Vectors are **L2-normalized on write**, so cosine similarity downstream is a plain dot product.
- Documents and queries are embedded with different task hints (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`) where the provider supports it.
- Every stored vector records an **embedding signature** (`provider:model[:dims]`). Vectors from different models are not comparable, so vector search filters on an exact signature match. Changing the model invalidates the whole index in one step — by design — and requires a re-run of the backfill.
- Key resolution mirrors `callAI`, including the rule that a **caller-supplied endpoint never receives a server-held key** (see [SECURITY.md](./SECURITY.md)).

**Backfill is explicit, never implicit.** Nothing embeds at ingest time; chunks are written with `future_embedding_status = 'pending'` and vectorized by `POST /api/embeddings/backfill` (settings-tab roles only). Embedding a whole corpus costs provider calls, so it must not fire as a side effect of a boot or a sync. `GET /api/embeddings/status` reports coverage, so "does this deployment actually have semantic search?" is a checkable question.

**Migrating a pre-chunking corpus.** The chunker runs at ingest time only, so a database populated before it existed still holds one blob per document — the live corpus was 200 documents in 202 chunk rows, the largest 60k characters, which every embedding provider rejects. `rechunkDocuments()` (`src/server/reindex.ts`, exposed as `POST /api/embeddings/backfill {"rechunk": true}`) rebuilds those rows from `kb_documents.content`, re-attaching them to the version id the old rows already pointed at. It is idempotent — a document already matching the current chunker is skipped, embeddings and all — so it is also the way to roll out a future chunker change. On the current corpus it produces 685 chunks, none oversized.

**Run once on an existing database:**

```bash
curl -X POST http://localhost:3000/api/embeddings/backfill -H 'Content-Type: application/json' -H 'Authorization: Bearer <admin-id>' -d '{"rechunk": true}'
```

### 5.4 Vector index

A **brute-force cosine scan** over vectors cached in memory as `Float32Array`s — not an ANN index. At this corpus size (214 live documents; 252 are authored across the three data files and 40 are soft-deleted, see eval/task-gaps.md — and low thousands of chunks) an exhaustive dot product costs single-digit milliseconds, while the HNSW topology described in §2 would add a native dependency, an index-rebuild lifecycle and a recall cliff for a speedup nobody can perceive. The cache is invalidated by a fingerprint over the embedded-chunk count and latest `updated_at`.

**Swap point:** brute force stays comfortable to roughly 100k chunks on a single node. Past that, `searchChunks()` is the seam to replace with a real ANN index.

**Where the time actually goes.** Measured against the running app, with the per-stage breakdown `/api/search` now returns:

| Stage | Warm | Notes |
| :--- | :--- | :--- |
| Load caller-scoped candidates | negligible | 214 live rows out of `kb_documents` |
| Lexical ranking | negligible | accent-folded scan of the same set |
| Vector cache build | 77 ms, once | 685 vectors out of SQLite into `Float32Array`s |
| **Query embedding** | **~350 ms** | one provider round-trip, per search |
| Answer generation | 1.5–2.7 s | the LLM |

So in steady state, retrieval's ~350 ms is essentially the embedding call and nothing else — not the corpus, not the scan. Both caches are now warmed at startup (`warmVectorCache`, before `listen`, because it is synchronous CPU work; `warmEmbeddingProvider`, after and unawaited, because it is network I/O and must not be able to hang boot).

**The caveat that startup warming does not fix:** the provider's first call is far slower than the rest, and that penalty belongs to the *endpoint*, not to this process. Against a self-hosted model server the measurements were 2265 ms for call 1 against 318–383 ms for calls 2–5, and after seven idle minutes it went cold again (3452 ms, then 278 ms). A model server that unloads on an idle timer — Ollama's default `keep_alive` is 5 minutes — therefore charges the first person to search after any quiet spell. That is fixed where the model runs, by keeping it resident, not here.

### 5.5 Hybrid fusion

`hybridRetrieve()` runs both retrievers and combines them with **Reciprocal Rank Fusion** (k = 60): each contributes `1/(k + rank)`. RRF needs no score calibration between a term-frequency count and a cosine similarity — which is exactly the problem with a weighted sum, since those two numbers share no scale.

The lexical ranker is **kept, not replaced**: it beats embeddings on exact-token queries (product codes, policy numbers, brand names), which are a large share of this KB's traffic. Vector search covers paraphrase, synonymy and cross-lingual matches, where a term-frequency score is simply zero.

**Semantic cut-off is relative, not absolute.** An absolute cosine floor assumes a score scale the model does not promise. Measured on this corpus with `bge-m3`, similarities compress into a narrow band — min 0.31, median 0.44, best 0.55–0.69 — so the original 0.3 floor admitted **every chunk in scope and filtered nothing**. The real filter keeps chunks scoring within 90% of the query's best chunk (`HYBRID_VECTOR_RELATIVE_FLOOR`); the absolute floor remains only as a degenerate-vector guard. The ratio survives a change of embedding model where an absolute cut does not.

**Tie-breaking.** RRF scores collide constantly: a document ranked 1st by only the lexical side and one ranked 1st by only the vector side both score `1/(k+1)`. Left to sort stability that resolves by insertion order — always lexical, for no reason. Observed here: the query *"¿Cuánto tiempo tengo para cancelar y que me devuelvan el dinero?"* put a telephony FAQ (4 incidental term hits, no semantic match) above the Refund Policy SOP (cosine 0.686, zero term overlap). Ties now break on **retriever agreement** first, then on cosine similarity — a calibrated quantity, unlike a raw term count that scales with document length.

> **Open:** this orders ties; it does not *weight* the retrievers against each other. Picking a real weighting needs a labelled set of **real** queries. The relative floor and the RRF constant are now swept against a synthetic set (§5.8) — measured, but on data that over-represents paraphrase and cross-lingual questions.

Semantic search is scoped to the candidate document ids **the caller is already allowed to see** — the vector index holds every chunk regardless of brand/department scope or groundability, so that filter is what keeps a banned or out-of-scope document out of an answer.

**Degradation is explicit — and now visible.** No provider configured, nothing embedded, or a provider error ⇒ lexical-only results, `mode: 'lexical'`, and a `degradedReason`. Search never fails because semantic search is off. The API reports this back as `retrievalMode`, alongside `vectorSimilarityThreshold` (the cosine floor actually applied, `0` when lexical-only) and `indexVersion` (the embedding signature, or `lexical-only`) — fields that previously returned hardcoded constants.

> **This was reported and then discarded.** Until 2026-08-06 `retrievalMode` crossed the API and died in `src/types/apiContracts.ts` as an unread optional field: the client only ever read `retrievalSource`. So a keyword-only answer — the mode that scores **hit@1 0.0%** on the labelled set (§5.8) — was presented with the same confidence score and verified badge as a full hybrid one. "Explicit degradation" was true of the server and false of the product. Three things close it: startup logs missing embeddings at `error` level, `GET /readyz` carries the `vectorIndex` check, and `SearchResultPanel` renders a keyword-only warning banner (translated into all eight locales) above any answer whose `retrievalMode` is `lexical`. The banner is deliberately separate from the existing simulated-answer one: that means the *LLM* was unavailable, this means the *retriever* was, and both can be true at once.

### 5.6 Reranking (opt-in, off by default)

§3 names a cross-encoder. **There is no cross-encoder model here**; `rerankDocuments()` asks the configured chat model to score query/passage pairs at `temperature: 0`. That is a real reranking stage with a real quality effect, but it is slower and costlier per query than a dedicated cross-encoder, so it is enabled only via `ai_reranker_config.enabled` or `RERANKER_ENABLED=true`, and only on `/api/search` (kb-chat and copilot-draft are latency-sensitive interactive paths).

It reorders **before** the grounding passages are assembled, so it improves the answer and not merely the citation list. It can only reorder or drop candidates retrieval already found — `hybridRetrieve` re-asserts scoping on the result — and any failure (provider error, unparseable output, no scores) returns the fused order untouched.

### 5.7 Pipeline for `POST /api/search`

1. **Candidate set** — load `kb_documents`, apply the caller's brand/department scope and the groundability gate.
2. **Grounding gate — `isGroundableDoc(doc)`** — a **denylist**: excluded if soft-deleted (`deletedAt` set), `Banned`, a `Draft`, or past its `expirationDate`. (`Approved` **and** `Under Review` are both allowed — an allowlist of `Approved`-only would empty the seeded corpus; a documented deliberate deviation.) The **same** predicate applies on every grounding path — `/api/search`, `/api/kb-chat`, `/api/copilot-draft`.
3. **Lexical ranking — `rankDocuments()`** — accent-folded overlap of the query against document content and name; matched-only, best-first.
4. **Semantic ranking — `embedQuery()` + `searchChunks()`** — top chunks by cosine similarity, scoped to the candidate ids and cut relative to the query's best chunk (§5.5); documents are ranked by their single best chunk.
5. **Fusion — RRF** — produces the authoritative ranked document list. This populates the user-facing `sources`: the server overrides whatever the LLM self-reports, so citations are deterministic and content-based (empty ⇒ an honest "no linked sources", never a fabricated one).
6. **Reranking** — optional, as above.
7. **Snippet — `buildSnippet()`** — a match-centered excerpt, taken from the **winning chunk** when the semantic side found the document, so the user sees the passage that actually matched.
8. **Grounding context — `renderGroundingBlock()`** — concatenates the matched **passages** (not whole documents), each labelled with its source document and section, within the same budget as before (5 documents / 24k characters / 8k per document). `padWhenEmpty` lets the chat paths fall back to document heads when nothing matched; that padding stays internal and never appears in `sources`.
9. **Disambiguation** — when 2+ documents match with comparable score, the UI surfaces an "N related documents matched" hint instead of implying a single definitive answer.

**Prompt-injection defense:** the non-negotiable grounding instruction is reasserted **last** in the prompt so a client `systemPromptOverride` cannot countermand it (see [SECURITY.md](./SECURITY.md) §3).

**Answer formatting contract.** The system prompt states the structure of the answer body explicitly (`ANSWER_CONTENT_FORMAT_CONTRACT` in `src/server/routes/ai.ts`): mirror the source document's `##` sections, render any procedure as a numbered list with one action per item, enumerations as bullets, source tables as GFM tables, and reproduce identifiers/codes/values verbatim — never inventing structure the source lacks. It used to say only "content (markdown)", and with no structure requested the model formatted to taste: the same SOP came back as headed, numbered steps in French and as prose in the other seven locales. The contract is stated **before** the language instruction and is byte-identical in every locale, because structure is a property of the source document, not of the answer's language (`tests/searchAnswerFormat.test.ts`).

---

### 5.8 Evaluation

Every parameter above was chosen by judgement. This is the apparatus that turns them into measured decisions.

```bash
npx tsx scripts/generate-eval-set.ts --docs 60 --per-doc 1   # build/refresh the synthetic half
npx tsx scripts/eval-retrieval.ts --json eval/baseline.json  # score lexical vs hybrid
npx tsx scripts/eval-retrieval.ts --rerank                   # is the reranker worth its round-trip?
```

Metrics live in `src/server/evaluation.ts` (pure, unit-tested): hit@1/3/5, recall@5, MRR, and a miss list — the misses are the actionable output, since an aggregate never tells you what to fix.

**Baseline, 63 labelled queries (60 synthetic + 3 curated real) over 281 groundable documents, bge-m3** (headline table regenerated 2026-08-14 via `npm run eval:refresh`, which seeds a clean corpus, fully embeds it, and re-runs the eval — so these numbers are reproducible and not a drifted snapshot):

`eval/baseline.json` is the committed run, and it stamps the retrieval config it was
produced under (`config.vectorRelativeFloor`, `minVectorScore`, `rrfK`, `topK`).
`tests/docsDrift.test.ts` pins that stamp to the constants in `hybridRetrieval.ts`, so
moving a retrieval parameter without re-running the eval fails CI — the baseline had
previously gone stale against the tuned floor with nothing able to detect it (ADR 030).
The bold row is the shipped configuration; lexical-only is the baseline any semantic
work must beat.

| | hit@1 | hit@3 | hit@5 | MRR | misses |
| --- | --- | --- | --- | --- | --- |
| lexical only | 27.0% | 42.9% | 52.4% | 0.363 | 30/63 |
| **hybrid (floor 0.95, shipped)** | **73.0%** | **84.1%** | **88.9%** | **0.790** | **7/63** |

> **Corpus note (2026-08-14):** the corpus now includes two owner-authored domains from
> SharePoint — Sugar CRM / CMT (8 docs) and Routing Manager (11 docs). The 3 curated real
> queries above validate the Sugar domain (all retrieve). The RM curated docs (`rmgr_*`,
> UI how-tos) are ingested but on shared vocabulary they compete with the ~58 legacy `rm_`
> docs (e.g. a "routing priority matrix" query surfaces the *pricing* `rm_price-list-matrix`
> on the shared "matrix" token), so adding RM eval queries is **deferred**.
>
> **Correction (2026-08-20):** an earlier revision of this note called the `rm_` docs
> "scrapes … covering the same ground" and proposed retiring/deduplicating them as "the real
> fix". That was investigated and **refuted** — the `rm_` docs are not duplicates. They are
> unique engineering / PMI reference material (DB2 schema, hard-constraint implementation
> classes, redirector cache internals, REST endpoint maps, Confluence provenance) synthesised
> from code + Confluence + live API snapshots; the `rmgr_*` docs are UI how-tos for the
> Northwind ES brand. They serve **different intents and are complementary**, not redundant.
> Deletion was rejected (it would destroy irrecoverable knowledge). The competition is an
> intent-overlap / reranking nuance on shared terms, not a corpus-duplication problem — there
> is nothing to dedup. The RM eval queries stay deferred for that reason; the `rm_brand` /
> `rm_waiting-queue` misses are likewise not "blocked by scrapes" and need a genuine relevance
> fix, not a retirement.

The cross-lingual breakdown and the tuning sweep below were measured on an **earlier
189-document corpus** (before the 2026-08-14 refresh grew and re-embedded it); the
shipped floor (0.95) is unchanged, but treat their absolute numbers as indicative of
that earlier run, not the table above. On that earlier set, cross-lingual queries
(34 of 60) scored *higher* under hybrid than same-language ones — 79.4% vs 65.4% hit@5
— which is what an aligned multilingual embedding space should do, and something term
matching cannot do at all (5.9% and 3.8%). Regenerate the headline table with
`npm run eval:refresh`; a full floor sweep would refresh the tuning tables.

#### Tuning outcomes

The parameters below were swept against this set. Two changed as a result; one was kept, on evidence rather than inertia.

**Relative floor — changed, 0.9 → 0.95.** The hand-picked value was leaving ten points of hit@5 on the table:

| floor | 0.75 | 0.8 | 0.85 | 0.9 | **0.95** | 1.0 |
| --- | --- | --- | --- | --- | --- | --- |
| hit@5 | 46.7% | 53.3% | 61.7% | 73.3% | **83.3%** | 75.0% |
| MRR | 0.264 | 0.311 | 0.418 | 0.565 | **0.707** | 0.738 |
| misses | 32 | 28 | 23 | 16 | **10** | 15 |

1.0 — keep only the single best chunk — wins hit@1 and MRR but loses recall and adds misses back. 0.95 is the balance.

**Reranking — measured, still off by default.** Over 20 queries, hybrid+rerank beat hybrid on every metric: hit@1 50% → **70%**, hit@5 75% → **85%**, MRR 0.597 → **0.732**, misses 5 → 3. That is a real effect, but n=20 makes the size of it uncertain, and it costs an extra LLM round-trip per search — enough to exhaust a free provider tier (Groq's 12k tokens/minute) under normal use. Enable it with `RERANKER_ENABLED=true` when your provider tier has the headroom; the measurement says it will help.

**RRF constant — kept at 60.** Swept 10/30/60/120: hit@5 is flat at 83.3% for the first three, and hit@1 varies 68.3% / 65.0% / 63.3% / 63.3%. k=10 nominally wins, but the gap is three queries out of sixty — inside the noise for this sample — and a lower k sharpens the influence of rank 1, which on a set biased toward semantic matches means "trust the vector ranking more". That is exactly the bias this set has, so the apparent win may not transfer. The paper default stands until real queries can settle it.

#### Read these numbers with the biases in mind

**The set under-represents lexical retrieval.** The generator is instructed to paraphrase and to avoid the source document's distinctive terminology, and two thirds of the questions are asked in a different language than the document. That was a deliberate correction for the *opposite* bias — a naive synthetic set echoes document vocabulary and flatters term matching — but it overshot. Real agents often type exact product names and policy numbers, where the lexical ranker is strong; a 5% lexical baseline is an artefact of this set, **not** a measurement of lexical retrieval on real traffic. The honest claim is narrower than the table looks: hybrid is dramatically better *on paraphrased and cross-lingual questions*, the class lexical cannot serve at all. It is not 15× better in general, and the lexical half stays in the fusion for good reason.

**Some "misses" are mislabelled, not missed.** A generated question is labelled with the single document it came from, but another document may answer it as well or better. Example from the run: *"What steps are required to update a customer's bank account information for direct debit payments"* is scored a miss because retrieval returned `Change_Bank_Details.md` while the label says `Country_Specific_Info.md`. Treat these metrics as a **lower bound**, and read the miss list before acting on the number.

**No real queries yet.** `source: 'real'` entries are merged and reported separately, and the generator preserves them across regeneration. Until they exist, this measures the plumbing more than the relevance. `/api/search` now records every query to `kb_queries_audit` with its retrieval mode, and files zero-result queries as `kb_search_gaps`, so the raw material accumulates on its own.
