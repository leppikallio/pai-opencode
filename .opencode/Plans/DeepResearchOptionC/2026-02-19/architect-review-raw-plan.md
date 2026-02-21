# Orchestrator-ready implementation plan (based on architect-review-raw.md)

This plan converts the findings in `architect-review-raw.md` (same directory) into **explicit, subagent-executable tasks** with **architect + QA approval gates**.

## Goal

Make Deep Research Option C **ready for real research runs** by:

1) Enforcing a **no-env-var operator contract** (single CLI surface; no reliance on ambient env).
2) Extending the **task-driver (prompt-out + agent-result)** pattern beyond Wave 1 to:
   - Wave 2
   - Summaries
   - Synthesis
3) Making long-running runs safe via **bounded ticks, resumability, and deterministic state**.
4) Making citations configuration **explicit and reproducible** without env-based endpoints.

## Hard constraints (bind all tasks)

- Do **not** propose or implement changes to OpenCode itself.
- All changes must be contained to this repo’s `.opencode/` toolchain, plans, tests, and runtime skill source equivalents (as appropriate).
- Every task must include a **Validation Contract** with commands/files that prove completion.
- Completion requires **Architect approval** and **QA approval** as explicit gates.

## Working definitions (for subagents)

- **Operator CLI (canonical surface)**: `.opencode/pai-tools/deep-research-option-c.ts`
- **Deep research tools**: `.opencode/tools/deep_research_cli/*`
- **Run root**: directory containing `manifest.json` and `gates.json` created by `run_init`.
- **Task-driver loop**: CLI writes prompts to `operator/prompts/<stage>/<id>.md`, halts with `RUN_AGENT_REQUIRED`, and later ingests results via `agent-result` writing canonical artifacts under run root.

## Milestones & gates

### M0 — Alignment (must pass before any code work)

- **Architect Gate A0 (Design sign-off)**: Architect confirms the updated CLI contract and config precedence rules.

### M1 — No-env operator contract

- Deliverable: Option C can be initialized/resumed/run via CLI using only **flags + run artifacts**, no env var requirements.
- **QA Gate Q1 (CLI contract)**: QA runs entity tests + a smoke run without env dependencies.

### M2 — Real Wave 2 via task-driver

- Deliverable: Wave 2 is no longer synthetic; it prompt-outs gap tasks and ingests results deterministically.
- **QA Gate Q2 (Wave2 task-driver)**: QA confirms Wave 2 end-to-end via tests.

### M3 — Real summaries + synthesis via task-driver

- Deliverable: Summaries and synthesis are produced through an agent seam (prompt-out + ingest) with deterministic gating.
- **QA Gate Q3 (Finalize path)**: QA confirms a full run can reach finalize under task-driver.

### M4 — Long-run safety + citations reproducibility

- Deliverable: Long latency stages do not fail spuriously; citations endpoints are explicit without env.
- **Architect Gate A4 (Operational readiness)** + **QA Gate Q4 (1h-run simulation plan)**.

---

## Dependency DAG (high-level)

- **WS0 (CLI/Docs alignment)** must precede everything.
- **WS1 (No-env contract)** must precede Wave2/Summaries/Synthesis task-drivers.
- **WS2 (Wave2 task-driver)** and **WS3 (Summaries/Synthesis task-driver)** can be built in parallel after WS1.
- **WS4 (Citations precedence + long-run safety)** can run in parallel with WS2/WS3 but must finish before “ready” sign-off.
- **WS5 (Skills/workflows)** can run in parallel but should be finalized after CLI contract is stable.

---

## Workstreams & explicit tasks

Each task is written so an Engineer subagent can execute it without extra context.

### WS0 — Single canonical operator surface + doc alignment

#### Task WS0-T1 — Canonical CLI path everywhere

**Problem:** Docs and skill references are inconsistent about whether the CLI path is `pai-tools/...` vs `.opencode/pai-tools/...`.

**Context / evidence:**
- CLI exists at `.opencode/pai-tools/deep-research-option-c.ts`.
- `/deep-research` doc currently references `bun ".opencode/pai-tools/deep-research-option-c.ts" ...`.

