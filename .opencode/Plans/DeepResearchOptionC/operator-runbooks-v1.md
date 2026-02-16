# Operator Runbooks v1 — Phase 07 Drills

## Purpose
Operator drill runbooks for **P07-08** covering:
- Pause/Resume drill
- Emergency rollback drill
- Fallback-on-hard-gate-fail drill
- Postmortem checklist

## Authoritative references (Phase 07 + Gate F)
- `deep-research-option-c-phase-07-rollout-hardening.md`
- `deep-research-option-c-phase-07-executable-backlog.md`
- `deep-research-option-c-phase-07-orchestration-runbook.md`
- `deep-research-option-c-phases-04-07-testing-plan.md`
- `PHASE-07-CHECKPOINT-GATE-F.md` (**Gate F checkpoint**)
- `spec-rollback-fallback-v1.md`

## Global safety rules (apply to all drills)
- **Artifact retention is mandatory: never delete run artifacts.**
- Default to offline-first drill mode unless explicitly running a sandboxed web canary.
- Record all command outputs and artifact paths in the drill log.

### Baseline setup commands
Run from repo root:

```bash
export PAI_DR_OPTION_C_ENABLED=1
```
Expected outcome: env var is set for this shell.

```bash
export PAI_DR_NO_WEB=1
```
Expected outcome: env var is set for this shell; no-web mode is active.

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```
Expected outcome: exit code `0`; feature-flag behavior passes in offline mode.

---

## Drill 1 — Pause/Resume (interrupted run continuity)

### Checklist
- [ ] Baseline env set (`PAI_DR_OPTION_C_ENABLED=1`, `PAI_DR_NO_WEB=1`)
- [ ] Pause trigger executed during active long-running run
- [ ] Resume trigger executed
- [ ] Run continues without silent hang
- [ ] Checkpoint/timeout artifact path captured
- [ ] Evidence link prepared for Gate F checkpoint notes

### Commands
```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```
Expected outcome: exit code `0`; watchdog timeout behavior remains deterministic.

```bash
rg -n "pause|resume" .opencode/Plans/DeepResearchOptionC/spec-pause-resume-v1.md
```
Expected outcome: one or more matches proving pause/resume policy is documented.

```bash
rg -n "Gate F|Rollout safety" .opencode/Plans/DeepResearchOptionC/PHASE-07-CHECKPOINT-GATE-F.md
```
Expected outcome: Gate F references are present for checkpoint alignment.

---

## Drill 2 — Emergency disable / rollback (route to standard workflow)

### Checklist
- [ ] Emergency disable command/path validated
- [ ] Option C routed off deterministically
- [ ] Standard research workflow path confirmed
- [ ] No run artifacts deleted during rollback
- [ ] Gate F evidence references updated

### Commands
```bash
PAI_DR_OPTION_C_ENABLED=0 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```
Expected outcome: exit code `0`; disabled-path behavior is accepted by contract tests.

```bash
rg -n "rollback|disable|standard workflow" .opencode/Plans/DeepResearchOptionC/spec-rollback-fallback-v1.md
```
Expected outcome: rollback trigger and deterministic downgrade guidance are present.

```bash
rg -n "phase-07-rollout-hardening|phase-07-executable-backlog|phase-07-orchestration-runbook" .opencode/Plans/DeepResearchOptionC/PHASE-07-CHECKPOINT-GATE-F.md
```
Expected outcome: checkpoint references Phase 07 plan docs used for signoff.

---

## Drill 3 — Fallback on hard gate fail (artifact-first failure handling)

### Checklist
- [ ] Hard gate failure scenario simulated/tested
- [ ] Fallback offer to standard workflow is visible/deterministic
- [ ] Failure summary recorded
- [ ] Artifacts preserved and linked
- [ ] Artifact safety scan run (no credential-bearing URLs)

### Commands
```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_fallback_path.test.ts
```
Expected outcome: exit code `0`; fallback path executes and artifact retention behavior is confirmed.

```bash
rg -n "fallback|preserve artifacts|never delete" .opencode/Plans/DeepResearchOptionC/spec-rollback-fallback-v1.md
```
Expected outcome: fallback and artifact-retention requirements are explicitly documented.

```bash
rg -n "token=|access_token=|://[^[:space:]]+@" logs summaries .opencode/Plans/DeepResearchOptionC 2>/dev/null || true
```
Expected outcome: either no matches or only intentionally redacted examples; any match must be remediated and documented.

---

## Redaction

Never print raw credential-bearing URLs in drill logs, summaries, or checkpoint evidence.

### Rules
- Do not print URLs containing `userinfo` (`https://user:pass@host/...`).
- Do not print `token`, `access_token`, `sig`, or similar secret query params.
- Prefer `cid` references or redacted URL forms in all shared artifacts.

### Examples
- ❌ Raw (forbidden):
  - `https://alice:secret123@example.com/path?access_token=abcd1234&sig=xyz`
- ✅ Redacted (allowed):
  - `cid:run-2026-02-15-01`
  - `https://example.com/path?[userinfo-redacted]&access_token=[redacted]&sig=[redacted]`

### Redaction verification command
```bash
rg -n "https?://[^[:space:]]+@|access_token=|token=|sig=" .opencode/Plans/DeepResearchOptionC operator-drills-log-v1.md PHASE-07-CHECKPOINT-GATE-F.md 2>/dev/null || true
```
Expected outcome: no raw credential-bearing URL output in operator-facing artifacts.

---

## Postmortem checklist (after each drill)
- [ ] Drill ID, operator, timestamp, and scenario captured
- [ ] Expected vs actual behavior documented
- [ ] Command transcript attached (or linked)
- [ ] Artifact list captured (logs, summaries, checkpoints, evidence paths)
- [ ] **Artifact retention confirmed (never delete run artifacts)**
- [ ] Redaction scan completed and result recorded
- [ ] Root cause (if failure) documented with corrective action
- [ ] Gate F checkpoint update need assessed and queued

## Gate F checkpoint handoff notes
- If drill uncovered a gap, update evidence mapping in `PHASE-07-CHECKPOINT-GATE-F.md`.
- Keep references aligned with:
  - `deep-research-option-c-phase-07-rollout-hardening.md`
  - `deep-research-option-c-phase-07-executable-backlog.md`
  - `deep-research-option-c-phase-07-orchestration-runbook.md`
