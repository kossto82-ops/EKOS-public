# AI Operating System - Core Readme

**Purpose:** This document defines the purpose, structure, relationships, reading order, and update policy for the AI Operating System (AI OS) governing the Enterprise Knowledge Platform repository.
**Owner:** Principal Enterprise Product Architect
**Status:** Approved Configuration
**Review Frequency:** Bi-Annually

---

## 1. Purpose of the AI Operating System

The AI Operating System (AI OS) is a meta-governance layer designed to configure the operational thinking, architectural standards, product decisions, and visual methodologies of any AI agent operating on this repository. It acts as a permanent, binding constitution to prevent "prototype drift," code duplication, visual clutter, and structural decay over a multi-year project lifecycle.

---

## 2. Core File Relationships

The `.ai/` directory forms a highly integrated mesh of constraints:

```
                  +--------------------------------+
                  |         .ai/SYSTEM.md          |
                  |     (Multidisciplinary AI)     |
                  +--------------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
+------------------+                                +------------------+
|PRODUCT_PRINCIPLES|                                |   UX_PRINCIPLES  |
| (Product Bounds) |                                | (Visual Density) |
+------------------+                                +------------------+
         |                                                   |
         +-------------------------+-------------------------+
                                   |
                                   v
                  +--------------------------------+
                  |     PROJECT_RULES.md           |
                  |  (Operational Boundaries)      |
                  +--------------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
+------------------+                                +------------------+
| ARCH_PRINCIPLES  |                                |   ENG_STANDARDS  |
|  (Architecture)  |                                | (Code Standards) |
+------------------+                                +------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
+------------------+       +------------------+     +------------------+
|  REVIEW_PROCESS  | =====>|DECISION_FRAMEWORK|====>|   QUALITY_GATE   |
|   (Eval Logic)   |       |  (Trade-offs)    |     | (Blocking Check) |
+------------------+       +------------------+     +------------------+
                                                              |
                                                              v
                                                    +------------------+
                                                    |DOCUMENTATION_RULES|
                                                    | (Sync Standards) |
                                                    +------------------+
```

---

## 3. Mandatory AI Reading Order

Before attempting any modification, evaluation, or planning task in this repository, the AI **MUST** load and comprehend these files in the following sequential order:

1. **`.ai/SYSTEM.md`**: Align identity, analytical modes, and multi-disciplinary perspective bounds.
2. **`.ai/PROJECT_RULES.md`**: Comprehend strict negative boundaries and operational guardrails.
3. **`.ai/PRODUCT_PRINCIPLES.md`** & **`.ai/UX_PRINCIPLES.md`**: Realign on product values, typography, and density metrics.
4. **`.ai/ARCHITECTURE_PRINCIPLES.md`** & **`.ai/ENGINEERING_STANDARDS.md`**: Adopt standard layering patterns, repository isolation, and API contract rules.
5. **`.ai/REVIEW_PROCESS.md`** & **`.ai/DECISION_FRAMEWORK.md`**: Establish evaluation methodologies and architectural tradeoff metrics.
6. **`.ai/QUALITY_GATE.md`** & **`.ai/DOCUMENTATION_RULES.md`**: Enforce release gate protocols and synchronize structural docs.

---

## 4. Update Policy & Governance

- **Immutable Rules**: Core negative rules (e.g., "no prototype drift," "no CRM transformation") are immutable and cannot be amended by automated processes.
- **Controlled Amendments**: Changes to the AI OS configuration can only occur when explicitly instructed by human Enterprise Leads, requiring a major version upgrade of the platform.
- **No Self-Modification**: The AI is strictly forbidden from editing or diluting the rules in `.ai/` during standard engineering or documentation sprints.

---

## 5. Cross References

- Refer to the main product index in `/docs/README.md` for functional architecture specifications.
- Refer to `.ai/SYSTEM.md` for the core identity framework.
- Refer to `.ai/QUALITY_GATE.md` for checklist metrics.