**Builder (Engineer) responsibilities:**
- Update `.opencode/commands/deep-research.md` to use the canonical path:
  - `bun ".opencode/pai-tools/deep-research-option-c.ts" ...`
- Update any repo-local skill docs under `.opencode/skills/*` that reference the old path.

**Validator (QATester) responsibilities:**
- Ensure command doc examples are copy/paste runnable from repo root.

**Validation Contract:**
1) `rg "pai-tools/deep-research-option-c\.ts" .opencode/commands .opencode/skills -n` returns only canonical `.opencode/pai-tools/...` references.
2) `bun test .opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts` passes.

**Exit criteria:** All docs reference the same CLI invocation.

---

### WS1 — No-env operator contract (remove env reliance)

#### Task WS1-T1 — Replace env enablement gating with run-authored enablement

**Problem:** Tools/CLI require `PAI_DR_OPTION_C_ENABLED` (env) for Option C to run; this breaks LLM-driven execution where environment is not shared.

**Context / evidence:**
- `run_init` checks flags and returns DISABLED unless enabled.
- `stage_advance` previously relied on env enablement; now consults per-run manifest constraint.
- Feature-flag resolution is settings-only (env unsupported).

**Design requirement:**
- The *run* must carry enablement state in persisted artifacts (manifest/run-config), not env.

**Builder (Engineer) responsibilities:**
- Introduce a manifest/run-config field that indicates Option C is enabled for this run (example shape, adapt as appropriate):
  - `manifest.query.constraints.deep_research_flags.option_c_enabled: true`
- Update `run_init` and `stage_advance` to consult only persisted run state (manifest/run-config), not env.
- Update CLI `init` to always write the enablement field into the manifest it creates.

**Validator (QATester) responsibilities:**
- Confirm that running the CLI without `PAI_DR_OPTION_C_ENABLED` still works (init + status).

**Validation Contract:**
1) `bun test .opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts` passes with no env enablement.
2) A minimal manual run:
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" init "Q" --run-id dr_no_env_001 --json`
   - assert stdout JSON is parseable and `stage_current == "wave1"`.

**Exit criteria:** CLI + tools operate without env enablement requirements.

#### Task WS1-T2 — Add `--runs-root` flag and remove env dependency for `--run-id` resolution

**Problem:** `--run-id` lookup currently depends on `PAI_DR_RUNS_ROOT` from env/settings.

**Builder (Engineer) responsibilities:**
- Add `--runs-root <abs>` to CLI commands that accept `--run-id`.
- Ensure `resolveRunHandle()` prefers explicit `--runs-root` when resolving run-id.
- Ensure `init` can set the run root deterministically from `--runs-root` (and prints it).

**Validator (QATester) responsibilities:**
- Add/adjust tests to ensure `--runs-root` works and env is not required.

**Validation Contract:**
1) New/updated entity test proves: init + status + tick work with `--runs-root` and no env.
2) `bun test .opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts` passes.

**Exit criteria:** Run-id-based resume is possible without env.

#### Task WS1-T3 — Remove env from citations endpoint/config precedence

**Problem:** Citations endpoint config resolution includes env as a source, which violates the no-env contract.

**Builder (Engineer) responsibilities:**
- Update citations config precedence to:
  1) manifest
  2) run-config
  3) explicit CLI args
  4) (never) env
- Ensure `run-config.json` is always written on `init` and contains the effective citations mode/endpoints.

**Validator (QATester) responsibilities:**
- Add a test that fails if env endpoints are used when run-config specifies something else.

**Validation Contract:**
1) `bun test .opencode/tests/entities/deep_research_citations_validate.test.ts` (and related citations tests) pass.
2) A targeted test ensures env vars do not affect resolution.

**Exit criteria:** Citations are reproducible based on run artifacts, not env.

#### Task WS1-T4 — Add `--json` output to all CLI commands

**Problem:** Only some commands offer machine-readable output; LLM operator UX improves dramatically with a stable JSON envelope.

