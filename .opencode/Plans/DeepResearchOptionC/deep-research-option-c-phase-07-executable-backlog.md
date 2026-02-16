# Phase 07 Executable Backlog — Rollout Hardening, Canary, and Fallback

## Objective
Deliver a production-safe rollout of Deep Research Option C using **feature flags**, a staged **canary plan**, and a deterministic **fallback/rollback** path with operator-ready playbooks and drills.

## Dependencies
- Phase 06 quality automation complete (per Phase 07 outline).
- Gate F authoritative definitions:
  - `spec-gate-thresholds-v1.md` (Gate F — Rollout safety)
  - `spec-reviewer-rubrics-v1.md` (Gate F Rubric — Rollout safety)
- Phase 07 governance docs:
  - `PHASE-07-CHECKPOINT-GATE-F.md`
  - `deep-research-option-c-phase-07-orchestration-runbook.md`
- Cross-phase testing plan:
  - `deep-research-option-c-phases-04-07-testing-plan.md`
- Rollout control and safety specs:
  - `spec-feature-flags-v1.md` (flag names, defaults, rules)
  - `spec-watchdog-v1.md` (no silent hangs; timeouts + terminal artifacts)
  - `spec-rollback-fallback-v1.md` (rollback triggers + mechanism + artifact retention)

## Gate
- **Gate F — Rollout safety (HARD)**
  **Authoritative references (do not substitute):**
  - Gate definition + pass criteria: `spec-gate-thresholds-v1.md` (Gate F, “Rollout safety”)
  - Reviewer checklist + required evidence: `spec-reviewer-rubrics-v1.md` (Gate F Rubric — Rollout safety)

  **Required artifacts (per Gate F definition/rubric):**
  - Feature flags documentation: `spec-feature-flags-v1.md`
  - Phase 07 deliverables: rollout/canary playbook + rollback triggers + fallback procedure proof

  **Pass criteria (use these exact requirements; no invented thresholds):**
  - Feature flags exist for **enable/disable and caps**.
  - A **canary plan** exists with **rollback triggers**.
  - A **fallback to the standard research workflow** is documented and **tested**.
  - Fallback path **preserves artifacts** (required by Gate F rubric in `spec-reviewer-rubrics-v1.md`; aligns with `spec-rollback-fallback-v1.md`).

