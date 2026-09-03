# AI Operating System - Architectural Principles

**Purpose:** This document establishes the permanent architectural boundaries, design patterns, microservice layers, and system constraints for the Enterprise Knowledge Platform. It directs developer planning and technical reviews.
**Owner:** Staff Software Architect
**Status:** Approved Configuration
**Review Frequency:** Bi-Annually

---

## 1. Core Architectural Principles

The platform is designed to scale securely from an interactive single-user prototype to a federated, multi-tenant, high-availability microservices architecture.

1. **Layer Separation**: The codebase is partitioned into three distinct, non-overlapping conceptual layers:
   - *Presentation (UI/Views)*: Built in React, strictly presentation-only, stateless concerning long-term persistence.
   - *Service Layer (Business Logic)*: Orchestrates domain rules, formats data queries, and coordinates internal tasks.
   - *Data / Persistence (Repository Layer)*: Interfaces directly with databases, caches, and external APIs.
2. **Repository Pattern**: All database, cache, or external API transactions must execute via dedicated repository files. Component views are strictly forbidden from writing direct database operations.
3. **Backend Ownership**: The backend server is the absolute owner of database mutations, authentication checks, vector indexing, and RAG pipelines.
4. **Stateless UI**: Front-end state should remain transient, lightweight, and focused on layout navigation and focus. Long-term state changes must sync securely with database stores.
5. **Robust RAG & Context Management**: Document segmentations, vector searches, and system prompt formatting must run behind secure server endpoints.
6. **Multi-Tenant Isolation & MCP Compatibility**: Ingestion connectors and model integrations must run in isolated processes to prevent cross-tenant exposure and maintain compatibility with standard Model Context Protocol structures.

---

## 2. Platform Architecture Rules

- **Strict API Contracts**: All data transfer between the front-end and backend must comply with defined API models. No random, loosely typed payloads are permitted.
- **Dependency Flow Direction**: Dependency vectors must strictly flow inward:
  `UI Component -> Context/State Hook -> Service Layer -> Repository/API`.
- **No Direct Database Access**: React components cannot reference database clients or execute raw SQL. All data queries must route through API handlers.

---

## 3. Architecture Decision Examples

### Case A: Implementing a document archival feature
- *Incorrect Implementation*: "In React, import a DB connection module and call a delete/update query directly on the click handler of a trash button."
- *Correct Implementation*: "The trash button click fires a callback to a React hook. The hook issues a standard `PATCH` command to `/api/v1/documents/:id` with an archival payload. The Express controller verifies the user's role, calls the document service, which executes a parameterized query via the database repository, cascading updates and logging the audit event."

### Case B: Reading a corporate file list via MCP
- *Incorrect Implementation*: "Directly spawn node file-system processes in the client-side component code to read directories."
- *Correct Implementation*: "Interface with an abstract, secure MCP endpoint hosted on the platform backend, which maps physical file attributes to the standard JSON-RPC schema before returning standard objects to the client."

---

## 4. Future Evolution

As we introduce relational PostgreSQL schemas, the repository layer will integrate with standard Object-Relational Mappers (ORMs), ensuring migrations are versioned, transactional boundaries are checked, and connection pools are managed.

---

## 5. Cross References

- Refer to `/docs/ARCHITECTURE.md` for our deployment topology and logical system layouts.
- Refer to `.ai/ENGINEERING_STANDARDS.md` for specific directory layout and component coding guidelines.