**Builder (Engineer) responsibilities:**
- Add `--json` to: `init`, `tick`, `run`, `pause`, `resume`, `cancel`, `agent-result`, `capture-fixtures`.
- Ensure `--json` prints exactly one JSON object to stdout.

**Validator (QATester) responsibilities:**
- Add an entity test that runs each command with `--json` and validates required keys exist.

**Validation Contract:**
1) `bun test .opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts` passes.
2) New test: parse JSON for each command and assert required keys.

**Exit criteria:** CLI is LLM-safe for programmatic parsing.

✅ **Architect Gate A0 (after WS0+WS1):** Architect reviews the final CLI contract and precedence rules.

✅ **QA Gate Q1 (after WS0+WS1):** QA runs entity tests + a minimal no-env init/tick.

---

### WS2 — Wave 2 task-driver (real research seam)

#### Task WS2-T1 — Add Wave 2 prompt-out + agent-result ingestion contract

**Problem:** Wave 2 is currently synthetic (placeholder markdown, example URLs) and not agent-driven.

**Builder (Engineer) responsibilities:**
- Implement a Wave 2 “task-driver” flow mirroring Wave 1:
  - deterministically generate wave2 prompt(s) from pivot gaps
  - write prompts to `operator/prompts/wave2/<gap_id>.md`
  - halt with `RUN_AGENT_REQUIRED` listing missing gaps
  - extend CLI `agent-result` to accept `--stage wave2`
  - ingest into `wave-2/<gap_id>.md` plus `wave-2/<gap_id>.meta.json` containing prompt digest and provenance
- Ensure Wave 2 outputs are validated via `wave_output_validate` using a wave2 perspectives doc (or an equivalent contract doc).

**Validator (QATester) responsibilities:**
- Add entity test that:
  1) seeds a pivot requiring wave2
  2) runs `tick --driver task` and sees prompt-out + halt
  3) ingests one gap via `agent-result --stage wave2`
  4) resumes until `stage.current=citations`

**Validation Contract:**
1) New entity test passes (Wave2 task-driver).
2) No placeholder/example URLs are emitted by default wave2 content.

**Exit criteria:** Wave2 is a real agent seam with deterministic ingestion.

✅ **QA Gate Q2:** Wave2 task-driver test + a small smoke run through wave2.

---

### WS3 — Summaries + synthesis task-driver (real research seam)

#### Task WS3-T1 — Summaries prompt-out + agent-result ingestion

**Problem:** Summary generation is currently deterministic templating unless fixtures are provided.

**Builder (Engineer) responsibilities:**
- Implement summaries stage as prompt-out tasks:
  - one summary per perspective
  - prompts written to `operator/prompts/summaries/<perspective_id>.md`
  - results ingested to `summaries/<perspective_id>.md` plus meta sidecar
  - `summary-pack.json` built from ingested summaries (bounded by caps)
- Ensure Gate D evaluation still applies.

**Validator (QATester) responsibilities:**
- Add entity test: summaries stage halts until all summary artifacts ingested, then progresses to synthesis.

**Validation Contract:**
1) New entity test passes (summaries task-driver).
2) `summary-pack.json` is created and references the ingested summary artifacts.

#### Task WS3-T2 — Synthesis prompt-out + agent-result ingestion

**Problem:** Synthesis generation is deterministic templating unless fixtures are provided.

**Builder (Engineer) responsibilities:**
- Implement synthesis stage as prompt-out:
  - write synthesis prompt to `operator/prompts/synthesis/final-synthesis.md`
  - halt until `agent-result --stage synthesis` ingests it
  - validate required headings + citation syntax against validated citations pool
  - write canonical `synthesis/final-synthesis.md` + meta

**Validator (QATester) responsibilities:**
- Add entity test: synthesis stage halts until ingested, then progresses to review.

**Validation Contract:**
1) New entity test passes (synthesis task-driver).
2) Gate E can evaluate the ingested synthesis (existing Gate E tests remain green).

✅ **QA Gate Q3:** A full task-driver run can reach `finalize` (fixture citations allowed if needed).

