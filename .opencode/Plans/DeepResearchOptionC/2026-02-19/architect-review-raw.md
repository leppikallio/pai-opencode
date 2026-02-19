## Executive summary (bullet)

- **Option C is now a real, mostly end-to-end deterministic pipeline** with stage gating, audit logs, locks, watchdog, and a full “canary finalize” path (M2/M3) — but several “real research” pieces are still **scaffolds**.
- The **operator CLI exists and is substantial** (`.opencode/pai-tools/deep-research-option-c.ts`), including prompt-out “task driver”, halt artifacts, triage, pause/resume, fixture capture — but it still **depends on env/settings for enablement and defaults**, which is an LLM-footgun.
- The system is **maximally deterministic in its control-plane** (stage transitions, caps, digests, artifact locations), but the **data-plane** is still incomplete:
  - **Wave 2** currently writes placeholder content instead of running agents.
  - **Summaries + synthesis generate modes** are deterministic templating (not LLM-backed summarization).
- “Live mode” as true M2/M3 “research” needs: (1) **no-env CLI contract**, (2) **first-class pause/resume + halt artifacts at tool level**, (3) **Task-backed/agent-result drivers for wave2 + summaries + synthesis**, (4) **bounded online citations with deterministic fixture capture/replay**.

---

## What’s solid vs what’s missing

### What’s solid

#### 1) Pipeline surface area is broad and coherently modular

The tool export surface indicates a complete pipeline vocabulary: init, stage advance, locks, orchestrators, wave tools, citations tools, phase05/06 tools, fixtures, regression, and quality audit.

- Evidence: `.opencode/tools/deep_research/index.ts:1-49` exports the full set including orchestrators, gates, citations, summaries, synthesis, review, fixtures, and audits.

#### 2) Stage machine is explicit, deterministic, and gate-aware

`stage_advance` defines a strict stage set and deterministic allowed-next transitions, with additional policy checks:

- Stage set: `init|wave1|pivot|wave2|citations|summaries|synthesis|review|finalize`.
- Deterministic transitions: `init->wave1->pivot->(wave2|citations)->citations->summaries->synthesis->review->(synthesis|finalize)`.
- Policy enforcement examples:
  - `pivot` transition depends on `pivot.json` decision.
  - `review` transition depends on `review-bundle.json` decision and a review-iteration cap.

- Evidence: `.opencode/tools/deep_research/stage_advance.ts:72-212` (allowedStages + allowedNextFor)
- Evidence: `.opencode/tools/deep_research/stage_advance.ts:239-279` (pivot + review are special deterministic transitions)
- Evidence: `.opencode/tools/deep_research/stage_advance.ts:493-495` (finalize requires Gate E pass)

#### 3) Run isolation and safety primitives exist (locks, optimistic revisioning, path containment)

- **Run lock**: `.lock` file with lease, stale detection, heartbeat refresh, and release.
  - Evidence: `.opencode/tools/deep_research/run_lock.ts:187-292` (acquire + stale takeover)
  - Evidence: `.opencode/tools/deep_research/run_lock.ts:371-399` (heartbeat)
- **Optimistic concurrency**: `manifest_write` bumps revision and can enforce `expected_revision`.
  - Evidence: `.opencode/tools/deep_research/manifest_write.ts:42-58` (revision lock + bump)
- **Path traversal defenses** are present in orchestrators and ingest:
  - Live tick uses `resolveContainedPath` and realpath containment.
    - Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:144-226` and `:625-656`.
  - Wave output ingest rejects symlinks, validates under run_root, transactional writes.
    - Evidence: `.opencode/tools/deep_research/wave_output_ingest.ts:223-249` and `:343-421`.

#### 4) Wave 1 has a practical, resumable “task driver” operator loop in the CLI

The CLI can “prompt-out” missing Wave 1 perspectives, halt with `RUN_AGENT_REQUIRED`, then ingest results via `agent-result` and resume ticks.

- Prompt-out and missing detection:
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:772-803` (writes `operator/prompts/wave1/<id>.md`, checks meta prompt_digest)
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:805-819` (emits `agent-result` skeleton commands)
- Tick behavior:
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:2053-2082` (short-circuits tick into typed `RUN_AGENT_REQUIRED` with missing details)
- Canonical ingestion contract is tested:
  - Evidence: `.opencode/tests/entities/deep_research_operator_cli_task_driver.test.ts:57-114` (tick task driver -> halt -> agent-result -> `wave-1/p1.md` and `wave-1/p1.meta.json` with prompt_digest)

