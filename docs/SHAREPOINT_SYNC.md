# SharePoint Knowledge Base Sync

**Status:** Snapshot ingestion active · Live Graph sync ready (dormant until credentials are set)
**Owner:** Customer Service Operations

EKOS is grounded on the real **Northwind ES Knowledge Base** held in the
Customer Service Department SharePoint site:

```
officeplatform.sharepoint.com
  └─ sites/CustomerServiceDepartment
       └─ Shared Documents/Brand ES - Northwind ES/Knowledge Base
```

That library (SOPs, telephony carrier setup, billing, customer-service scripts,
systems guides, FAQs) is the single source of truth for the Knowledge Assistant
search and chat.

---

## Two ingestion paths

Both paths converge on the exact same row shape via one pure mapping module
(`src/constants/kbMapping.ts`), so the app behaves identically whichever one
produced the data.

### 1. Snapshot (active by default — no credentials required)

The library was crawled and serialized to:

```
src/data/sharepoint-kb-snapshot.json
```

`src/constants/kb.ts` imports that JSON and maps it to `KBDocument` rows, which
`src/db/seed.ts` loads into SQLite on first boot. This is why the app works out
of the box with real content and no Azure setup.

To refresh the snapshot without credentials, re-run the connector-based crawl
(the assistant that produced the committed file) and overwrite the JSON.

### 2. Live Microsoft Graph sync (enterprise path — dormant until configured)

The server can crawl SharePoint directly using its own Azure AD app
registration (OAuth2 client-credentials). This requires **no interactive user
session** and enables scheduled/on-demand refresh.

It stays inert until every `SP_*` env var below is set. Until then,
`GET /api/db/sync/sharepoint/status` reports `configured: false` and
`POST /api/db/sync/sharepoint` returns a clear "not configured" message instead
of failing.

---

## Enabling live sync

1. **Register an Azure AD application** in the tenant that owns the SharePoint site.
2. Grant it the **application** permission `Sites.Read.All` (or `Files.Read.All`)
   and have a tenant admin **grant admin consent**.
3. Create a **client secret**.
4. Find the target **drive id** and **root folder id** for the Knowledge Base
   library. Current values (Brand ES / Northwind ES):
   - `driveId`: `b!TTjwxwa8KkSAVZUQEFhpbx4f0cadsGZDuajEc5a65SEr9F_MG9PtTaCf9t4Qat9S`
   - `rootFolderId`: `01AKSN5MKWJATZFHGZI5EIPJL4CLJKXQC7`
5. Populate `.env` (see `.env.example`):

   ```env
   SP_TENANT_ID=<tenant guid or domain>
   SP_CLIENT_ID=<app registration client id>
   SP_CLIENT_SECRET=<client secret>
   SP_DRIVE_ID=b!TTjwxwa8KkSAVZUQEFhpbx4f0cadsGZDuajEc5a65SEr9F_MG9PtTaCf9t4Qat9S
   SP_ROOT_FOLDER_ID=01AKSN5MKWJATZFHGZI5EIPJL4CLJKXQC7
   # optional
   SP_EXCLUDE_FOLDERS=99 - Archive
   ```

6. Sync:
   - **On demand from the app:** the Sync tab → `POST /api/db/sync/sharepoint`
     (crawls + upserts into the KB in place).
   - **From the CLI:** `npm run ingest:sharepoint` (crawls + rewrites the
     committed snapshot JSON).

---

## What the mapping does

`src/constants/kbMapping.ts` (dependency-free, shared by client seed and server
sync):

| KBDocument field   | Source                                                            |
|--------------------|-------------------------------------------------------------------|
| `id`               | `sp_<SharePoint item id>` (stable ⇒ idempotent re-sync)           |
| `category`         | top-level folder (`07 - Telephony` → `Telephony`, etc.)          |
| `content`          | extracted text, YAML frontmatter stripped                        |
| `owner`            | frontmatter `owner` (placeholders like `[INFORMATION REQUIRED]` ignored) |
| `department`       | frontmatter `business_area` (leading segment) or the category    |
| `approvalStatus`   | frontmatter `status` (`In Review` → `Under Review`, …)           |
| `scope` / `departmentScope` | **always `global`** — see design note below              |

### Design note: global scope

Every document is ingested as `scope: 'global'` and `departmentScope: 'global'`,
so real content is visible under any brand/department filter. The brand and
department rosters in the app are still the demo taxonomy; wiring the SharePoint
`brand:` / `business_area:` frontmatter into a real brand/department model is a
separate follow-up and is intentionally out of scope for this ingestion.

File types: `.md`/`.txt`/`.csv`/`.json` are read as text; `.docx` via `mammoth`;
`.pdf`/`.xlsx` are currently skipped by the live crawler (empty body) to avoid a
heavier server dependency chain. The `99 - Archive` folder is excluded.

### Duplicate files in one crawl

The SharePoint index can return the same file twice — once under its real name
and once under the Windows 8.3 short name (`TOTP_C~1.MD` alongside
`TOTP_Configuration_Audelia.md`). Each entry carries its own item id, so both
used to become independent `kb_documents` rows holding the same text: search
ranked both, and deleting one left the other answering identically —
indistinguishable, from the user's side, from a delete that did not stick.

`upsertKbDocuments` now fingerprints each crawled body (whitespace-collapsed,
case-insensitive SHA-256) and ingests one row per fingerprint. The winner is
chosen from the **name**, not from crawl order, so the outcome is stable across
runs: a real name beats an 8.3-mangled one, then the more descriptive (longer)
name wins, and the item id breaks any remaining tie. The count is reported as
`skippedDuplicate` in the sync response.

Skipped twins are absent from the run's seen-ids set, so on a **complete** crawl
the reconciliation pass (which soft-deletes sync-owned documents the crawl no
longer returns) tombstones a twin that is already in the KB — the duplicate is
cleaned out of a populated library, not merely kept out of a fresh one. A
partial crawl never tombstones anything.

The match is exact by design, never fuzzy: two documents that genuinely differ
in wording are two documents (the library holds two overlapping *Employee
Directory Transformer* write-ups, by different authors, that must both survive),
and merging them would destroy content.
