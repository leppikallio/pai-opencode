# Deep Research Option C — Operator Pipeline Plan (v1, superseded)

Date: 2026-02-16

⚠️ **Superseded:** see `00-operator-pipeline-plan-v2.md` in this same directory.

This document answers two questions in a single, unambiguous way:

1) **Where are we right now?** (implemented vs missing)
2) **What are the concrete next steps to reach the target picture?**

It is intentionally written to be placed under **independent review** (Architect, QA, engineer-deep).

---

## 0) Executive summary (non-negotiable clarity)

### What Phase 00–07 built
We implemented an **artifact-first, deterministic deep research platform** as a set of OpenCode extension-surface tools:

- All core state is on disk: `manifest.json`, `gates.json`, `logs/audit.jsonl`, stage directories.
- Stage transitions are a deterministic state machine: `deep_research_stage_advance`.
- Each pipeline step is isolatable and testable via fixtures/entity contract tests.

Phase 07 (Gate F) specifically hardened **rollout safety**, caps, fallback, and operational drill evidence.

### What Phase 00–07 did *not* automatically guarantee
We do **not yet** have the full “product UX” layer that operators expect:

> **One command** that (a) chooses perspectives, (b) spawns research agents, (c) writes wave outputs into the run root, and (d) advances the entire run to `finalize`.

This is not a contradiction—it's an explicit design choice in the plan:

- Tools are deterministic and must **not** spawn agents (they validate/plan/write artifacts).
- Commands/orchestrator logic is where agent spawning happens.

---

## 1) Target picture (what “robust pipeline like OpenAI deep research” means here)

The target system must support **both** of these at the same time:

1) **Full pipeline runs** (end-to-end), including:
   - perspective selection
   - wave fan-out (agent execution)
   - validation + retries
   - pivot decision + optional wave 2
   - citations + summaries + synthesis + review loop
   - finalize with a reproducible run-root and a final answer

2) **Step isolation** (no full reruns required), meaning:
   - every step has a deterministic tool contract
   - fixtures can simulate upstream steps
   - we can refine one step (e.g., citation validator) without re-running all waves

This matches the core Option C invariants:
- artifact-first
- bounded synthesis inputs
- hard gates block progression
- entity tests + fixtures

---

## 2) Current implemented surfaces (what you can actually call today)

### 2.1 Tools (artifact-first building blocks)
Canonical export list:
- `.opencode/tools/deep_research/index.ts`

Highlights (not exhaustive):

**Run lifecycle / state machine**
- `deep_research_run_init`
- `deep_research_manifest_write`
- `deep_research_gates_write`
- `deep_research_stage_advance`
- `deep_research_watchdog_check`
- `deep_research_retry_record`

**Wave planning + validation (deterministic; no agent spawning)**
- `deep_research_perspectives_write`
- `deep_research_wave1_plan`
- `deep_research_wave_output_validate`
- `deep_research_wave_review`
- `deep_research_pivot_decide`

**Citations / summaries / synthesis / review factory**
- citations extract/normalize/validate/render + gate computations
- `deep_research_summary_pack_build`
- `deep_research_synthesis_write`
- `deep_research_gate_d_evaluate`
- `deep_research_gate_e_evaluate`
- `deep_research_gate_e_reports`
- `deep_research_review_factory_run`
- `deep_research_revision_control`

**Offline harness**
- `deep_research_dry_run_seed`
- `deep_research_fixture_bundle_capture`
- `deep_research_fixture_replay`
- `deep_research_regression_run`
- `deep_research_quality_audit`

### 2.2 Commands
Current documented entrypoints:
- `.opencode/commands/deep-research.md` (now includes deterministic canary steps beyond init)
- `.opencode/commands/deep-research-status.md` (points at the progress tracker)

---

## 3) The actual gap (what is missing to reach “operator can run it”)

### Gap G1 — End-to-end orchestrator command (agent work graph driver)
We need a command-level orchestrator that:

1) Calls deterministic tools in order.
2) Spawns existing researcher agents (`Task tool`) for Wave execution.
3) Writes outputs into the run root at the paths required by the state machine.
4) Runs validators + bounded retries.
5) Advances stages until `finalize` (or a hard gate blocks).

### Gap G2 — Perspective selection is not yet operationalized
We can *write* perspectives deterministically (`deep_research_perspectives_write`), but we need a documented policy and an operator-facing flow:

- where do perspectives come from?
- how do caps map to mode?
- how do we route to agent types?

### Gap G3 — Offline end-to-end “happy path” that reaches finalize
We can create a run root and advance stages, but a single reproducible offline demo that reaches `finalize` is still not packaged as one operator procedure.