#### 5) Canary-level end-to-end finalize path exists (deterministic “generate” data plane)

M2 “wave1 -> pivot” and M3 “finalize” canaries exist and pass in a seeded offline setup.

- Evidence: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts:41-121` (reaches pivot; Gate B pass)
- Evidence: `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts:45-164` (reaches finalize; Gate E pass)

### What’s missing (blocking “true M2/M3 real research”)

#### A) No-env operator contract (status: RESOLVED)

You explicitly require: *single CLI, no env vars; env vars even set by the CLI are anti-pattern*.

This review originally identified env-var reliance as the biggest operator-constraint violation.

As of WS1, env inputs are intentionally unsupported for Option C flags; effective values come from defaults + integration-layer settings.json + per-run manifest constraints.

Updated evidence (post-fix):
- Feature flag resolution is settings-only (no env reads): `.opencode/tools/deep_research/lifecycle_lib.ts` (`resolveDeepResearchFlagsV1`)
- Stage disable is per-run manifest constraint: `manifest.query.constraints.option_c.enabled=false`
- Citations config precedence no longer includes env fallback: `.opencode/tools/deep_research/citations_validate*.ts`
- Operator docs/skills use canonical CLI and do not instruct env exports: `.opencode/commands/deep-research.md`, `.opencode/skills/deep-research-option-c/**`

#### B) Wave 2 is currently a placeholder, not an agent-driven research wave

Post-pivot code can generate a wave2 plan, but the wave2 “execution” path currently ingests **synthetic markdown** and even uses example URLs.

- Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:679-691` (buildWave2Markdown includes `https://example.com/wave2/<gap_id>`)
- Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:1006-1038` (ingests generated outputs via `wave_output_ingest`, no agent seam)

For real runs, wave2 must have the same *driver seam* as wave1: prompt-out/task driver, `agent-result`, per-gap contracts, retries, and caps.

#### C) Summaries + synthesis “generate mode” is deterministic templating, not real summarization

The post-summaries orchestrator can run without fixtures, but the default “generate” data-plane is essentially deterministic extraction + templated bullets.

- Summary pack generate path:
  - Evidence: `.opencode/tools/deep_research/summary_pack_build.ts:68-69` (mode defaults; orchestrator selects generate when no fixture dir)
  - Evidence: `.opencode/tools/deep_research/summary_pack_build.ts:184-246` (generate mode builds “Findings/Evidence” from sanitized source lines)
- Synthesis generate path:
  - Evidence: `.opencode/tools/deep_research/synthesis_write.ts:121-206` (generate mode composes a bounded draft from summary lines)

This is perfectly fine as a determinism scaffold, but it is **not “real research output”**. The missing piece is an LLM/agent seam (ideally prompt-out + agent-result) for:

- per-perspective summaries
- synthesis draft
- review loop feedback incorporation

#### D) Long-running/1h+ runs are not safe with current watchdog semantics

Stage timeouts are short (minutes), and watchdog checks run only pre/post tick in orchestrator_run_* loops.

- Evidence: `.opencode/tools/deep_research/schema_v1.ts:17-27` (wave1/wave2/citations/summaries/synthesis timeouts = 600s)
- Evidence: `.opencode/tools/deep_research/orchestrator_run_live.ts:255-395` (watchdog_check only pre/post tick)

If a single `drivers.runAgent` call blocks for >10 minutes without manifest progress writes, the next post-tick watchdog will mark the run failed even though work was “in progress”.

The task-driver pattern for wave1 largely solves this by making agent work external and resumable, but the same pattern is missing for wave2 and phase05/06.

---

## Determinism & dynamic seams

### Control-plane determinism (good)

**Deterministic inputs digests** appear throughout critical decisions:

- Wave1 plan has `inputs_digest` derived from query text, scope contract, caps, and perspective contracts.
  - Evidence: `.opencode/tools/deep_research/wave1_plan.ts:131-187`
- Pivot decision has `inputs_digest` and explicit deterministic rule-hit for wave2 requirement.
  - Evidence: `.opencode/tools/deep_research/pivot_decide.ts:340-368`
- Stage advance produces `inputs_digest` over evaluated artifacts + gate statuses, and records transition history.
  - Evidence: `.opencode/tools/deep_research/stage_advance.ts:497-546`

This is exactly the right architecture: **make state transitions and gating decisions deterministic**, while allowing data-plane content (LLM output) to be non-deterministic *but recorded*.

### Data-plane dynamic seams (current state)

#### 1) Wave1 LLM seam is present and bounded (good), but only for wave1

- Wave output contract enforcement is strict: required headings, word cap, source count cap, sources parser.
  - Evidence: `.opencode/tools/deep_research/wave_output_validate.ts:77-117`
- Wave review aggregates failures into retry directives deterministically.
  - Evidence: `.opencode/tools/deep_research/wave_review.ts:207-236`
- Live tick supports retry directives injection into prompt text.
  - Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:1031-1076` (reads `retry/retry-directives.json`, appends “Retry Directive”)

**Missing bounding:** wave1 currently runs all planned entries inside one tick when using `drivers.runAgent` (non-task mode). For long runs, wave1 should be forced into task-driver mode (prompt-out + ingest) by default.

#### 2) Wave2 and phase05/06 have no agent seam yet (gap)

Wave2 execution is synthetic (see above). Summary/synthesis generate is deterministic templating (see above).

**Recommendation:** extend the same “prompt-out + agent-result + deterministic validate/ingest” pattern to:

- wave2 per-gap
- per-perspective summaries
- synthesis draft
- review iteration changes

Key design constraint: keep determinism by:

- generating prompts deterministically from artifact digests and contract constraints
- storing prompt digests in meta sidecars
- recording all “operator/agent inputs” with immutable paths and digests

#### 3) Online citations are intentionally non-deterministic — but can be bounded via fixtures

The citations ladder is a good design: it can be run in deterministic dry-run or deterministic fixture mode.

- Evidence: `.opencode/tools/deep_research/citations_validate.ts:143-151` (args include offline_fixtures_path, online_fixtures_path, online_dry_run)

But the **configuration precedence** includes env and therefore violates the no-env operator constraint.

- Evidence: `.opencode/tools/deep_research/citations_validate_lib.ts:337-359` (manifest -> run-config -> env)

**Bounded seam recommendation:** enforce a strict precedence for “operator-driven real research”:

1) manifest.query.sensitivity (offline/dry-run/online)
2) run-config.json (endpoints + fixture pointers)
3) explicit CLI args
4) (never) env

---

## Operator CLI recommendation (exact spec, exact changes, exact improvements)

### Current reality

- The canonical operator CLI is already implemented in-repo:
  - `.opencode/pai-tools/deep-research-option-c.ts` (cmd-ts based)
    - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:8-21` (cmd-ts)

The `/deep-research` command doc and runtime skill reference a path that is inconsistent (`pai-tools/...` without `.opencode/`).

- Evidence: `.opencode/commands/deep-research.md:35-37` (uses `bun ".opencode/pai-tools/deep-research-option-c.ts"`)

### CLI should be the single operator surface (shape)

I recommend standardizing on **one canonical invocation** that is stable for an LLM operator:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" <command> [flags]
```

And **making every command optionally machine-readable** via `--json` with one JSON object printed to stdout.

#### Proposed commands (tight, LLM-friendly)

Keep the existing command set (it is good), but tighten contracts and remove env reliance:

1) `init "<query>" [--run-id <id>] [--runs-root <abs>] [--mode quick|standard|deep] [--sensitivity normal|restricted|no_web] [--force] [--no-perspectives] [--json]`
   - Must always write/refresh:
     - `operator/scope.json` (scope.v1)
     - `perspectives.json` (if not `--no-perspectives`)
     - `wave-1/wave1-plan.json`
     - `run-config.json`
   - Must always end at `manifest.stage.current=wave1`.

2) `tick --manifest <abs> [--gates <abs>] --driver fixture|task|manual --reason "..." [--json]`
   - `--driver task` is the default for anything that might take long.
   - Must always:
     - write/update `operator/halt/latest.json` when blocked
     - print `contract_json` when `--json`

3) `agent-result --manifest <abs> --stage wave1|wave2|summaries|synthesis --perspective <id> --input <abs_md> --agent-run-id <id> --reason "..." [--started-at <iso>] [--finished-at <iso>] [--model <id>] [--json]`
   - Expand `stage` beyond `wave1` once wave2/phase05/06 get task-driver seams.

4) `run --manifest <abs> [--gates <abs>] --driver fixture|task|manual --reason "..." [--max-ticks <n>] [--until <stage>] [--json]`
   - Just loops `tick` until terminal state or halt.

5) `status|inspect|triage --manifest <abs> [--json]`
6) `pause|resume|cancel --manifest <abs> --reason "..." [--json]`
7) `capture-fixtures --manifest <abs> --reason "..." [--output-dir <abs>] [--bundle-id <id>] [--json]`

### Exact changes needed to meet the “no env vars” constraint

1) **Remove env gating from tools and CLI** (replace with explicit, persisted enablement).

- Today:
  - Evidence: `.opencode/tools/deep_research/run_init.ts:110-115` requires `flags.optionCEnabled`.
  - Evidence: `.opencode/tools/deep_research/flags_v1.ts:122-177` reads env overrides.
  - Evidence: `.opencode/tools/deep_research/stage_advance.ts:35-46` reads env.

2) Replace it with **manifest-authored enablement**:

- Add (conceptually) `manifest.query.constraints.deep_research_flags.option_c_enabled=true` at init time.
- Tools check the manifest flag, not env.
- CLI always sets it when it creates the run.

3) Add `--runs-root <abs>` for resumability by run-id without env.

- Today `--run-id` resolution requires `PAI_DR_RUNS_ROOT` via flags.
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1048-1053`

4) Remove env from citations config precedence.

- Today config resolver includes env.
  - Evidence: `.opencode/tools/deep_research/citations_validate_lib.ts:337-360`

### Exact improvements for LLM ergonomics

- Add `--json` support to *all* CLI commands (not only status/inspect/triage). The CLI already has a clear “contract print” function.
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1096-1110` (contract print)
- Ensure all non-success outcomes produce a typed halt artifact and print `halt.path`.
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1592-1661` (halt artifact schema + write)

---

## Resumability/long-run requirements

### What already supports pause/resume

- Orchestrators refuse to run when `manifest.status=paused` or `cancelled`.
  - Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:575-588`
  - Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:363-376`
- CLI pause/resume exist and write checkpoints.
  - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:2545-2623` (pause/resume write checkpoints; resume refreshes `stage.started_at`)

### What’s missing for safe 1h+ runs

1) **Tick granularity must be bounded**

- Wave1 non-task live driver can run multiple perspectives inside one tick.
  - Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:1055-1190` (loops plannedEntries; each may call runAgent)

For 1h+ runs, each tick should do **one atomic unit of progress** (one perspective, one gap, one summary) and then checkpoint + return.

2) **Watchdog should not punish long-running external work**

Current watchdog is stage-based and time-based.

- Evidence: `.opencode/tools/deep_research/watchdog_check.ts:94-124` (timer origin uses started_at/last_progress_at)

For long-run agent calls, ensure *manifest progress* is updated before/after every external subtask and (ideally) periodically during waiting.

3) **Run lock lease is too short for worst-case long operations**

Lease is 120 seconds.

- Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:607-620` (lease_seconds=120)

If a tick genuinely runs longer than lease and heartbeat fails (process stalls), lock can be stolen and two operators can mutate state.

Mitigation: increase lease for long operations, or write a “tick-in-progress” checkpoint and rely on task-driver (short ticks).

4) **Idempotency / retry directives should exist for phases beyond wave1**

Wave1 has deterministic retry directives file (`retry/retry-directives.json`) that is consumed and cleared.

- Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:1020-1053` (reads active retry notes, consumes artifact when done)

Equivalent concepts are missing for wave2, summaries, synthesis, and review “CHANGES_REQUIRED” loops.

---

## Skill recommendations (names + workflows)

### Current runtime skill (what it covers)

The runtime skill `deep-research-option-c` is a thin runbook wrapper around the CLI.

- Evidence: `/Users/zuul/.config/opencode/skills/deep-research-option-c/SKILL.md:10-21` (primary surface + no-env guidance)
- Evidence: `/Users/zuul/.config/opencode/skills/deep-research-option-c/Workflows/RunPlan.md:25-33` (init does run_init/perspectives_write/wave1_plan/stage_advance)

### Missing skills/workflows for “real operator use”

To make Marvin reliable as an operator, I recommend adding a small set of workflows that reflect the real lifecycle: **define → confirm perspectives → run → pause/resume → rerun**.

#### Skill: `deep-research-option-c` (extend)

Add workflows (each should include a tight validation contract):

1) **DefineResearchStub**
   - Goal: capture query, constraints, and desired deliverable into a persisted “stub”.
   - Artifact: `operator/research-stub.json` (or re-use `operator/scope.json` but add explicit “stub v1”).
   - Validation:
     - stub exists under run_root
     - stub references run_id and manifest_path

2) **GeneratePerspectivesThenConfirm**
   - Goal: generate an initial perspectives set, show it to you for approval, then persist.
   - Mechanism:
     - write `perspectives.json` via CLI/tool
     - print the perspectives list and require explicit confirmation before running wave1
   - Validation:
     - `perspectives.json` passes `perspectives_write` validation
       - Evidence that tool exists: `.opencode/tools/deep_research/perspectives_write.ts:14-36`

3) **RefinePerspectives**
   - Goal: add/remove/edit perspectives and re-generate `wave1-plan.json` deterministically.
   - Validation:
     - wave1-plan inputs_digest changes after edit

4) **RunWave1WithTaskDriver**
   - Goal: loop `tick --driver task` and (a) spawn research agents, (b) ingest via `agent-result`, until pivot.
   - Validation:
     - Gate B pass; stage.current=pivot

5) **RunWave2WithTaskDriver** (blocked today; needs implementation)
   - Same as wave1 but per-gap.

6) **ResolveCitationsAndBlockedUrls**
   - Goal: if citations validation blocks, collect `blocked-urls.json` and produce next actions.
   - Validation:
     - Gate C pass and `citations/citations.jsonl` exists

7) **ProduceSummariesAndSynthesis** (blocked today; needs agent seam)
   - Goal: create summaries + synthesis using bounded agent prompts (not deterministic templating).

8) **ReviewLoopUntilFinalize**
   - Goal: run review loop until PASS or cap.
   - Validation:
     - stage.current=finalize and Gate E pass

#### Skill: `deep-research-option-c-runbook`

If you want separation of concerns, keep the CLI-driving operator runbooks in a separate skill that is explicitly “operational”, leaving the core skill as a library.

---

## Risk register

1) **Env var enablement breaks LLM-driven CLI runs**
   - Evidence: `.opencode/commands/deep-research.md:10-16`, `.opencode/tools/deep_research/flags_v1.ts:122-177`
   - Mitigation: replace env gating with manifest-authored enablement + CLI flags persisted in run-config.

2) **Wave2 is synthetic; produces fake sources**
   - Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:679-691`
   - Mitigation: implement wave2 task-driver + `agent-result` ingestion and validation.

3) **Summaries/synthesis generate modes are not real research**
   - Evidence: `.opencode/tools/deep_research/summary_pack_build.ts:184-246`, `.opencode/tools/deep_research/synthesis_write.ts:121-206`
   - Mitigation: add agent seam for summary + synthesis generation with bounded contracts and deterministic ingestion.

4) **Watchdog timeouts will kill long agent calls**
   - Evidence: `.opencode/tools/deep_research/schema_v1.ts:17-27`, `.opencode/tools/deep_research/orchestrator_run_live.ts:255-395`
   - Mitigation: enforce task-driver mode for any stage with external latency; update progress timestamps per subtask.

5) **Run lock lease can be stolen during stalls**
   - Evidence: `.opencode/tools/deep_research/run_lock.ts:187-292`
   - Mitigation: longer leases for long ticks; prefer short ticks; write tick-in-progress checkpoints.

6) **Config precedence is too complex (manifest vs run-config vs env)**
   - Evidence: `.opencode/tools/deep_research/citations_validate_lib.ts:328-360`
   - Mitigation: strict precedence with no env, documented and enforced; emit `run-config.json` in init.

7) **/deep-research doc references inconsistent CLI path**
   - Evidence: `.opencode/commands/deep-research.md:35-37` vs actual CLI `.opencode/pai-tools/deep-research-option-c.ts`
   - Mitigation: standardize and update docs + skills to single canonical path.

