# Phase 07 Gate F Evidence Transcript — 2026-02-16

ISC Criterion: **Gate F evidence transcript exists with command outputs**

All commands were run from repo root: `/Users/zuul/Projects/pai-opencode-graphviz`.

## 1) Feature flags contract test (Gate F)

Command:

```bash
bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```

Output:

```text
bun test v1.3.2 (b131639c)

 4 pass
 0 fail
Ran 4 tests across 1 file. [88.00ms]
```

## 2) Fallback path test (Gate F)

Command:

```bash
bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
```

Output:

```text
bun test v1.3.2 (b131639c)

 3 pass
 0 fail
 17 expect() calls
Ran 3 tests across 1 file. [62.00ms]
```

## 3) Fallback offer hard-gate test (P07-05)

Command:

```bash
bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```

Output:

```text
bun test v1.3.2 (b131639c)

 1 pass
 0 fail
 10 expect() calls
Ran 1 test across 1 file. [65.00ms]
```

## 4) Watchdog timeout test (Phase 07)

Command:

```bash
bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```

Output:

```text
bun test v1.3.2 (b131639c)

 1 pass
 0 fail
 17 expect() calls
Ran 1 test across 1 file. [63.00ms]
```

## 5) Governance refs in rollout hardening doc

Command:

```bash
rg -n "PHASE-07-CHECKPOINT-GATE-F|phase-07-orchestration-runbook|phases-04-07-testing-plan" .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md
```

Output:

```text
12:  - `deep-research-option-c-phases-04-07-testing-plan.md`
15:- Checkpoint/signoff record: `PHASE-07-CHECKPOINT-GATE-F.md`
16:- Execution orchestration: `deep-research-option-c-phase-07-orchestration-runbook.md`
```

## 6) Governance refs in executable backlog doc

Command:

```bash
rg -n "PHASE-07-CHECKPOINT-GATE-F|phase-07-orchestration-runbook|phases-04-07-testing-plan" .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-executable-backlog.md
```

Output:

```text
12:  - `PHASE-07-CHECKPOINT-GATE-F.md`
13:  - `deep-research-option-c-phase-07-orchestration-runbook.md`
15:  - `deep-research-option-c-phases-04-07-testing-plan.md`
51:| P07-10 | Gate F evidence pack assembly: ensure all Gate F required evidence artifacts exist and are easy to review (single checklist) | Architect | QATester | P07-01..P07-09 + `spec-reviewer-rubrics-v1.md` | `PHASE-07-CHECKPOINT-GATE-F.md` | Checklist maps each Gate F PASS item to the specific doc/artifact proving it |
```

## 7) Inline verification commands present in Phase 07 plan docs

Command:

```bash
rg -n "bun test \./\.opencode/" \
  .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md \
  .opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md
```

Output:

```text
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md:64:bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md:69:bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md:74:bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md:79:bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md:84:bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts ./.opencode/tests/entities/deep_research_fallback_path.test.ts ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-orchestration-runbook.md:113:bun test ./.opencode/tests
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md:60:bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md:61:bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md:62:bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phase-07-rollout-hardening.md:63:bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```
