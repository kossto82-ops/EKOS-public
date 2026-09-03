# Knowledge Base — Index

This folder holds a small set of demo knowledge-base articles used to exercise
the Hub's search/chat grounding. The demo corpus itself lives as JSON snapshots
under [`src/data/`](../../src/data/) and is loaded via
[`src/constants/kb.ts`](../../src/constants/kb.ts).

| Article | Domain | Scope |
|---|---|---|
| [`glossary.md`](./glossary.md) | Glossary | Shared terminology used across the demo KB |

**Demo corpus:** the ingested articles (governance SOPs, brand overviews, product
plans, customer-service scripts, telephony carrier setup, billing, FAQs and a few
manual uploads) are synthetic content for the fictional **Northwind Contact
Solutions** and its brands. They are seeded into the SQLite database as
`kb_documents` rows (category e.g. `Carrier Guide`) so the Hub's search/chat can
ground answers on them.

**Call forwarding:** carrier setup for the demo is covered by
`src/data/callforwarding-kb-snapshot.json` (fictional carriers such as TeleNord,
IberLink and Rhonecom).
