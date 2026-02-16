# Phase 07 Checkpoint — Gate F Signoff

Date: 2026-02-16

## Scope
Phase 07 — **Rollout Hardening, Canary, and Fallback** for Deep Research Option C.

Goal: Gate F (“Rollout safety”) is reviewable offline-first, with explicit evidence mapped to authoritative specs.

Primary plan sources:
- `deep-research-option-c-phase-07-rollout-hardening.md`
- `deep-research-option-c-phase-07-executable-backlog.md`
- `deep-research-option-c-phase-07-orchestration-runbook.md`
- `deep-research-option-c-phases-04-07-testing-plan.md`

Signoff record:
- `PHASE-07-CHECKPOINT-GATE-F-SIGNOFF.md`

## Gate F authoritative mapping

Gate F definition source:
- `spec-gate-thresholds-v1.md` → **Gate F — Rollout safety (HARD)**

Gate F reviewer source:
- `spec-reviewer-rubrics-v1.md` → **Gate F Rubric — Rollout safety**

| Gate F requirement | Threshold spec mapping | Rubric mapping | Evidence artifact(s) |
|---|---|---|---|
| Feature flags exist for enable/disable and caps | `spec-gate-thresholds-v1.md` Gate F pass criteria | `spec-reviewer-rubrics-v1.md` Gate F PASS checklist item 1 | `spec-feature-flags-v1.md`, `.opencode/tests/entities/deep_research_feature_flags.contract.test.ts` |
| Canary plan exists with rollback triggers and Wave 0 operational docs | `spec-gate-thresholds-v1.md` Gate F pass criteria | `spec-reviewer-rubrics-v1.md` Gate F PASS checklist item 2 | `.opencode/Plans/DeepResearchOptionC/rollout-playbook-v1.md`, `.opencode/Plans/DeepResearchOptionC/incident-response-matrix-v1.md`, `.opencode/Plans/DeepResearchOptionC/operator-runbooks-v1.md`, `.opencode/Plans/DeepResearchOptionC/operator-drills-log-v1.md`, `deep-research-option-c-phase-07-rollout-hardening.md`, `deep-research-option-c-phase-07-orchestration-runbook.md` |
| Fallback to standard workflow is documented and tested, preserving artifacts | `spec-gate-thresholds-v1.md` Gate F pass criteria + fallback language | `spec-reviewer-rubrics-v1.md` Gate F PASS checklist item 3 + required evidence | `.opencode/tools/deep_research/fallback_offer.ts`, `.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts`, `.opencode/tests/entities/deep_research_fallback_path.test.ts`, `deep-research-option-c-phase-07-orchestration-runbook.md`, `spec-rollback-fallback-v1.md` |

## QA checklist (offline-first default)

- [x] Use offline-first env defaults: `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1`
- [x] Run Gate F feature-flag contract test and confirm pass
- [x] Run Gate F fallback-path test and confirm pass
- [x] Run Gate F fallback-offer hard-gate test and confirm pass
- [x] Run Phase 07 watchdog timeout test and confirm pass
- [x] Confirm rollout + backlog docs reference this checkpoint and orchestration runbook
- [x] Confirm verification commands are present inline in both Phase 07 plan docs

## Evidence

All commands are copy/paste-ready from repo root.

### 1) Feature flags contract test (Gate F)
```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```
Expected outcome:
- Exit code `0`
- Test output shows PASS/ok for feature flag enable/disable + cap behavior

### 2) Fallback path test (Gate F)
```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
```
Expected outcome:
- Exit code `0`
- Output confirms deterministic fallback to standard workflow and artifact retention behavior

### 3) Fallback offer hard-gate test (P07-05)
```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```
Expected outcome:
- Exit code `0`
- Output confirms hard-gate failure triggers deterministic fallback offer behavior

### 4) Watchdog timeout test (Phase 07 operational readiness)
```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```
Expected outcome:
- Exit code `0`
- Output confirms watchdog breach is detected deterministically

### 5) Check governance references in rollout hardening doc
```bash
rg -n "PHASE-07-CHECKPOINT-GATE-F|phase-07-orchestration-runbook|phases-04-07-testing-plan" .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md
```
Expected outcome:
- One or more matches proving references to checkpoint, runbook, and testing plan exist

### 6) Check governance references in executable backlog doc
```bash
rg -n "PHASE-07-CHECKPOINT-GATE-F|phase-07-orchestration-runbook|phases-04-07-testing-plan" .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-executable-backlog.md
```
Expected outcome:
- One or more matches proving references to checkpoint, runbook, and testing plan exist

### 7) Confirm inline verification commands exist in both Phase 07 plan docs
```bash
rg -n "bun test \\./\\.opencode/" \
  .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md \
  .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md
```
Expected outcome:
- One or more matches in each file

## Evidence transcript
- Full command transcript with captured outputs:
  [`PHASE-07-GATE-F-EVIDENCE-TRANSCRIPT-2026-02-16.md`](./PHASE-07-GATE-F-EVIDENCE-TRANSCRIPT-2026-02-16.md)

## Signoff criteria
Gate F signoff is complete when all checklist items above are checked and the command outcomes match expected results.
