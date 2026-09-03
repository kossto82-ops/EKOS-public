# Information Architecture & Navigation Map

**Purpose:** This document defines the structural sitemap, content modeling schemas, data relationships, and search retrieval paths for the Enterprise Knowledge Platform. It organizes the functional views for user navigation.
**Owner:** Staff UX Architect / Information Architect
**Last Updated:** 2026-06-30
**Status:** Approved Template

---

## 1. Unified Application Sitemap

The application uses a flat workspace layout to prevent nested navigation loops.
Seven top-level destinations, one job each:

```
                                +---------------------+
                                |    Main Workspace   |
                                |    (Global Entry)   |
                                +---------------------+
                                           |
   +-----------+-----------+-----------+-----------+-----------+-----------+
   |           |           |           |           |           |           |
   v           v           v           v           v           v           v
+--------+ +--------+ +--------+ +--------+ +--------+ +--------+ +--------+
|Assistant| |Knowledge| | Review | |Sources | |  Sync  | |Governance| System |
|(search)| |  Base  | | Queue  | |(origin)| |(ingest)| | (admin)| | Health |
+--------+ +--------+ +--------+ +--------+ +--------+ +--------+ +--------+
              |           |                                |
        Repository   the review/    AI provider, brands,
        + Metrics    approval        teams, policies
                     workflow
```

**The review queue is its own destination as of 2026-08-07.** It used to be a
third sub-tab inside the Knowledge Base, which meant one screen served three
different jobs — browsing the repository, reading analytics, and approving
content — switched by an internal control. A document librarian and a compliance
reviewer were sent to the same place and had to know which sub-tab was theirs.

Two things worth recording because they are easy to get wrong again:

**Review Queue and Governance are not the same concept and must not be merged.**
Governance holds platform administration — AI provider configuration, brands,
teams, policies — which is consulted occasionally. Review Queue is a daily
operational workflow with its own keyboard-driven grid. An audit initially read
the split as a duplication of governance; it is not, and the naming is what
caused the confusion rather than the structure.

**The sidebar labels were part of the problem.** The Knowledge Base tab was
called "Queue" while the actual queue sat two clicks inside it. The knowledge
base is now named for what it holds and the queue name went with the queue.

The one workflow that spans the split — resolving a search gap from Metrics,
which opens the sandbox editor that now lives on the review queue — hands its
payload over through `src/utils/crossTabIntent.ts` rather than a window event.
Only one tab is mounted at a time, so an event dispatched by the outgoing tab
reaches no listener; the receiver drains a slot on mount instead. That is
recorded here because the first implementation used an event, the action silently
did nothing, and the shape of the mistake is easy to repeat.

---

## 2. Core Entity Modeling Matrix

All data indexed or displayed across the views must conform to these entity rules:

| Entity Name | Primary Key Scheme | Core Attributes | Relationships | Access Boundary |
| :--- | :--- | :--- | :--- | :--- |
| **Document** | Unique String ID | Title, Owner, Version, Security Tag, File Type, Status, Brand ID, Scope, Department Scope, Department IDs | Belongs to a single Knowledge Source; contains multiple Chunks. | Enforced by brand-level and department-scoped access controls (DAC). |
| **Knowledge Source**| Source ID | Source Type, Source URI, Sync Status, Indexing Schedule, Department Scope, Department IDs | Owns many Documents. | Workspace Admins, System Integrators, and department-authorized users. |
| **Chunk** | Hash-Based String | Chunk Sequence ID, Text Excerpt, Vector Embedding Address | Belongs to one Document. | Shared with Search and RAG API routes. |
| **Audit Log** | Chronological ID | Actor Email, Action Type, Targeted Doc, Timestamp | References User and Document. | Immutable log, Admin view only. |

---

## 3. Search Retrieval Flows

The platform resolves searches through a multi-tier information retrieval pattern:

1. **Query Input**: The user inputs a keyword, natural language query, or filter parameter inside the workspace search component.
2. **Entity Expansion**: The backend processes filters, narrowing results by document type, date bounds, or compliance classification.
3. **Primary Selection**: The Relational Database returns documents matching keyword indices and access bounds.
4. **Vector Retrieval**: If conversational features are engaged, the search service routes chunks to the vector database to locate contextual answers.
5. **Security Redaction**: The system cross-references user role tags, redacting sensitive metadata or content before serving the final payload to the UI workspace.
