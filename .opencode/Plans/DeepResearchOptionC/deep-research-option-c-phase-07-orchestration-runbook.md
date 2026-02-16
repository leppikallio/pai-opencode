# Deep Research Option C — Phase 07 Orchestration Runbook

## Purpose
Provide a fresh-session execution order, dependency waves, and a minimal Gate F test gate that is **offline-first by default**.

## Read order (fresh session)
1. `deep-research-option-c-phase-07-rollout-hardening.md`
2. `deep-research-option-c-phase-07-executable-backlog.md`
3. `.opencode/Plans/DeepResearchOptionC/rollout-playbook-v1.md`
4. `.opencode/Plans/DeepResearchOptionC/incident-response-matrix-v1.md`
5. `.opencode/Plans/DeepResearchOptionC/operator-runbooks-v1.md`
6. `.opencode/Plans/DeepResearchOptionC/operator-drills-log-v1.md`
7. `spec-gate-thresholds-v1.md` (Gate F)
8. `spec-reviewer-rubrics-v1.md` (Gate F rubric)
9. `deep-research-option-c-phases-04-07-testing-plan.md`
10. `PHASE-07-CHECKPOINT-GATE-F.md`

## Dependency graph (P07-* tasks)

```text
Wave 0 (governance)
  P07-01  ─┐
  P07-07  ─┼─> enables execution docs
  P07-08  ─┘

Wave 1 (control surface)
  P07-02  -> P07-03
  P07-02  -> P07-04
  P07-04  -> P07-05
  P07-03  -> P07-09
  P07-05  -> P07-09
  P07-06  -> P07-09

Wave 2 (security/governance hardening)
  P07-05  -> P07-SEC1
  P07-09  -> P07-SEC2

Wave 3 (gate assembly + signoff)
  P07-01..P07-09 + P07-SEC1 + P07-SEC2 -> P07-10 -> P07-X1

Wave 4 (post-phase cleanup)
  P07-X1 -> P07-11
```

## Wave execution guidance
- **Wave 0:** lock rollout narrative and operator readiness docs before implementation drift.
- **Wave 1:** wire flags and rollback/fallback behavior first; then run drills.
- **Wave 2:** enforce redaction and artifact-safety validation.
- **Wave 3:** assemble Gate F evidence pack and complete signoff.
- **Wave 4:** after Phase 07 feature work is merged, run the `any` cleanup as a dedicated commit with parallel engineering + QA gate.

## Minimal test gate sequence (offline-first)

Default env for all commands:
```bash
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
```

Run in this order:

1) Feature flags contract:
```bash
bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```

2) Fallback path contract:
```bash
bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
```

3) Fallback offer hard-gate contract (P07-05):
```bash
bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```

4) Watchdog timeout coverage:
```bash
bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```

5) Optional focused Gate F grouping:
```bash
bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts ./.opencode/tests/entities/deep_research_fallback_path.test.ts ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```

Expected result for steps 1–5:
- Exit code `0`
- No network required (`PAI_DR_NO_WEB=1`)
- Failures block Gate F signoff until corrected

## Gate F completion handoff
Before marking `P07-X1` complete:
- Update `PHASE-07-CHECKPOINT-GATE-F.md` evidence outcomes.
- Confirm Phase 07 plan docs contain inline verification commands.
- Re-check mapping to:
  - `spec-gate-thresholds-v1.md`
  - `spec-reviewer-rubrics-v1.md`

## Post-Phase 07 cleanup (P07-11): remove explicit `any` outside tests

Goal: bring the repo to **0 explicit `any` tokens outside `.opencode/tests/**`**, without breaking behavior.

Parallelization guidance (fast + low-conflict):
- Build the target file list with the audit command below.
- Split the list by directory (e.g. `Tools/`, `.opencode/tools/`, `.opencode/skills/`, `Packs/`) and assign each shard to a different engineer.
- Prefer **git worktrees** per shard to avoid edit collisions.
- Consolidate by cherry-picking (or merging) into a single cleanup branch, then create **one** commit.

QA gate (must be done before the cleanup commit is created):
```bash
rg -o "\bany\b" --hidden --glob "**/*.ts" --glob "**/*.tsx" --glob "!**/node_modules/**" --glob "!**/.git/**" --glob "!.opencode/tests/**" . | wc -l
bun test ./.opencode/tests
bun Tools/Precommit.ts
```

Expected:
- `rg` count returns `0`
- test suite passes
- precommit passes