## Backlog (Owner/Reviewer mapped)
| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P07-01 | Draft **Rollout + Canary Playbook**: staged enablement steps, initial constrained query classes, expansion rules, and operator “stop the line” criteria. Playbook must state: canary defaults to `PAI_DR_NO_WEB=1` unless explicitly enabled in a sandboxed environment. | Architect | Engineer | Phase 07 outline + `spec-gate-thresholds-v1.md` + `spec-reviewer-rubrics-v1.md` | `rollout-playbook-v1.md` (includes canary steps + rollback triggers) | Doc explicitly references Gate F pass criteria + includes step-by-step canary ramp procedure + default-safe `PAI_DR_NO_WEB` guidance |
| P07-02 | Implement/verify **feature flag orchestration surface** in the integration layer (env vars first), including master enable and caps (no OpenCode core changes) | Engineer | Architect | `spec-feature-flags-v1.md` | Flag reader + config wiring + documentation snippet | Flag names match spec (`PAI_DR_*`), defaults defined, and behavior described (enable/disable + caps); `bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts` passes (OFFLINE; `PAI_DR_NO_WEB=1`) |
| P07-03 | Enforce **canary execution constraints** (low fan-out, scoped modes/teams) using the documented flags (e.g., wave caps, default mode) | Engineer | Architect | P07-02 + `spec-feature-flags-v1.md` | Canary enforcement implementation + `rollout-playbook-v1.md` updates | Canary mode demonstrably applies caps/constraints defined by flags; playbook points to exact knobs |
| P07-04 | Define and implement **emergency disable / rollback switch** that immediately routes back to the standard research workflow | Engineer | Architect | P07-02 + `spec-rollback-fallback-v1.md` | Rollback mechanism implementation + operator “disable Option C” procedure | Procedure references the master enable/disable flag and shows deterministic routing to standard workflow; `bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts` passes (OFFLINE; `PAI_DR_NO_WEB=1`) |
| P07-05 | Implement **fallback-on-hard-gate-fail** behavior: preserve artifacts, emit failure summary, and offer “run standard research workflow” | Engineer | Architect | `spec-rollback-fallback-v1.md` + Gate hard-fail semantics from `spec-gate-thresholds-v1.md` | `.opencode/tools/deep_research/fallback_offer.ts` + failure summary template + operator runbook section | Proof that artifacts are retained and fallback offer is deterministic and visible to operator/user; `bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts` and `bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts` pass (OFFLINE; `PAI_DR_NO_WEB=1`) |
| P07-06 | Integrate **watchdog/no-silent-hangs** policy for canary runs: stage timeouts, terminal state write, and checkpoint artifact creation | Engineer | Architect | `spec-watchdog-v1.md` | Watchdog wiring + `logs/timeout-checkpoint.md` artifact format adoption | Demonstration run (or fixture) produces timeout checkpoint + marks failure terminal state as specified |
| P07-07 | Produce **Incident Response Matrix** for Phase 07: blocked sources, provider outage, validator failures, citation integrity issues, and timeout events | Architect | Engineer | Phase 07 outline + `spec-watchdog-v1.md` + `spec-rollback-fallback-v1.md` | `incident-response-matrix-v1.md` | Matrix includes: symptom → diagnosis steps → rollback trigger → fallback action → artifact paths |
| P07-08 | Write **Operator Runbooks**: pause/resume drill steps, rollback drill steps, fallback drill steps, and postmortem checklist (artifact-first) | Architect | Engineer | P07-01 + P07-04 + P07-05 + `spec-rollback-fallback-v1.md` | `operator-runbooks-v1.md` | Runbooks explicitly state artifact retention (“never delete run artifacts”) + include drill checklists |
| P07-09 | Execute **operator drills** on canary scenarios: (1) pause/resume, (2) emergency disable/rollback, (3) fallback after hard gate fail, (4) forced timeout watchdog event | Engineer | Architect | P07-06 + P07-08 | `operator-drills-log-v1.md` (per drill: steps, expected/actual, artifacts captured) | Drill log contains timestamps, commands/steps, and links/paths to captured artifacts per drill |
| P07-SEC1 | Define and enforce **redaction policy** for rollback/fallback summaries + operator runbooks (never print raw URLs with tokens/userinfo; prefer `cid` or redacted URL) | Architect | Engineer | P07-05 + `spec-rollback-fallback-v1.md` | Redaction section in `operator-runbooks-v1.md` + failure summary template update | manual-check: examples show redacted output; no token/userinfo present |
| P07-SEC2 | Add “artifact safety check” drill step: confirm preserved artifacts do not contain credential-bearing URLs (scan `citations.jsonl`, summaries, logs) | Engineer | Architect | P07-09 | Add section to `operator-drills-log-v1.md` + checklist | manual-check: drill log includes scan results and any remediation steps |
| P07-10 | Gate F evidence pack assembly: ensure all Gate F required evidence artifacts exist and are easy to review (single checklist) | Architect | QATester | P07-01..P07-09 + `spec-reviewer-rubrics-v1.md` | `PHASE-07-CHECKPOINT-GATE-F.md` | Checklist maps each Gate F PASS item to the specific doc/artifact proving it |
| P07-X1 | Phase 07 checkpoint + **Gate F signoff** | Architect | QATester | all P07-* | Gate F signoff record | Reviewer PASS per Gate F rubric + explicit links to feature flags doc + playbook + rollback/fallback proof |
| P07-11 | Post-Phase 07 cleanup: eliminate remaining explicit TypeScript `any` **outside** `.opencode/tests/**` (baseline: **55 tokens across 43 files**). Must land **after** Phase 07 feature work is merged; do all removals in **one single cleanup commit** with QA review. | Engineer | QATester | P07-X1 + `biome.json` (`noExplicitAny=error` outside tests) | Single commit removing `any` usage outside tests + (if needed) small type aliases/helpers | (1) Parallel execution: split file list across 3–5 engineers (prefer git worktrees) and then consolidate into one commit. (2) QA review before commit: reviewer runs `bun test ./.opencode/tests` and `bun Tools/Precommit.ts` and spot-checks highest-risk files. (3) Audit proof: `rg -o "\\bany\\b" --hidden --glob "**/*.ts" --glob "**/*.tsx" --glob "!**/node_modules/**" --glob "!**/.git/**" --glob "!.opencode/tests/**" . | wc -l` returns `0`. |

## Notes
- Feature flags are the primary safety mechanism; prefer env vars for canary and emergency disable.
- Canary/online work must be explicitly opt-in and sandboxed; OFFLINE defaults should use `PAI_DR_NO_WEB=1`.

## Verification commands (inline)

Run from repo root (offline-first default):

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```

Expected:
- Exit code `0` for each command
- Failures block `P07-10` and `P07-X1` completion

Post-Phase 07 cleanup verification (for P07-11):

```bash
rg -o "\bany\b" --hidden --glob "**/*.ts" --glob "**/*.tsx" --glob "!**/node_modules/**" --glob "!**/.git/**" --glob "!.opencode/tests/**" . | wc -l
```

Expected:
- Returns `0`
