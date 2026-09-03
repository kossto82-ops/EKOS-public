# AI Operating System - Engineering & Coding Standards

**Purpose:** This document defines the engineering standards, naming conventions, folder structures, component responsibilities, and compilation metrics for the project codebase. It maintains code quality and system performance.
**Owner:** Principal Frontend Engineer / Tech Lead
**Status:** Approved Configuration
**Review Frequency:** Quarterly

---

## 1. Core Engineering Standards

Our development guidelines prioritize type safety, modular structure, readability, and performance.

1. **Strict TypeScript Compliance**: Every component, function, hook, and service must have explicit type declarations. The use of `any` is strictly prohibited unless wrapped in validated utility boundaries.
2. **Component Single Responsibility**: React components must remain small, focused, and presentation-only. Do not mix network calls or business rules directly into JSX templates.
3. **Structured Folder Conventions**: Source directories must respect the established hierarchy (e.g., components reside in `src/components/`, data operations in `src/repositories/`, backend handlers in `server/`).
4. **No Duplicated Code**: Standardize reusable components. If multiple views need similar list rows, table grids, or dropdown inputs, refactor them into shared components under `src/components/shared/`.
5. **No Dead Code**: Unused imports, variables, legacy helper methods, and outdated mock files must be pruned during every commit cycle.
6. **No Mock Data Leakage**: While developing prototypes, all mock data must be kept in dedicated mock constants under `src/constants/`. Hardcoding mock data directly inside active component layouts is forbidden.

---

## 2. Directory & Naming Conventions

- **React Components**: Use PascalCase (e.g., `KnowledgeBaseTab.tsx`, `DocList.tsx`).
- **React Hooks**: Prefix with `use`, camelCase (e.g., `useBrand.ts`, `useLocalStorage.ts`).
- **Repository / Service Files**: camelCase naming, ending in descriptive suffixes (e.g., `documentRepository.ts`, `syncService.ts`).
- **TypeScript Types**: All type, interface, and enum definitions must reside in `/src/types/` (e.g., `index.ts`, `knowledge.ts`).

---

## 3. Engineering Compliance Examples

### Case A: Creating a new dropdown component for tenant selection
- *Incorrect Code*: "Write raw inline options arrays inside the JSX, hardcoding visual properties, and setting up nested inline tailwind structures in place."
- *Correct Code*: "Define a standard, typed interface for the dropdown options in `src/types/index.ts`. Use standard elements or shared components styled with consistent properties, retrieving options from a dedicated tenant configuration service."

### Case B: Declaring types for an incoming API payload
- *Incorrect Code*: "Declare the response variable with the type `any` to quickly bind objects to the layout."
- *Correct Code*: "Create an explicit interface (e.g., `export interface IngestionPayload`) in `/src/types/apiContracts.ts` defining all required fields, sub-objects, and nullabilities, and apply it to the API response handler."

---

## 4. Future Evolution

When compiling for production release, our automated testing suites will enforce strict compilation rules, blocking pull requests that contain linter violations, circular dependencies, or type mismatches.

---

## 5. Cross References

- Refer to `/docs/API_SPECIFICATION.md` for standard network structures and payload schemas.
- Refer to `.ai/ARCHITECTURE_PRINCIPLES.md` for our three-tier system architecture boundaries.
