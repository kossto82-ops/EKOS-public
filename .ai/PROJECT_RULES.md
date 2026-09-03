# AI Operating System - Permanent Project Rules

**Purpose:** This document establishes the absolute, non-negotiable boundaries, functional constraints, and operational directives for the Enterprise Knowledge Platform. It prevents architectural decay, scope creep, and prototype drift.
**Owner:** Principal Enterprise Product Architect
**Status:** Approved Configuration
**Review Frequency:** Quarterly

---

## 1. Core Principles of Project Integrity

- **Strict Identity Preservation**: The platform must remain a focused, mission-critical workspace for enterprise knowledge discovery, verification, and ingestion. It must never drift toward consumer-style interfaces, conversational toys, or unrelated application models.
- **Structural Division of Concerns**: Keep layers strictly isolated. The front-end is for presentation and high-density user experience; the back-end manages routing, caching, and database interaction. Business rules must reside in dedicated service files, not within React views.
- **Zero Mock Contamination**: All data interfaces must be fully typed and designed to support eventual production integration. Do not use random, non-standard helper methods or simulated database objects.

---

## 2. Permanent Project Rules

1. **Anti-Drift Mandate**: Never introduce features, options, or views that expand the platform's borders into CRM (Customer Relationship Management), ticketing, admin dashboard collections, or generic chat models (like ChatGPT/Gemini UI).
2. **One Source of Truth**: Data must stream from a single database structure governed by dedicated repository files. Front-end components must not instantiate independent storage schemas or persist local changes except via standardized API proxies.
3. **Operational Clarity**: Every screen, button, and data point must have a direct corporate purpose. Do not add decorative status widgets, mock logs (e.g., "CORE_NODE_ONLINE"), or tech-larping indicators in margins.
4. **No Code Duplication**: Extract common layout components (badges, buttons, dropdowns) into reusable UI modules. Do not write duplicate CSS or local component overrides inside individual tab files.

---

## 3. Compliance and Violation Examples

### Case A: Implementing a request to "add a user feedback/rating system for documents"
- *Violation (Drifting to ticketing/CRM)*: "Adding a complex feedback drawer with statuses like 'Pending,' 'In Review,' 'Assigned Tech,' and progress charts."
- *Compliance*: "Implement a clean, high-contrast, single-action rating dropdown (e.g., Upvote/Downvote with a standard feedback text area) that dispatches an event to the document repository, keeping data structures strictly aligned with standard catalog schemas."

### Case B: Implementing a request to "display database status on the home page"
- *Violation (Tech-larping / AI Slop)*: "Adding a flashing green light with 'PORT 3000: ONLINE', 'PING: 14ms', and mock terminal logs rolling in the margin."
- *Compliance*: "Integrate a subtle, standard, accessible banner or a static status tag (e.g., 'Synchronized' or 'Updating...') within the administrative sync tab, strictly adhering to operational enterprise standards."

---

## 4. Future Evolution

As the application evolves to support multi-tenant isolation, these rules will expand to enforce strict boundary-check checks at the repository layer, preventing cross-tenant data leaks and verifying query access scopes before compiling database executions.

---

## 5. Cross References

- Refer to `.ai/PRODUCT_PRINCIPLES.md` for our core design philosophy.
- Refer to `.ai/ENGINEERING_STANDARDS.md` for specific folder and component development rules.
