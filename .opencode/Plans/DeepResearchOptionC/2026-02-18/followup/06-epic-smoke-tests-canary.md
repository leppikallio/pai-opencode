# Epic E6 — Executable M2/M3 canaries + runbooks

Status: IN_PROGRESS

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (Acceptance tests M2/M3; failures triage)
- Architect: `../architect-review-raw-2.md` (Readiness rubric + operator canary steps)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e6`
- Epic branch: `ws/epic-e6-canaries`

## Target files
- Smoke tests:
  - `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
  - `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`
- Fixture smoke (reference):
  - `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`
- CLI (runbooks reference):
  - `.opencode/pai-tools/deep-research-option-c.ts`

## Outcomes (what “done” means)
1) M2 and M3 canaries are **runnable by a new engineer** with one command each.
2) CI remains deterministic: anything requiring network or real agent spawning is skipped by default.
3) Runbooks exist and match actual CLI behavior.

## Bite-sized tasks

### E6-T0 — Define canary execution modes
Goal: clearly distinguish deterministic CI vs manual operator canary.

Add doc: `.opencode/Plans/.../followup/E6-canary-modes.md`:
- default: fixture/deterministic only
- gated: live agent driver (requires explicit env flag)
- gated: online citations ladder (requires endpoints)

### E6-T1 — Make M2 smoke test self-seeding
Goal: it should not require a pre-existing run root.

Steps:
- Update `deep_research_live_wave1_smoke.test.ts` to:
  1) create a scratch run root (unique run-id)
  2) run `init` (no_web or normal depending on mode)
  3) run ticks until stage reaches pivot OR halt with a typed blocker
- Default behavior should use deterministic driver (stub driver) unless an env flag enables Task-backed driver.

Acceptance:
- Test runs deterministically and can be skipped when dependencies absent.

### E6-T2 — Make M3 smoke test self-seeding
Goal: reach finalize and verify required artifacts.

Steps:
- Update `deep_research_live_finalize_smoke.test.ts` similarly.
- By default, use fixture/generate-mode paths.
- If online citations are enabled, require that:
  - `citations/online-fixtures.latest.json` exists
  - blocked urls artifact handled.

Acceptance:
- Manual canary produces full artifact checklist.

### E6-T3 — Add runbooks for operators
Create docs under followup folder:
- `E6-runbook-m2-live-wave1-to-pivot.md`
- `E6-runbook-m3-live-finalize.md`

Each runbook must include:
- exact commands (copy/paste)
- expected artifacts
- triage steps using `inspect` and `triage`

### E6-T4 — Add fixture capture step to M3 runbook
If E5 adds `capture-fixtures`, M3 runbook must include it.

### E6-T5 — QA + Architect gates
- QA: tests + precommit
- Architect: runbooks match actual stage machine and CLI.

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E6-T0 Canary modes doc | DONE |  |  | `followup/E6-canary-modes.md` |
| E6-T1 M2 smoke self-seeding | DONE |  |  | `deep_research_live_wave1_smoke.test.ts` self-seeds + ticks to pivot |
| E6-T2 M3 smoke self-seeding | DONE |  |  | `deep_research_live_finalize_smoke.test.ts` self-seeds + ticks to finalize |
| E6-T3 Runbooks | DONE |  |  | `E6-runbook-m2-live-wave1-to-pivot.md`, `E6-runbook-m3-live-finalize.md` |
| E6-T4 Fixture capture step | DONE |  |  | Included in M3 runbook with fallback |
| Architect PASS | TODO |  |  |  |
| QA PASS | TODO |  |  |  |

## Validator gates

### Architect gate
- confirms canary definitions align with readiness rubric
- confirms runbooks are accurate

### QA gate
Run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e6"
bun test ./.opencode/tests
bun Tools/Precommit.ts
```
