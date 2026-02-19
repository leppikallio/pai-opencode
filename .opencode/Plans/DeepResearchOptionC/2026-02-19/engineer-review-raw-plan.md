# Deep Research Option C — Orchestrator-Ready Execution Plan (Engineer)

Date: 2026-02-19  
Repo: `/Users/zuul/Projects/pai-opencode-graphviz` (branch: `graphviz`)  
Based on: `./engineer-review-raw.md`

This is a **step-by-step, subagent-ready implementation plan** to make Option C pleasant, efficient, and iteration-friendly for real research. It is written for capable engineers who **lack project context**, so each task includes a mini-primer, exact repo paths, explicit inputs/outputs, and a verification contract.

Hard constraints:
- Do **not** change OpenCode itself. All changes must be in this repo’s Option C tooling/docs/tests.
- Completion requires **Architect approval** and **QA approval** gates.

---

## 0) Context primer (read once)

### What Option C is (in this repo)

Option C is a **deterministic research run pipeline** driven by:

1) A **run directory** (created by tool `deep_research_run_init` in `.opencode/tools/deep_research/run_init.ts`) containing:
   - `manifest.json` (schema `manifest.v1`)
   - `gates.json` (schema `gates.v1`)
   - stage artifact folders: `wave-1/`, `wave-2/`, `citations/`, `summaries/`, `synthesis/`, `logs/`

2) Deterministic stage transitions (`deep_research_stage_advance` in `.opencode/tools/deep_research/stage_advance.ts`).

3) Orchestrator “ticks” that run the deterministic work:
   - Wave1 (init/wave1 → pivot): `.opencode/tools/deep_research/orchestrator_tick_live.ts`
   - Post-pivot (pivot/wave2/citations → summaries): `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts`
   - Post-summaries (summaries/synthesis/review → finalize): `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts`

4) The operator CLI (typed, stable commands) at:
   - `.opencode/pai-tools/deep-research-option-c.ts`
   - The `/deep-research` command doc routes to this CLI:
     - `.opencode/commands/deep-research.md`

### Key artifacts + contracts

- Wave1 plan: `<run_root>/wave-1/wave1-plan.json` produced by tool `deep_research_wave1_plan` (`.opencode/tools/deep_research/wave1_plan.ts`).
- Wave outputs: `<run_root>/wave-1/<perspective_id>.md` validated by `deep_research_wave_output_validate` (`.opencode/tools/deep_research/wave_output_validate.ts`).
- Wave review: `<run_root>/wave-review.json` produced by `deep_research_wave_review` (`.opencode/tools/deep_research/wave_review.ts`).
- Retry directives: `<run_root>/retry/retry-directives.json` written by the live wave1 orchestrator when contract validation fails.
- Citations:
  - Extract URLs: `deep_research_citations_extract_urls` (`.opencode/tools/deep_research/citations_extract_urls.ts`)
  - Normalize: `deep_research_citations_normalize`
  - Validate: `deep_research_citations_validate` (`.opencode/tools/deep_research/citations_validate.ts`)
  - Online reproducibility artifacts (online mode):
    - `<run_root>/citations/online-fixtures.<ts>.json`
    - `<run_root>/citations/online-fixtures.latest.json`
    - `<run_root>/citations/blocked-urls.json`

### Existing acceptance tests (do not break)