---

## 4) Plan of record (milestones + acceptance criteria)

This plan produces **operator-grade documentation** and a **runnable, isolatable pipeline**.

### Milestone M0 — Produce operator-grade documentation (no new code required)
Deliverables:
1) `01-operator-runbook.md` — the canonical operator manual for running the pipeline in three modes:
   - offline fixture mode
   - offline deterministic canary mode
   - live research mode
2) `02-pipeline-step-catalog.md` — table of stages → required artifacts → tool calls → tests.
3) `03-orchestrator-design.md` — the command/orchestrator architecture (tick/driver model) aligned to existing specs.

Acceptance:
- A new contributor can follow the runbook to:
  - create a run root
  - create perspectives
  - plan wave 1
  - understand exactly what is missing to run live waves

### Milestone M1 — Runnable offline end-to-end canary that reaches `finalize`
Goal: a deterministic demo run that completes without web calls.

Approach:
- Use fixtures to supply wave outputs/citations/summaries/synthesis as needed.
- Or add one small “fixture driver” command that writes required artifacts into run root.

Acceptance evidence:
- One copy/paste procedure (in the runbook) produces:
  - a run root under `/Users/zuul/.config/opencode/research-runs/<run_id>`
  - `manifest.json`, `gates.json`, `logs/audit.jsonl`
  - stage folders populated sufficiently to reach `finalize`
- `bun test ./.opencode/tests` passes.

### Milestone M2 — Live Wave 1 execution (agent spawning + writing outputs)
Goal: from a query, run Wave 1 via existing researcher agents.

Acceptance evidence:
- Command spawns N agents (bounded by manifest limits).
- Outputs are written to `<runRoot>/wave-1/<perspective_id>.md`.
- Validators run; bounded retries occur.
- Pipeline advances to pivot.

### Milestone M3 — Pivot + Wave 2 + review loop automation
Goal: complete the full stage machine with bounded review iterations.

Acceptance evidence:
- `stage_advance` can proceed through all stages under live mode.
- Hard gates block and produce actionable errors.

---

## 5) Runnable “operator procedures” (what we will document explicitly)

These are the *exact* procedures the runbook will include (copy/paste).

### Procedure P1 — Initialize a run root (offline-first)
1) Set environment:
```bash
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
```

2) Tool call:
```json
{ "tool": "deep_research_run_init", "args": { "query": "…", "mode": "standard", "sensitivity": "no_web", "run_id": "dr_canary_001" } }
```

### Procedure P2 — Create perspectives (deterministic)
```json
{ "tool": "deep_research_perspectives_write", "args": { "perspectives_path": "<RUN_ROOT>/perspectives.json", "value": { "schema_version": "perspectives.v1", "run_id": "…", "created_at": "…", "perspectives": [/*…*/] }, "reason": "operator: seed" } }
```

### Procedure P3 — Plan wave 1 (deterministic)
```json
{ "tool": "deep_research_wave1_plan", "args": { "manifest_path": "<MANIFEST>", "reason": "operator: wave1 plan" } }
```

### Procedure P4 — Execute wave 1 (live) (this is the missing automation)
This is where the orchestrator must:
- read `wave1-plan.json`
- spawn agents
- write outputs to run root
- validate + review

### Procedure P5 — Offline fixture replay (step isolation)
Use fixture bundles under:
- `.opencode/tests/fixtures/bundles/*`

```json
{ "tool": "deep_research_regression_run", "args": { "fixtures_root": "<ABS>/.opencode/tests/fixtures/bundles", "bundle_ids": ["p06_gate_e_pass_warn_dup"], "reason": "operator: offline replay" } }
```

---

## 6) Independent review protocol (what reviewers must do)

Each reviewer produces a markdown file in this directory with:
- PASS/FAIL
- gap list
- concrete improvement ideas
- “if I were operating this, what would confuse me?”

Required reviewer inputs (read-only):
- `deep-research-option-c-master-plan.md`
- `deep-research-option-c-implementation-approach.md`
- `spec-stage-machine-v1.md`
- `.opencode/commands/deep-research.md`
- tool export list: `.opencode/tools/deep_research/index.ts`

---

## 7) Deliverables produced by this work unit

This dated directory will contain:
- `00-operator-pipeline-plan.md` (this file)
- `01-operator-runbook.md` (to be written)
- `02-pipeline-step-catalog.md` (to be written)
- `03-orchestrator-design.md` (to be written)
- `ARCHITECT-REVIEW.md`
- `QA-REVIEW.md`
- `ENGINEER-DEEP-REVIEW.md`