---

### WS4 — Long-run safety + resumability hardening

#### Task WS4-T1 — Enforce “one unit of progress per tick” for long latency stages

**Problem:** Single ticks can do too much work and become non-resumable mid-flight.

**Builder (Engineer) responsibilities:**
- Ensure tick driver behavior is chunked:
  - wave1: prompt-out until ingested (already)
  - wave2: prompt-out until ingested (new)
  - summaries: prompt-out until ingested (new)
  - synthesis: prompt-out until ingested (new)
- Ensure each tick writes `manifest.stage.last_progress_at` before returning.

**Validator (QATester) responsibilities:**
- Add a test asserting ticks do not advance without producing either:
  - stage advancement, or
  - a halt artifact.

**Validation Contract:**
1) TickUntilStop behavior remains consistent and produces halts.
2) `deep_research_operator_halt_artifacts.test.ts` (if present) passes; otherwise add equivalent test.

#### Task WS4-T2 — Watchdog semantics for task-driver stages

**Problem:** Stage-based timeouts can fail runs even when waiting on external agent results.

**Builder (Engineer) responsibilities:**
- Define and implement watchdog policy:
  - In task-driver halt state, watchdog should not mark the run failed.
  - Option: treat `RUN_AGENT_REQUIRED` halts as “operator waiting” checkpoints that refresh `last_progress_at`.

**Validator (QATester) responsibilities:**
- Add a deterministic test that simulates waiting beyond timeout while halted and asserts the run is not failed.

**Validation Contract:**
1) `deep_research_watchdog_timeout.test.ts` still passes.
2) New test passes for “halted waiting does not timeout”.

✅ **Architect Gate A4:** Architect reviews operational semantics (timeouts, locks, pause/resume).

✅ **QA Gate Q4:** QA validates a simulated long-wait flow and confirms no spurious failures.

---

### WS5 — Skill readiness (operator workflows)

#### Task WS5-T1 — Add perspective confirmation + research stub workflow

**Problem:** Operator needs explicit steps to define/refine/confirm perspectives, and to persist a resumable “research stub”.

**Builder (Engineer or Writer) responsibilities:**
- Update runtime-facing skill docs (source-of-truth in repo if applicable) to include:
  - DefineResearchStub
  - GeneratePerspectivesThenConfirm
  - RefinePerspectives
  - RunWave1WithTaskDriver
  - (later) RunWave2WithTaskDriver, ProduceSummariesAndSynthesis
- Each workflow must include:
  - required inputs
  - exact CLI commands
  - validation contract (file existence + stage/status checks)

**Validator (QATester) responsibilities:**
- Spot-check that commands match actual CLI flags and work under no-env assumptions.

**Validation Contract:**
1) `rg` across skill docs shows canonical CLI path.
2) Workflows include explicit validation steps.

---

## Approvals (completion gates)

Completion requires both:

### Architect approval checklist

- [ ] CLI contract is coherent: one canonical path, consistent flags, no-env assumptions.
- [ ] Config precedence is documented and matches implementation.
- [ ] Task-driver semantics are consistent across wave1/wave2/summaries/synthesis.
- [ ] Long-run policy is clear (watchdog + halt semantics).

### QA approval checklist

- [ ] All entity tests pass: `bun test .opencode/tests/entities`.
- [ ] All smoke tests pass: `bun test .opencode/tests/smoke`.
- [ ] Wave2 task-driver tests pass.
- [ ] Summaries + synthesis task-driver tests pass.
- [ ] No-env run can be initialized and advanced via CLI.

---

## Suggested execution order (orchestrator-friendly)

1) WS0-T1
2) WS1-T1, WS1-T2, WS1-T3, WS1-T4 (parallel where safe)
3) **Architect Gate A0**, then **QA Gate Q1**
4) WS2-T1 and WS3-T1/WS3-T2 (parallel after Q1)
5) **QA Gate Q2**, then **QA Gate Q3**
6) WS4-T1 and WS4-T2
7) **Architect Gate A4**, then **QA Gate Q4**
8) WS5-T1