- M2 canary (wave1 → pivot): `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
- M3 canary (full finalize): `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`
- Stage-machine fixture finalize tests: `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`

---

## 1) Orchestration model for this plan

### Roles / subagents

- **Engineer subagents (builders)**: implement tasks exactly as specified.
- **Architect (approver)**: reviews interface/artifact/schema design and rejects unclear UX or unstable contracts.
- **QATester (approver)**: runs acceptance tests/canaries and signs off only with artifact evidence.

### Execution pattern

- Use a **dependency-ordered workstream plan** (below).
- Within a workstream, use **Builder → Validator** discipline:
  - Builder (Engineer) implements, runs local checks.
  - Validator (QA or second Engineer) verifies via tests and artifact inspection.

### Progress tracking (required; session-resilient)

**Purpose**: if the chat/session breaks mid-implementation, anyone can reopen *this file* and immediately see what is done vs remaining.

**Rule**: After completing any task below, the responsible engineer must:
1) Update the **Progress Ledger** row for that task (status + evidence link/command).
2) Paste the most important verification output snippet into the row (or a file path to it).
3) If the task introduces a new operator artifact, add it to the “Artifacts introduced” column.

**Statuses (use exactly these tokens)**:
- `TODO`
- `IN_PROGRESS`
- `DONE`
- `ARCH_APPROVED`
- `QA_APPROVED`
- `BLOCKED(<reason>)`

#### Architect preflight decisions (must be recorded early)

Before implementing WS-B and beyond, the Architect must decide (and record in the ledger) the stable contracts:
- **D-01**: Scope artifact format and required fields (`operator/scope.md` vs `operator/scope.json`).
- **D-02**: Gate A evaluator timing and checks.
- **D-03**: Halt artifact schema and stable location.
- **D-04**: `--driver task` loop contract (prompt/output paths + `agent-result` CLI args).

> Until these are decided, engineers may implement WS-A scaffolding, but should mark dependent tasks as `BLOCKED(D-xx)`.

#### Progress Ledger (update this table during execution)

| Item | Type | Owner | Status | Evidence (command/output/path) | Artifacts introduced | Notes |
|---|---|---|---|---|---|---|
| D-01 | Decision | Architect | DONE | See “Architect decision record” below |  | Canonical scope is `operator/scope.json` (scope.v1) |
| D-02 | Decision | Architect | DONE | See “Architect decision record” below |  | Gate A runs in `orchestrator_tick_live` pre-agent |
| D-03 | Decision | Architect | DONE | See “Architect decision record” below |  | Halt artifacts `tick-####.json` + `latest.json` |
| D-04 | Decision | Architect | DONE | See “Architect decision record” below |  | Prompts in `operator/prompts/wave1/`; outputs in `wave-1/` |
| A1 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_run_init.test.ts` (pass) | `operator/scope.json` | Implemented in `.opencode/tools/deep_research/run_init.ts`; scope_path pointer only |
| A2 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_wave1_plan.test.ts` (pass) | `wave1-plan.json` prompt_md has Scope Contract | Implemented in `.opencode/tools/deep_research/wave1_plan.ts` + `wave_tools_shared.ts` |
| A3 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_gate_a_evaluate.test.ts` (pass) | `gates.A` computed | Tool: `.opencode/tools/deep_research/gate_a_evaluate.ts`; wired into `orchestrator_tick_live.ts` |
| B1 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts` (pass) | `wave-1/*.meta.json` digests enforced | Skip only when md+meta exist and digest matches current plan prompt |
| C1 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_operator_halt_artifacts.test.ts` (pass) | `operator/halt/latest.json` | CLI writes `halt.v1` on tick/run failure |
| D1 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts` (pass) | `retry/retry-directives.json` | CLI `rerun wave1` writes one retry directive, consumed_at=null |
| D2 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_operator_cli_task_driver.test.ts` (pass) | `operator/prompts/wave1/*.md` + `agent-result` | `tick --driver task` emits RUN_AGENT_REQUIRED + halt.v1 next_commands |
| E1 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_orchestrator_tick_post_pivot_online_fixtures_latest.test.ts` (pass) | `citations/online-fixtures.latest.json` replay | Orchestrator passes `online_fixtures_path` when latest exists |
| E2 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_citations_validate_blocked_queue.test.ts` (pass) | `citations/blocked-urls.queue.md` | Deterministic markdown queue emitted when blocked urls exist |
| F1 | Task | Eng | DONE | `bun test ./.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts` (pass) | `--json` outputs | `status|inspect|triage --json` emit single JSON object |
| G1 | Task | Eng/QA | DONE | `bun test ./.opencode/tests` (174 pass, 1 skip, 0 fail) | test suite coverage | New tests for Gate A, halt artifacts, task driver, citations queue, fixtures replay |
| G2 | Task | QA | DONE | `bun test ./.opencode/tests/smoke/deep_research_citations_repro_canary.test.ts` (pass) | `online-fixtures.latest.json` replay | Canary asserts byte-identical `citations.jsonl` on replay |
| ARCH | Gate | Architect | ARCH_APPROVED | Architect gate re-check: PASS after sidecar unification |  | Contracts D-01..D-04 consistent; meta sidecar clobbering prevented |
| QA | Gate | QA | QA_APPROVED | `bun test ./.opencode/tests` (174 pass, 1 skip, 0 fail) |  | Smoke + entity coverage added; reproducibility canary is deterministic |

### Definition of “DONE” for the whole project

All of these must be true:
1) Architect approval gate is PASSED (see Gate ARCH).
2) QA approval gate is PASSED (see Gate QA).
3) M2 + M3 smoke tests pass.
4) New acceptance tests introduced by this plan pass (M4 citations canary, plus unit tests for new behavior).
5) Operator UX is stable: commands are typed, deterministic, and produce actionable triage outputs.

### Stop points (safe to pause the session)

If execution pauses, it should pause only at one of these checkpoints, with the ledger updated:
- After WS-A complete (A1–A3) and D-01..D-04 are decided.
- After WS-B + WS-C complete (B1, C1) and M2 smoke still passes.
- After WS-D complete (D1–D2) and partial rerun / driver loop test passes.
- After WS-E complete (E1–E2) and citations artifacts are stable.
- After WS-F complete (F1) and `--json` outputs are validated.
- After WS-G complete (G1–G2) and full test suite passes.

### Architect decision record (2026-02-19; stable contracts)

These decisions are **contract locks**. Changing them later requires Architect re-approval.

| Decision ID | Final choice |
|---|---|
| D-01 | Canonical scope artifact is **`<run_root>/operator/scope.json`** with schema `scope.v1`. Do **not** keep a second authoritative scope copy in `manifest.json` (if needed, store only `manifest.query.constraints.scope_path = "operator/scope.json"`). |
| D-02 | Gate A runs in **`orchestrator_tick_live`** on every tick **before any Wave1 agent execution**, after ensuring `wave-1/wave1-plan.json` exists. Gate A checks: scope.json exists + validates required fields; `perspectives.json` validates `perspectives.v1`; perspectives count <= `manifest.limits.max_wave1_agents`; `wave1-plan.json` exists and entries length + IDs match perspectives **in the same order**; every plan `prompt_md` contains heading `## Scope Contract`. |
| D-03 | Halt artifacts live under **`<run_root>/operator/halt/`**: `tick-####.json` (zero-padded) and `latest.json`. Schema `halt.v1`: `created_at`, `run_id`, `run_root`, `tick_index`, `stage_current`, `blocked_transition`, `error{code,message}`, `blockers{missing_artifacts[],blocked_gates[],failed_checks[]}`, `related_paths{manifest_path,gates_path,retry_directives_path?,blocked_urls_path?,online_fixtures_latest_path?}`, `next_commands[]`, `notes`. |
| D-04 | Driver=task loop: `tick --driver task` writes prompts to **`<run_root>/operator/prompts/wave1/<perspective_id>.md`** and exits with typed agent-required condition (recommended `error.code="RUN_AGENT_REQUIRED"`). Outputs are canonical in **`<run_root>/wave-1/<perspective_id>.md`** with sidecar **`<run_root>/wave-1/<perspective_id>.meta.json`**. `agent-result` computes `prompt_digest` from `wave1-plan.json` and writes both. |

---

## 2) Workstreams and dependency order

P0 = must land first; P1/P2 can be parallel after P0’s interfaces stabilize.

### Workstream WS-A (P0): Scope alignment + Gate A planning completeness
Dependencies: none.

### Workstream WS-B (P0): Digest-aware wave output caching (prevent stale skips)
Dependencies: WS-A (because scope → prompt changes must not silently reuse outputs).

### Workstream WS-C (P0/P1): “Blocked? Do this next.” typed halt artifacts + operator triage ergonomics
Dependencies: WS-B (so halt artifacts can reference new caching semantics).

### Workstream WS-D (P1): Partial reruns + driver improvements (task-backed seam / non-manual loop)
Dependencies: WS-C (needs halt artifacts/triage conventions).

### Workstream WS-E (P1): Citations reproducibility defaults + blocked-citation queue
Dependencies: WS-C (use same triage/halt conventions).

### Workstream WS-F (P2): Observability + scripting (JSON mode, tail commands, lock UX)
Dependencies: WS-C (shared error/halt semantics).

### Workstream WS-G (QA): Acceptance tests + canary runbooks
Dependencies: WS-A..WS-F as appropriate; can start early by scaffolding tests.

---

## 3) Task template (used below)

Each task is written so a subagent can execute without additional context.

**Task fields**
- **ID / Priority / Workstream**
- **Owner** (Engineer)
- **Reviewers** (Architect, QA)
- **Goal** (one sentence)
- **Context / Why** (2–6 bullets)
- **Files to modify** (explicit list)
- **New/updated artifacts** (paths under run root if applicable)
- **Implementation steps** (ordered)
- **Verification contract** (commands + what “pass” looks like)
- **Acceptance criteria** (binary)

---

## 4) Workstream WS-A (P0): Scope alignment + Gate A

### Task A1 (P0) — Add a durable scope contract artifact

- **ID**: A1
- **Priority**: P0
- **Workstream**: WS-A
- **Owner**: Engineer
- **Reviewers**: Architect

**Goal**: Persist an explicit **canonical scope contract** as JSON (`operator/scope.json`) that can be included in every Wave1 prompt.

**Context / Why**
- Today, scope is implicit in `query` + `perspectives.json`. This causes late retries and researcher thrash.
- `run_init` already writes `manifest.query.constraints.deep_research_flags` in `.opencode/tools/deep_research/run_init.ts`.

**Files to modify**
- `.opencode/tools/deep_research/run_init.ts`
- (Optional) `.opencode/tools/deep_research/schema_v1.ts` (only if schema validation must be tightened; prefer a local scope validator)

**New/updated artifacts**
- `<run_root>/operator/scope.json` (canonical; single source of truth)
- (Optional pointer) `manifest.json`: `manifest.query.constraints.scope_path = "operator/scope.json"`

**Implementation steps**
1) In `run_init`, create `<run_root>/operator/scope.json` with schema `scope.v1`.
2) Required fields:
   - `schema_version: "scope.v1"`
   - `run_id: string`
   - `updated_at: ISO string`
   - `questions: string[]` (>= 1 item)
   - `non_goals: string[]`
   - `deliverable: string`
   - `time_budget_minutes: number` (integer, >= 1)
   - `depth: "quick" | "standard" | "deep"`
   - `citation_posture: "follow_manifest"`
   - optional: `notes?: string`, `assumptions?: string[]`
3) Serialize deterministically (stable key ordering; newline-terminated JSON).
4) (Optional) Add only a pointer to manifest: `manifest.query.constraints.scope_path = "operator/scope.json"`.

**Verification contract**
- Run smoke init path (either via tests or a minimal manual run):
  - `bun ".opencode/pai-tools/deep-research-option-c.ts" init "scope test" --mode standard --sensitivity no_web`
- PASS if run root contains:
  - `operator/scope.json` (valid JSON; required fields present)
  - (if used) `manifest.json` contains `query.constraints.scope_path: "operator/scope.json"`

**Acceptance criteria**
- On new runs, scope artifact exists and is non-empty.
- No existing tests break.

---

### Task A2 (P0) — Include scope contract in Wave1 prompts

- **ID**: A2
- **Priority**: P0
- **Workstream**: WS-A
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Ensure every `wave1_plan` entry `prompt_md` includes the scope contract content.

**Context / Why**
- Wave prompts are generated in `.opencode/tools/deep_research/wave1_plan.ts` via `buildWave1PromptMd(...)`.
- Without scope inclusion, perspective outputs will drift and retries increase.

**Files to modify**
- `.opencode/tools/deep_research/wave1_plan.ts`
- `.opencode/tools/deep_research/wave_tools_shared.ts` (if `buildWave1PromptMd` lives there)

**New/updated artifacts**
- `<run_root>/wave-1/wave1-plan.json` includes scope text inside each `prompt_md`.

**Implementation steps**
1) Read canonical scope from `<run_root>/operator/scope.json` during `wave1_plan` execution.
2) Render a stable prompt block under heading `## Scope Contract` with fixed ordering (do not dump raw JSON):
   - Questions (bulleted)
   - Non-goals (bulleted)
   - Deliverable
   - Time budget minutes
   - Depth
   - Citation posture
   - Notes/assumptions (if present)
3) Keep ordering stable so `inputs_digest` changes only when scope changes.
4) Update any fixture expectations that compare prompt text.

**Verification contract**
- Initialize run + write perspectives + run `deep_research_wave1_plan`.
- PASS if `wave1-plan.json` entries’ `prompt_md` contain `## Scope Contract`.

**Acceptance criteria**
- Wave1 plan generation remains deterministic (stable ordering).
- M2/M3 smoke tests still pass.

---

### Task A3 (P0) — Implement Gate A evaluator (planning completeness)

- **ID**: A3
- **Priority**: P0
- **Workstream**: WS-A
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Automatically set `gates.A.status=pass|fail` **on every live tick before Wave1 agents run**, based on presence/validity of planning artifacts.

**Context / Why**
- `gates.json` has Gate A defined but is not currently computed in a first-class deterministic tool.
- Early failure is cheaper than wave1 retries.

**Files to modify**
- Add new tool: `.opencode/tools/deep_research/gate_a_evaluate.ts` (recommended)
- Export from `.opencode/tools/deep_research/index.ts` so it becomes `deep_research_gate_a_evaluate` (ensure naming consistent with other tools)
- Update orchestrator tick path to call it:
  - `.opencode/tools/deep_research/orchestrator_tick_live.ts` (**every tick**, after ensuring `wave-1/wave1-plan.json` exists, **before** any `runAgent` calls)

**New/updated artifacts**
- `gates.json` Gate A updated with:
  - `checked_at`, `metrics`, `artifacts[]`, `notes`

**Implementation steps**
1) Define Gate A checks (match Architect contract D-02):
   - `<run_root>/operator/scope.json` exists and validates `scope.v1` required fields
   - `perspectives.json` exists and validates `perspectives.v1`
   - `perspectives.perspectives.length <= manifest.limits.max_wave1_agents`
   - `wave-1/wave1-plan.json` exists
   - `wave1-plan.json.entries.length === perspectives.length`
   - `wave1-plan.json.entries[i].perspective_id === perspectives.perspectives[i].id` for all i (same IDs in same order)
   - every `wave1-plan.json.entries[i].prompt_md` contains heading `## Scope Contract`
2) Tool emits `{ update, inputs_digest, status }` like other gate evaluators.
3) Call `gates_write` to persist the gate.

**Verification contract**
- Unit test: add `.opencode/tests/smoke` or `.opencode/tests/unit` coverage that:
  - creates a temp run
  - deletes scope or perspectives
  - asserts Gate A becomes fail with typed reason
- PASS if gate writes correct status.

**Acceptance criteria**
- Gate A is deterministically computed, not manually edited.

---

## 5) Workstream WS-B (P0): Digest-aware wave caching

### Task B1 (P0) — Skip wave1 rerun only when prompt digests match

- **ID**: B1
- **Priority**: P0
- **Workstream**: WS-B
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Prevent silent reuse of stale wave outputs by making caching **prompt-digest-aware**.

**Context / Why**
- `orchestrator_tick_live` currently considers `outputAlreadyExists` a reason to skip `runAgent`.
- It already writes `*.meta.json` sidecars with `prompt_digest`.

**Files to modify**
- `.opencode/tools/deep_research/orchestrator_tick_live.ts`

**New/updated artifacts**
- No new artifact type; reuse existing `*.meta.json` sidecar.

**Implementation steps**
1) For each planned wave1 entry:
   - Compute expected `prompt_digest = sha256(prompt_md)`.
2) If `<output>.md` exists, read `<output>.meta.json` (if present) and compare `prompt_digest`.
3) Only skip `runAgent` if meta digest matches; otherwise rerun and overwrite output + meta.
4) Ensure behavior when meta is missing: rerun (safe default).

**Verification contract**
- Add a unit test that:
  1) runs wave1 once producing output + meta
  2) modifies scope or prompt generation so expected digest changes
  3) reruns tick and asserts `runAgent` is invoked again (use a stub driver that counts calls)

**Acceptance criteria**
- No stale outputs are silently reused after prompt changes.
- M2/M3 smoke tests remain green.

---

## 6) Workstream WS-C (P0/P1): Typed halt artifacts + actionable triage

### Task C1 (P0) — Write a halt artifact on every tick failure

- **ID**: C1
- **Priority**: P0
- **Workstream**: WS-C
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: When `tick` fails, produce a single, durable “what failed + what next” artifact.

**Context / Why**
- CLI already computes stage-advance dry-run triage via `stageAdvanceDryRun()` and `triageFromStageAdvanceResult()` in `.opencode/pai-tools/deep-research-option-c.ts`.
- Operators lose time reconstructing next steps.

**Files to modify**
- `.opencode/pai-tools/deep-research-option-c.ts`

**New/updated artifacts**
- `<run_root>/operator/halt/tick-####.json` (zero-padded index)
- `<run_root>/operator/halt/latest.json` (copy of most recent)

**Implementation steps**
1) In `runTick()` and in the `run` loop when a tick fails:
   - compute triage (already done)
   - write halt JSON schema `halt.v1`:
     - `schema_version: "halt.v1"`
     - `created_at`, `run_id`, `run_root`, `tick_index`, `stage_current`
     - `blocked_transition: { from, to }`
     - `error: { code, message }`
     - `blockers: { missing_artifacts: [{name, path?}], blocked_gates: [{gate, status?}], failed_checks: [{kind, name}] }`
     - `related_paths: { manifest_path, gates_path, retry_directives_path?, blocked_urls_path?, online_fixtures_latest_path? }`
     - `next_commands: string[]`
     - `notes: string`
2) Ensure paths are contained under run root.
3) Always write both files: `tick-####.json` and `latest.json`.

**Verification contract**
- Add a test that triggers a known failure (e.g., missing perspectives) and asserts:
  - halt artifact exists
  - includes `missing_artifacts` and `next_commands`

**Acceptance criteria**
- Every tick failure leaves behind one actionable artifact.

---

## 7) Workstream WS-D (P1): Partial reruns + driver improvements

### Task D1 (P1) — Implement `rerun wave1 --perspective <id>` by writing retry directives

- **ID**: D1
- **Priority**: P1
- **Workstream**: WS-D
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Allow operators to rerun only one wave1 perspective without touching others.

**Context / Why**
- `orchestrator_tick_live` already consumes `retry/retry-directives.json` when `consumed_at` is null.
- It already has bounded retries via `retry_record`.

**Files to modify**
- `.opencode/pai-tools/deep-research-option-c.ts`

**New/updated artifacts**
- `<run_root>/retry/retry-directives.json`

**Implementation steps**
1) Add CLI subcommand:
   - `rerun wave1 --manifest <abs> --perspective <id> --reason "..."`
2) Command writes retry-directives.json with one directive:
   - `{ perspective_id, action: "retry", change_note: <reason> }`
   - `consumed_at: null`
3) Next `tick --driver live` should rerun only that perspective.

**Verification contract**
- Add test that:
  - creates run and wave1 outputs
  - writes directive for one perspective
  - runs `orchestrator_tick_live` with a driver that counts calls
  - asserts only targeted perspective is rerun

**Acceptance criteria**
- Partial rerun works and is bounded by existing retry caps.

---

### Task D2 (P1) — Add a non-manual “task driver” operator loop (CLI support)

- **ID**: D2
- **Priority**: P1
- **Workstream**: WS-D
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Provide a stable operator loop that does not require editing drafts, enabling Task-backed execution outside the CLI.

**Context / Why**
- The CLI’s current `--driver live` path is manual (`createOperatorInputDriver()` writes drafts and waits for ENTER).
- The orchestrator already expects `drivers.runAgent`; CLI cannot call `functions.task`, so the CLI must support a “prompt out / result in” workflow.

**Files to modify**
- `.opencode/pai-tools/deep-research-option-c.ts`
- `.opencode/commands/deep-research.md` (document the stable workflow)
- `.opencode/skills/deep-research-production/Workflows/RunWave1WithTaskDriver.md` (make it explicit)

**New/updated artifacts**
- `<run_root>/operator/prompts/wave1/<perspective>.md` (already used in manual path; reuse)
- `<run_root>/wave-1/<perspective_id>.md` (canonical output)
- `<run_root>/wave-1/<perspective_id>.meta.json` (canonical sidecar)

**Implementation steps**
1) Add CLI driver mode `--driver task` for `tick` (and optionally `run`):
   - It should **write prompts** for each planned perspective to `operator/prompts/wave1/<perspective_id>.md`.
   - It must then halt immediately with a typed condition (recommended `RUN_AGENT_REQUIRED`) and produce a `halt.v1` artifact with `next_commands[]` containing one `agent-result` skeleton per missing perspective.
2) Add CLI subcommand `agent-result`:
   - Inputs (stable contract):
     - `agent-result --manifest <ABS_MANIFEST> --stage wave1 --perspective <ID> --input <ABS_MD> --agent-run-id <STRING> --reason <TEXT> [--started-at <ISO>] [--finished-at <ISO>] [--model <STRING>]`
   - Behavior:
     - reads markdown from `--input`
     - loads `wave-1/wave1-plan.json` and finds entry for `<ID>`
     - computes `prompt_digest = sha256(prompt_md)`
     - writes `wave-1/<ID>.md`
     - writes `wave-1/<ID>.meta.json` with:
       - `schema_version: "wave-output-meta.v1"`
       - `prompt_digest`
       - `agent_run_id`
       - optional `started_at`, `finished_at`, `model`
       - `ingested_at` (ISO)
       - `source_input_path` (the `--input` path)
3) After all results are ingested, the next `tick --driver fixture` (or `tick --driver live` with a deterministic stub) should validate/review/advance.

**Verification contract**
- Add a test that:
  - runs `tick --driver task` and asserts prompts are written
  - feeds `agent-result` with fixture markdown
  - then runs a deterministic tick to reach pivot

**Acceptance criteria**
- No manual file editing is required to run wave1 with an external agent runner.

---

## 8) Workstream WS-E (P1): Citations reproducibility + blocked queue

### Task E1 (P1) — Default to replaying latest online fixtures when present

- **ID**: E1
- **Priority**: P1
- **Workstream**: WS-E
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Make citations stage reproducible by default in online mode.

**Context / Why**
- `citations_validate` can take `online_fixtures_path`.
- It already writes `<run_root>/citations/online-fixtures.latest.json`.

**Files to modify**
- `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts`

**Implementation steps**
1) In citations stage, before calling `citations_validate`, check for `citations/online-fixtures.latest.json`.
2) If present, load it and pass the referenced fixture path as `online_fixtures_path`.
3) Preserve ability to override via explicit CLI flag later (optional).

**Verification contract**
- Add unit test that:
  - seeds a run root with a synthetic `online-fixtures.latest.json` + fixture file
  - runs citations stage and asserts `citations_validate` used the fixture (e.g., via deterministic output)

**Acceptance criteria**
- Re-running citations uses recorded fixtures unless explicitly overridden.

---

### Task E2 (P1) — Blocked citations queue artifact

- **ID**: E2
- **Priority**: P1
- **Workstream**: WS-E
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Turn blocked citations into an operator-friendly work queue.

**Context / Why**
- `citations_validate.ts` writes `citations/blocked-urls.json` with action hints.

**Files to modify**
- `.opencode/tools/deep_research/citations_validate.ts` (or a small post-processor tool)

**New/updated artifacts**
- `<run_root>/citations/blocked-urls.queue.md`

**Verification contract**
- Add a test that forces a blocked status (can be via online dry-run mode) and asserts queue markdown is written.

**Acceptance criteria**
- Operators can resolve blocked citations without re-reading JSON.

---

## 9) Workstream WS-F (P2): Observability + scripting

### Task F1 (P2) — `--json` output mode for status/inspect/triage

- **ID**: F1
- **Priority**: P2
- **Workstream**: WS-F
- **Owner**: Engineer
- **Reviewers**: Architect, QA

**Goal**: Provide stable machine-readable output without scraping logs.

**Files to modify**
- `.opencode/pai-tools/deep-research-option-c.ts`

**Implementation steps**
1) Add `--json` boolean flag to `status`, `inspect`, `triage`.
2) When set, print exactly one JSON object and exit 0.

**Acceptance criteria**
- JSON output contains required contract fields plus gate/blocker summaries.

---

## 10) Workstream WS-G (QA): Acceptance tests and evidence runs

### Task G1 (P0) — Update/extend tests for new behaviors

- **ID**: G1
- **Priority**: P0 (QA work can start early)
- **Workstream**: WS-G
- **Owner**: Engineer (tests) + QA (validation)
- **Reviewers**: QA

**Goal**: Add deterministic tests for scope contract, digest-aware caching, and halt artifacts.

**Files to modify**
- `.opencode/tests/smoke/*` or a new `.opencode/tests/unit/*` suite

**Verification contract**
- Run: `bun test ./.opencode/tests`
- PASS: all tests green.

---

### Task G2 (P1) — New M4 canary: citations online reproducibility

- **ID**: G2
- **Priority**: P1
- **Workstream**: WS-G
- **Owner**: QA
- **Reviewers**: Architect

**Goal**: Prove online citations produce fixtures and replay deterministically.

**Implementation steps**
1) Create a smoke test that:
   - seeds a run with a small set of stable public URLs in wave outputs
   - runs citations in online mode (may use online dry-run if endpoints aren’t configured in CI)
   - asserts `citations/online-fixtures.latest.json` is produced
   - reruns citations with `online_fixtures_path` and asserts `citations.jsonl` content is identical

---

## 11) Approval gates

### Gate ARCH — Architect approval (required)

Architect must approve these artifacts/decisions:
- Scope contract format: `operator/scope.md` vs JSON; required fields and stability rules.
- Gate A evaluator contract and what constitutes “planning completeness”.
- `--driver task` loop contract (`agent-result` inputs/outputs and file locations).
- Halt artifact schema: fields and stability guarantees.

Evidence required:
- Link to diff summary (PR or patch list).
- Example run root tree showing new artifacts.
- A short markdown describing backward compatibility (what breaks? what doesn’t?).

### Gate QA — QA approval (required)

QA must run and attach evidence for:
- `bun test ./.opencode/tests` (full suite)
- M2 smoke: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
- M3 smoke: `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`
- New tests: scope, digest caching, halt artifact presence
- M4 citations reproducibility canary (or documented skip condition if endpoints unavailable, plus offline fixture replay evidence)

---

## 12) Execution order (operator view)

Recommended merge order:
1) A1 → A2 → A3
2) B1
3) C1
4) D1 → D2
5) E1 → E2
6) F1
7) G1 → G2
8) Gate ARCH approval
9) Gate QA approval

---

## 13) Notes to subagent engineers (common pitfalls)

- **Do not introduce hidden env var dependencies.** Prefer CLI flags + run-root artifacts.
- **Always keep paths run-root-contained** (many tools already enforce this; follow patterns in orchestrators).
- **Do not break determinism**: maintain stable ordering and explicit digests.
- **Update tests as you change behavior**; this repo relies heavily on smoke tests as correctness proof.
