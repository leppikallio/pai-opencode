# Deep Research Option C — Phase 07 Orchestration Runbook

## Purpose
Provide a fresh-session execution order, dependency waves, and a minimal Gate F test gate that is **offline-first by default**.

## Read order (fresh session)
1. `deep-research-option-c-phase-07-rollout-hardening.md`
2. `deep-research-option-c-phase-07-executable-backlog.md`
3. `spec-gate-thresholds-v1.md` (Gate F)
4. `spec-reviewer-rubrics-v1.md` (Gate F rubric)
5. `deep-research-option-c-phases-04-07-testing-plan.md`
6. `PHASE-07-CHECKPOINT-GATE-F.md`

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
```

## Wave execution guidance
- **Wave 0:** lock rollout narrative and operator readiness docs before implementation drift.
- **Wave 1:** wire flags and rollback/fallback behavior first; then run drills.
- **Wave 2:** enforce redaction and artifact-safety validation.
- **Wave 3:** assemble Gate F evidence pack and complete signoff.

## Minimal test gate sequence (offline-first)

Default env for all commands:
```bash
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
```

Run in this order:

1) Feature flags contract:
```bash
bun test .opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```

2) Fallback path contract:
```bash
bun test .opencode/tests/entities/deep_research_fallback_path.test.ts
```

3) Watchdog timeout coverage:
```bash
bun test .opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```

4) Optional focused Gate F grouping:
```bash
bun test .opencode/tests/entities/deep_research_feature_flags.contract.test.ts .opencode/tests/entities/deep_research_fallback_path.test.ts
```

Expected result for steps 1–4:
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
