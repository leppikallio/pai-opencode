# Epic E8 — Charter pack refresh (docs-only)

Status: TODO

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (roadmap + operator UX expectations)
- Architect: `../architect-review-raw-2.md` (explicit drift callouts + recommended fixes)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e8`
- Epic branch: `ws/epic-e8-charter-refresh`

## Scope
Docs only. No code changes.

## Target docs
- Charter pack:
  - `.opencode/Plans/DeepResearchOptionC/2026-02-18/charter-pack/**`

## Outcome (what “done” means)
Charter pack reflects implementation reality so it stops generating “false gaps.”

## Bite-sized tasks

### E8-T0 — Inventory drift items
From architect raw-2, capture drift items in a short list:
- CLI location: `pai-tools/deep-research-option-c.ts` vs `Tools/...`
- workstream statuses (DONE vs PARTIAL vs MISSING)
- readiness gate text that refers to already-fixed gaps

Create: `.opencode/Plans/DeepResearchOptionC/2026-02-18/followup/E8-drift-inventory.md`

### E8-T1 — Update WS1 doc references
Update:
- `charter-pack/workstreams/WS1-operator-cli-and-unified-runloop.md`
So it points to the canonical runtime invocation:
- `bun "pai-tools/deep-research-option-c.ts" ...`

### E8-T2 — Update readiness gates wording
Update:
- `charter-pack/01-readiness-gates.md`
to remove stale statements (e.g., “only entries[0]”) now that wave1 fan-out exists.

### E8-T3 — Mark completed workstreams
Update the charter pack to reflect which WS/T tracks are DONE/PARTIAL with evidence pointers (brief).

### E8-T4 — Validation
Run doc validation:
- `bun Tools/Install.ts --target "/Users/zuul/.config/opencode" --non-interactive --dry-run`
(we want ScanBrokenRefs and ValidateSkillSystemDocs to remain OK).

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E8-T0 Drift inventory | DONE | Marvin | pending | `followup/E8-drift-inventory.md` |
| E8-T1 WS1 updates | DONE | Marvin | pending | `charter-pack/workstreams/WS1-operator-cli-and-unified-runloop.md` |
| E8-T2 Readiness gates updates | DONE | Marvin | pending | `charter-pack/01-readiness-gates.md` |
| E8-T3 Workstream statuses | DONE | Marvin | pending | `charter-pack/README.md` |
| E8-T4 Validation | DONE | Marvin | pending | Dry-run completed; installer ended with `Done.` and verification steps remained configured (`ScanBrokenRefs`, `ValidateSkillSystemDocs`) |
| Architect PASS | TODO |  |  |  |
| QA PASS | TODO |  |  |  |

## Validator gates

### Architect gate
- Accuracy and clarity (no new drift introduced)

### QA gate
Doc checks must remain green:
```bash
cd "/private/tmp/pai-dr-epic-e8"
bun Tools/Install.ts --target "/Users/zuul/.config/opencode" --non-interactive --dry-run
```
