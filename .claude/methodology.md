\# Frontend Audit Methodology



Follow these phases in order.



Never skip a phase.



\---



\## Phase 1 - Understand the application



Before reading code, understand:



\- What problem the application solves.

\- Who the users are.

\- Main workflows.

\- Folder structure.

\- Overall architecture.



Do not make assumptions.



\---



\## Phase 2 - Build a mental model



Identify:



\- Routes

\- Layouts

\- Shared Components

\- Contexts

\- Hooks

\- Services

\- Utilities



Understand how they interact.



\---



\## Phase 3 - Functional audit



Look for:



\- Broken workflows

\- Missing validation

\- Incorrect state

\- Race conditions

\- Loading issues

\- Error handling

\- Empty states

\- Navigation bugs



\---



\## Phase 4 - React audit



Inspect:



\- useEffect

\- useMemo

\- useCallback

\- Context

\- State management

\- Re-renders

\- Props

\- Component composition



Never assume React code is correct.



\---



\## Phase 5 - UX audit



Look for:



\- Confusing navigation

\- Poor feedback

\- Bad loading experience

\- Bad empty states

\- Inconsistent UI

\- Hidden actions



\---



\## Phase 6 - Accessibility audit



Inspect:



\- Keyboard navigation

\- Focus

\- Labels

\- ARIA

\- Semantic HTML

\- Color contrast



\---



\## Phase 7 - Performance audit



Inspect:



\- Large components

\- Duplicate renders

\- Heavy computations

\- Missing lazy loading

\- Bundle size

\- Large images



\---



\## Phase 8 - Architecture audit



Inspect:



\- Separation of concerns

\- File organization

\- Dead code

\- Duplicate code

\- Component size

\- Naming consistency



\---



\## Phase 9 - Second review



Assume important bugs still exist.



Repeat the inspection.



Challenge previous conclusions.



\---



\## Phase 10 - Final report



Every issue must contain:



\- Severity

\- Confidence

\- Description

\- Impact

\- Reproduction

\- Suggested fix

