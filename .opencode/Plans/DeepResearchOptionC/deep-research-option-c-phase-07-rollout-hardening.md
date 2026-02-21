# Phase 07 — Rollout Hardening, Canary, and Fallback (Weeks 12–16)

## Objective
Deliver production-safe rollout with feature flags, canary controls, and fallback paths.

## Dependencies
- Phase 06 quality automation complete.
- Gate F authority docs:
  - `spec-gate-thresholds-v1.md`
  - `spec-reviewer-rubrics-v1.md`
- Cross-phase testing plan:
  - `deep-research-option-c-phases-04-07-testing-plan.md`

## Phase 07 governance docs
- Checkpoint/signoff record: `PHASE-07-CHECKPOINT-GATE-F.md`
- Execution orchestration: `deep-research-option-c-phase-07-orchestration-runbook.md`

## Workstreams (parallel)
### WS-07A: Feature flag orchestration
- Enable staged rollout by mode/team.
- Add emergency disable and rollback switches.

### WS-07B: Canary execution
- Start with constrained query classes and low fan-out caps.
- Expand coverage gradually based on gate pass rates.

### WS-07C: Fallback pathways
- Define deterministic downgrade to existing standard research workflow.
- Preserve run artifacts for postmortem.

### WS-07D: Operational readiness
- Playbooks for failures, blocked sources, and model/provider outages.
- Pause/resume drills with live runs.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: Architect

## Acceptance Criteria
- Canary runs meet quality and reliability thresholds.
- Rollback works without data loss.
- Pause/resume proven on interrupted long-running execution.

## Deliverables
- `.opencode/Plans/DeepResearchOptionC/rollout-playbook-v1.md`
- `.opencode/Plans/DeepResearchOptionC/incident-response-matrix-v1.md`
- `.opencode/Plans/DeepResearchOptionC/operator-runbooks-v1.md`
- `.opencode/Plans/DeepResearchOptionC/operator-drills-log-v1.md`
- `.opencode/tools/deep_research_cli/fallback_offer.ts`
- `.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts`

## Gate
- **Gate F:** production readiness and rollback confidence.

## Verification commands (inline)

Run from repo root:

```bash
bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```

Expected:
- Exit code `0` for each command
- Failures block Gate F signoff until corrected and re-run

## Program Exit
- Option C enabled for general use behind guardrails.
