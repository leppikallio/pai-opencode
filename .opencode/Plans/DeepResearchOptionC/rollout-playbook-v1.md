# rollout-playbook-v1 (P07-01)

## Overview

This playbook defines staged enablement for Deep Research Option C with an **offline-first canary baseline**.

Authoritative Gate F pass criteria sources:
- `spec-gate-thresholds-v1.md` → **Gate F — Rollout safety (HARD)**
- `spec-reviewer-rubrics-v1.md` → **Gate F Rubric — Rollout safety**
- `PHASE-07-CHECKPOINT-GATE-F.md` → evidence mapping and command outcomes

Default safety position:
- Canary defaults to `--sensitivity no_web` unless explicitly enabled.
- No network-required steps are part of the default rollout path.

Staged enablement model:
1. **Stage 0 (offline baseline):** flags on, no-web forced, constrained queries only.
2. **Stage 1 (expanded offline):** increase volume and fan-out caps after stable passes.
3. **Stage 2 (sandboxed web-enabled canary, optional):** only with explicit operator approval and rollback readiness.
4. **Stage 3 (broader rollout):** promote only after repeated pass cycles and zero hard-gate regressions.

Initial constrained query classes (Stage 0):
- Local markdown/spec analysis in `.opencode/Plans/**`
- Deterministic fixture/replay validations
- Non-network synthesis checks from local artifacts
- Gate evidence assembly and checklist reconciliation

Expansion rules:
- Promote one stage at a time only after:
  - Gate F-required tests pass (`feature_flags`, `fallback_path`, `watchdog_timeout`)
  - No hard-gate failure in current stage window
  - Rollback procedure verified and operator on-call confirmed
- If any stop-the-line criterion is hit, halt expansion immediately and execute rollback.

## Canary Steps

1. **Initialize offline-first environment**
   - Option C is enabled by default (settings flag `deepResearch.flags.PAI_DR_OPTION_C_ENABLED=true`; env unsupported)
   - Use `--sensitivity no_web` (mandatory default)
   - Keep canary scope to constrained query classes only

2. **Run Gate F safety contracts**
   - Execute feature-flag contract test
   - Execute fallback-path contract test
   - Execute watchdog-timeout test

3. **Validate references and governance links**
   - Ensure rollout docs still reference Gate F checkpoint/runbook/testing plan

4. **Evaluate promotion gate**
   - If all checks pass with expected outcomes, move to next stage window
   - If any check fails, invoke rollback triggers immediately

5. **Optional sandboxed web-enabled canary (explicit opt-in only)**
   - Allowed only in sandboxed environment with operator approval
   - Must be reversible in one command (switch back to `--sensitivity no_web`)

## Rollback Triggers

Stop-the-line criteria and operator actions:

| Trigger | Signal | Immediate operator action |
|---|---|---|
| Feature-flag contract failure | `bun test ...deep_research_feature_flags.contract.test.ts` exits non-zero | Set `deepResearch.flags.PAI_DR_OPTION_C_ENABLED=false` in `.opencode/settings.json`; revert canary traffic to standard workflow; open incident log |
| Fallback-path failure | `bun test ...deep_research_fallback_path.test.ts` exits non-zero | Disable Option C via settings (`deepResearch.flags.PAI_DR_OPTION_C_ENABLED=false`); force standard workflow path; preserve run artifacts for postmortem |
| Watchdog timeout regression | `bun test ...deep_research_watchdog_timeout.test.ts` exits non-zero or timeout alerts fire | Pause canary expansion; keep offline mode; execute rollback checklist and investigate timeout root cause |
| Hard-gate breach during canary | Any HARD gate marked failed in evidence review | Stop rollout progression; rollback to previous stable stage; require re-verification before retry |
| Unapproved web exposure | run launched without `--sensitivity no_web` and no sandbox approval | Immediately restore `--sensitivity no_web`; freeze stage promotion; file operator exception report |

Rollback baseline actions (always):
1. Freeze rollout changes.
2. Disable Option C in settings (`deepResearch.flags.PAI_DR_OPTION_C_ENABLED=false`).
3. Keep artifacts intact for diagnostics and Gate F evidence.
4. Route all affected runs to standard research workflow.

## Flags

Feature flags are defined in `spec-feature-flags-v1.md` (authoritative list):

| Flag | Default | Rollout role |
|---|---:|---|
| `PAI_DR_OPTION_C_ENABLED` | `true` | Master enable/disable switch |
| `PAI_DR_MODE_DEFAULT` | `standard` | Default run mode for Option C |
| `PAI_DR_MAX_WAVE1_AGENTS` | `6` | Wave 1 fan-out cap |
| `PAI_DR_MAX_WAVE2_AGENTS` | `6` | Wave 2 fan-out cap |
| `PAI_DR_MAX_SUMMARY_KB` | `5` | Per-summary size cap |
| `PAI_DR_MAX_TOTAL_SUMMARY_KB` | `60` | Summary-pack total cap |
| `PAI_DR_MAX_REVIEW_ITERATIONS` | `4` | Synthesis reviewer loop cap |
| `PAI_DR_CITATION_VALIDATION_TIER` | `standard` | Citation validation depth |
| `PAI_DR_NO_WEB` | `false` (spec default), **`--sensitivity no_web` required for canary default** | Offline/no-web enforcement |
| `PAI_DR_RUNS_ROOT` | `~/.config/opencode/research-runs` | Artifact root path |

Gate F mapping reminder:
- Feature flags requirement: `spec-gate-thresholds-v1.md` Gate F pass criteria
- Reviewer evidence requirement: `spec-reviewer-rubrics-v1.md` Gate F required evidence

## Verification

Run from repo root. Default path is offline-first and network-free.

### 1) Offline-first env setup (required)
```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "Gate F canary" --run-id "dr_gatef_canary" --sensitivity no_web
```
Expected outcome:
- Run is initialized with Option C enabled and no-web enforced.

### 2) Feature flags contract test
```bash
bun test .opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```
Expected outcome:
- Exit code `0`
- Output indicates feature flags and caps behave as expected.

### 3) Fallback path contract test
```bash
bun test .opencode/tests/entities/deep_research_fallback_path.test.ts
```
Expected outcome:
- Exit code `0`
- Output confirms deterministic fallback to standard workflow with artifact preservation.

### 4) Watchdog timeout contract test
```bash
bun test .opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```
Expected outcome:
- Exit code `0`
- Output confirms timeout handling remains deterministic.

### 5) Verify Gate F criteria sources are referenced
```bash
rg -n "Gate F|Rollout safety|PASS checklist|required evidence" .opencode/Plans/DeepResearchOptionC/spec-gate-thresholds-v1.md .opencode/Plans/DeepResearchOptionC/spec-reviewer-rubrics-v1.md
```
Expected outcome:
- Matches found in both files confirming Gate F definition and rubric criteria sources.

### 6) Verify this playbook enforces no-web default
```bash
rg -n "--sensitivity no_web|offline-first|No network-required steps" .opencode/Plans/DeepResearchOptionC/rollout-playbook-v1.md
```
Expected outcome:
- Matches confirm default no-web posture and explicit offline-first guidance.
