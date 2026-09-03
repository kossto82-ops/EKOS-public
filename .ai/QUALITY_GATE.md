# AI Operating System - Mandatory Quality Gate Checklist

**Purpose:** This document defines the mandatory, blocking quality gate checklist that must be completed before any code change is committed or deployed.
**Owner:** Director of Software Quality / Lead Release Engineer
**Status:** Approved Configuration
**Review Frequency:** Quarterly

---

## 1. Core Quality Gate Principles

The Quality Gate is a strict, non-negotiable blocking mechanism. If any checklist item fails, the AI **MUST STOP** immediately. It is forbidden from completing the task or proceeding with deployment. The AI must report the failure, explain the root cause, and apply targeted fixes until all gates are completely cleared.

---

## 2. The Blocking Checklist Matrix

All changes must pass these nine critical checkpoints:

| Checkpoint Name | Evaluation Target | Verification Criteria | Blocking Condition |
| :--- | :--- | :--- | :--- |
| **Product Alignment** | Scope & Requirements | Changes must align with specs in `/docs/PRODUCT.md`. | **FAIL** if it expands the app outside its boundaries. |
| **Architecture Alignment** | Separation of Layers | Components must not write direct database operations or bypass repository files. | **FAIL** if business logic is mixed with views. |
| **UX & Spatial Consistency** | Density & System Tokens | Layouts must respect the 35% whitespace density and use correct typography. | **FAIL** if rounding rules or colors are violated. |
| **No Duplication** | Component Reuse | Ensure new components do not replicate existing layouts. | **FAIL** if duplicates are introduced. |
| **No Dead Code** | Code Cleanliness | Remove unused imports, variables, and outdated mock files. | **FAIL** if dead code is committed. |
| **Accessibility Compliance**| Contrast & Tab Indexes | Contrast ratios must exceed WCAG 2.1 AA targets (4.5:1 for standard text). | **FAIL** if elements lack clear tab focus highlights. |
| **Performance Security** | Infinite Re-renders | React hooks and dependencies must be fully optimized. | **FAIL** if hooks cause redundant updates. |
| **Scalability Bounds** | High Volume Grid | Grids and tables must stay readable when displaying thousands of files. | **FAIL** if scaling layouts are broken. |
| **Documentation Sync** | Reference Alignment | Corresponding specs in `/docs/` must remain perfectly synchronized. | **FAIL** if documentation updates are omitted. |

---

## 3. Handling Quality Gate Failures

If any check fails, the AI must execute these recovery steps:
1. **Halt Progression**: Stop all write operations and development plans.
2. **Formulate Diagnosis**: Identify the root cause of the compilation, linting, or design mismatch.
3. **Draft Target Correction**: Propose a highly focused code fix.
4. **Re-Run Validation**: Apply the fix and run compile and lint checks to verify resolution.

---

## 4. Compliance and Violation Examples

### Case A: Evaluating a component that introduces unused imports and duplicate interfaces
- *Action*: **STOP**. Do not proceed with the commit.
- *Diagnosis*: "The component violates our 'No Dead Code' and 'No Duplication' standards."
- *Resolution*: "Prune the unused imports, extract common interfaces to `/src/types/index.ts`, and re-run quality gates."

---

## 5. Future Evolution

In later development stages, these checks will execute as automated git-hooks, blocking commits and pull requests that violate our typing, linting, or accessibility criteria.

---

## 6. Cross References

- Refer to `.ai/REVIEW_PROCESS.md` for our pre-implementation review stages.
- Refer to `.ai/DOCUMENTATION_RULES.md` for keeping documents aligned.