8) **Single tick doing multiple wave outputs is hard to resume mid-flight**
   - Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:1055-1190`
   - Mitigation: one-perspective-per-tick or always task-driver prompt-out/ingest.

9) **Generated artifacts include non-deterministic timestamps and mtimes**
   - Evidence: `.opencode/tools/deep_research/stage_advance.ts:526-547` (timestamps), `.opencode/tools/deep_research/orchestrator_tick_live.ts:400-407` (mtime-based created_at fallback)
   - Mitigation: ensure gate/decision digests never include wall-clock artifacts except in audit fields; keep digests deterministic.

10) **Operator skill lacks perspective confirmation + stub workflow**
   - Evidence: runtime workflows list does not include perspective confirmation step (`/Users/zuul/.config/opencode/skills/deep-research-option-c/SKILL.md:29-37`).
   - Mitigation: add “GeneratePerspectivesThenConfirm” + “DefineResearchStub” workflows.

---

## Readiness rubric

### Pass/Fail: “Ready for real research runs”

**PASS requires all of these to be true:**

1) **No-env CLI contract**
   - CLI runs end-to-end without any required env vars.
   - `--runs-root` exists and defaults are stable.

2) **Operator stub is persisted and resumable**
   - Run has: `manifest.json`, `gates.json`, `operator/scope.json`, and a persisted stub referencing perspectives.
   - New session can resume from `--manifest` alone.

3) **Perspectives confirmation step exists and is enforced**
   - Marvin shows generated perspectives and requires explicit approval before wave1 execution.
   - Updating perspectives regenerates wave1 plan deterministically.

4) **Wave1 uses task-driver by default**
   - `tick --driver task` produces prompts + halt artifact when missing.
   - `agent-result` ingestion is validated and idempotent (prompt_digest match).
     - Evidence of prompt_digest contract: `.opencode/pai-tools/deep-research-option-c.ts:735-803` and test `.opencode/tests/entities/deep_research_operator_cli_task_driver.test.ts:102-113`.

5) **Wave2 has an equivalent task-driver seam** (currently FAIL)
   - prompt-out, agent-result ingestion, validate/ingest, deterministic retry directives.

6) **Citations mode is explicit and reproducible**
   - offline mode requires offline fixtures
   - online mode either captures fixtures or uses deterministic replay
   - blocked URL queue is surfaced to operator
   - no env-based endpoints

7) **Summaries + synthesis are agent-backed (or explicitly acknowledged as scaffolds)**
   - If scaffolds remain, operator explicitly marks run as “canary only / non-production research”.

8) **Restart guidance is unambiguous**
   - After restart, operator can run `status/inspect/triage`, see halt artifacts, and continue.
   - Lockfiles are safely handled (stale detection works).

If any of #1, #3, #4, #5, #6 are false, I would call this **NOT ready** for real research runs.

---

## Next 10 concrete steps

1) **Remove env gating** from `run_init` and `stage_advance`; replace with manifest-authored enablement.
2) Add `--runs-root` flag to the CLI and stop using env for run-id lookup.
3) Update `.opencode/commands/deep-research.md` to reference the canonical CLI path and remove `export ...` instruction.
4) Add `--json` output to all CLI commands (`init/tick/run/pause/resume/cancel/agent-result`).
5) Implement **wave2 task-driver**: prompt-out per gap, `agent-result` ingestion, validation, retry directives.
6) Implement **summaries task-driver**: per-perspective summary prompts, `agent-result` ingestion, bounded contract, Gate D.
7) Implement **synthesis task-driver**: prompt-out synthesis draft, `agent-result` ingestion, Gate E.
8) Make watchdog semantics long-run safe by forcing task-driver for long latency stages and updating `last_progress_at` per subtask.
9) Make citations config strictly “manifest + run-config + CLI args” (no env) and document precedence.
10) Extend the runtime skill with workflows: DefineResearchStub, GeneratePerspectivesThenConfirm, RefinePerspectives, RunWave1TaskDriver.

---

### Diagrams saved in this directory

- `architecture-map.drawio`
- `process-flow.drawio`
