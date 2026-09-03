# EKOS self-improving review harness

A semi-autonomous, multi-agent development loop (roadmap "Option A"). It mirrors
an org chart of roles and a self-improving loop:

```
Master prompt  →  Implementers (PM/UX/React/Backend/Knowledge Architect)
                     →  Result
                        →  Reviewer panel (QA / Security / Performance / Frontend /
                           Backend / Knowledge Architect / Docs / Architecture Board)
                           →  "What failed?" (structured findings)
                              →  Update master prompt  +  Save learning (to memory)
                                 →  Next iteration
```

## Files
- `master-prompt.md` — the standing guidance for the harness. Versioned; each
  iteration may append/refine it. Generated/updated by the loop.
- `learnings.md` — human-readable log of what each iteration learned (the
  durable "save learning" store also lives in Claude's memory).
- The reusable workflow script is persisted per-run under the session dir; the
  canonical copy is kept here as `audit-workflow.js` once stabilized.

## Guardrails
- Runs are **checkpointed**: the loop audits/implements a bounded scope, the
  panel critiques it, results + learnings are surfaced for approval before the
  next large change. No unattended code rewrites.
- Each run fans out several agents → high token cost; run deliberately.

## How to run an iteration
Ask Claude Code to "run a self-improve iteration" (audit-only, or implement+review
a bounded target). It orchestrates the panel via the Workflow engine, then
persists the master prompt + learnings.
