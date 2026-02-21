# Deep Research Option C Hardening & Autonomy — Phased Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Convert Deep Research (Option C) into a reliable, LLM/operator-drivable pipeline that can safely run M2/M3 with long-run resilience.

**Architecture:** Preserve the artifact-first run root + explicit stage machine. Close P0 footguns first, then extend the `runAgent` seam beyond Wave 1, then harden long-run ergonomics/perf.

**Tech Stack:** Bun + TypeScript, cmd-ts CLI (`.opencode/pai-tools/deep-research-cli/**`), tool/orchestrator layer (`.opencode/tools/deep_research_cli/**`), tests (`.opencode/tests/**`).

---

## Inputs (source of truth)

- Architecture review report (this is what we’re implementing):
  - `/Users/zuul/Projects/pai-opencode/docs/reviews/deep_research/2026-02-21/architect-review-raw.md`

## Hard constraints (do not violate)

- **Do not change OpenCode itself.** All changes stay in this repo.
- **Do not edit runtime directly** (`/Users/zuul/.config/opencode/**`) — only via repo + install flow.
- Keep changes **DRY / YAGNI**, with **TDD-first** where practical.
- Prefer deterministic, inspectable artifacts over implicit state.

## Phase files (recommended order)

- Overview + coverage: `00-overview.md`
- Phase 0A — P0 blockers (gates/consistency/wrappers): `01-phase-0-p0-blockers.md`
- Phase 0B — Run lock + watchdog resilience: `04-phase-0-run-lock-watchdog-resilience.md`
- Phase 0C — Determinism digests + IDs: `05-phase-0-determinism-digest-canonicalization.md`
- Phase 1A — CLI JSON contract unification: `06-phase-1-cli-json-contract-unification.md`
- Phase 1B — Citations endpoint contract (init → run-config → validator): `08-phase-1-citations-endpoint-contract.md`
- Phase 1C — Autonomy + quality (extend runAgent seam + enforce budgets): `02-phase-1-autonomy-quality.md`
- Phase 1D — Skill workflows + docs (operator runbooks): `07-phase-1-skill-workflows-and-docs.md`
- Phase 1E — Scaffold vs real research mode (warnings + gates): `09-phase-1-scaffold-vs-real-research-mode.md`
- Phase 2A — Long-run hardening (telemetry, policies): `03-phase-2-long-run-hardening.md`
- Phase 2B — Crash recovery + atomic operator artifacts: `10-phase-2-crash-recovery-and-atomic-operator-artifacts.md`

## Coverage matrix (review issues → plan files)

This is the “no gaps” map from the architecture review to concrete plans.

### Risk register (Top 10) coverage

| Risk register item (from review)                               | Plan file(s)                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1) Gate F is a stub (rollout safety unimplemented)             | `01-phase-0-p0-blockers.md`                                                               |
| 2) Stage timeout constants diverge                             | `01-phase-0-p0-blockers.md`                                                               |
| 3) Run lock heartbeat ignores refresh failures                 | `04-phase-0-run-lock-watchdog-resilience.md`                                              |
| 4) Invalid lock file blocks progress (no stale recovery)       | `04-phase-0-run-lock-watchdog-resilience.md`                                              |
| 5) Endpoint config is ambient (settings.json)                  | `08-phase-1-citations-endpoint-contract.md`                                               |
| 6) Repo Tools wrappers reference old tool namespace            | `01-phase-0-p0-blockers.md`                                                               |
| 7) Digest computation not canonical (JSON.stringify key order) | `05-phase-0-determinism-digest-canonicalization.md`                                       |
| 8) Tool budgets exist but are not enforced                     | `02-phase-1-autonomy-quality.md`                                                          |
| 9) Generate-mode can “pass” while low-value (scaffold vs real) | `09-phase-1-scaffold-vs-real-research-mode.md` + `07-phase-1-skill-workflows-and-docs.md` |
| 10) Telemetry append is O(n) per event                         | `03-phase-2-long-run-hardening.md`                                                        |

### Additional review topics coverage

| Review topic                                                       | Plan file(s)                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Repo vs runtime CLI invocation mismatch                            | `06-phase-1-cli-json-contract-unification.md` + `07-phase-1-skill-workflows-and-docs.md` |
| Standard JSON envelope (schema_version/contract/result/halt/error) | `06-phase-1-cli-json-contract-unification.md`                                            |
| Include `halt.next_commands[]` inline in `--json` output           | `01-phase-0-p0-blockers.md` + `06-phase-1-cli-json-contract-unification.md`              |
| Watchdog timeout emits typed artifact (not only markdown)          | `04-phase-0-run-lock-watchdog-resilience.md`                                             |
| Atomic writes for operator artifacts (prompts/config)              | `10-phase-2-crash-recovery-and-atomic-operator-artifacts.md`                             |
| Crash recovery (tick in-progress marker + ledger usage)            | `10-phase-2-crash-recovery-and-atomic-operator-artifacts.md`                             |
| Citations ladder budgets/backoff policy persisted                  | `03-phase-2-long-run-hardening.md`                                                       |
| Skill workflows: LLM driver loop + M2/M3 canaries                  | `07-phase-1-skill-workflows-and-docs.md`                                                 |

## Note: legacy drafts in this folder

If you see older draft files (for example: `04-phase-0b-...`, `07-phase-0c-...`, `08-phase-0d-...`, `06-phase-2b-...`, `05-phase-3-...`), treat the **Phase files (recommended order)** list above as canonical for execution.

## Orchestration model (how Marvin will execute these plans)

When you tell me to start execution, I will run this as **subagent-driven development**:

1) **One micro-task at a time** (2–10 minutes), strict scope.
2) **Builder subagent (Engineer)** implements the micro-task.
3) **Local verification** (tests/reads) immediately after each micro-task.
4) **Frequent commits** (small, reversible).
5) **Phase gates** at the end of each phase:
   - **Architect Gate (PASS required):** *Architect agent* reviews diffs/behavior against the phase goals.
   - **QA Gate (PASS required):** *QATester agent* runs the phase’s verification commands and reports test output.

I will track execution progress using:

- `functions.todowrite` (authoritative in-session progress)
- The phase plan checklists (checkboxes updated as we go)

## Global “Definition of PASS” (applies to every phase gate)

### Architect Gate — PASS criteria

- The phase’s intended behavior change is correct and minimal.
- No new implicit state; new state is persisted in run root artifacts.
- Contracts are explicit (JSON envelopes / halt artifacts / driver behaviors).
- Determinism is improved or at least not regressed.
- No edits to `/Users/zuul/.config/opencode/**` and no proposals to modify OpenCode.

### QA Gate — PASS criteria

- `bun test` passes for:
  - Any newly added tests for the phase
  - Existing deep research smoke/regression tests relevant to the changed surface
- No flaky time-based tests without deterministic controls.

## Suggested verification commands (baseline)

Run from repo root:

```bash
bun test .opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
bun test .opencode/tests/smoke/deep_research_citations_repro_canary.test.ts
bun test .opencode/tests/regression/deep_research_phase06_regression.test.ts
```

## Execution start (when you approve)

Once you approve execution, I will:

1) Create a dedicated worktree per phase (or a single worktree for Phase 0→2 if you prefer)
2) Execute tasks in order with builder subagents
3) Run Architect+QA gates before moving to the next phase
