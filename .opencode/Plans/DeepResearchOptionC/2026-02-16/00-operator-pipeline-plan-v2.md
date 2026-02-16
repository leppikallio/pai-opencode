# Deep Research Option C — Operator Pipeline Plan v2 (superseded)

Date: 2026-02-16

⚠️ **Superseded:** see `00-operator-pipeline-plan-v3.md` in this directory.

This is the revision of the operator plan after independent reviews (Architect, QA, engineer-deep) found v1 insufficiently spec-aligned and insufficiently testable.

**Goal of this plan v2:** make the path from “we built deterministic tools” → “operator can run end-to-end safely” explicit, stage-machine aligned, and verifiable without rerunning full live research every time.

---

## 0) What Phase 00–07 delivered (and what it intentionally didn’t)

### Delivered (deterministic substrate)
We have a working artifact-first toolchain with entity tests and fixtures. The authoritative tool export surface is:

- `.opencode/tools/deep_research/index.ts`

Core properties:
- **Artifacts are the source of truth** (manifest/gates/audit log + stage dirs).
- **Stage transitions are deterministic** and enforced by `deep_research_stage_advance`.
- **Most steps are isolatable** via fixture-driven contract tests.

### Not yet delivered (operator-grade orchestration)
We do **not** yet have a full “operator command” that:
- chooses perspectives automatically,
- spawns research agents for wave execution,
- persists wave outputs,
- retries/reviews boundedly,
- advances all stages to `finalize`.

This is not drift; it is the explicit division of responsibilities:
- Tools: deterministic planning/validation/writing.
- Command/orchestrator: agent work graph + sequencing + stop/go decisions.

---

## 1) Canonical decisions (resolve ambiguity up front)

### D1 — Canonical run-root location (real runs)
**Decision:** real run roots live under:

`/Users/zuul/.config/opencode/research-runs/<run_id>`

Rationale:
- operator discoverability (stable location)
- aligns with the existing drills log and recent usage

Relationship to “scratchpad” language in older docs:
- Scratchpad is the place for **temporary drafts and intermediate work products**.
- The run root is the place for **canonical run artifacts** that must survive pause/resume.

Follow-up required (doc consistency): update the master plan language that implies run ledger “stored in scratchpad” to clarify this distinction.

### D2 — Orchestrator driver model (how the command runs)
**Decision:** the orchestrator is a **stage-driven driver loop** where `deep_research_stage_advance` is the authority.

The command’s job is to satisfy preconditions and then ask the stage machine to advance.

Pseudo-code (conceptual):

```text
loop:
  read manifest + gates
  next = stage_advance(manifest, gates, requested_next?)
  if next.ok == false:
    print actionable error + stop
  if next.stage advanced:
    continue loop
  else:
    satisfy preconditions for (from -> to):
      - call deterministic tools (plan/validate/compute gates)
      - in live mode: spawn agents and persist their outputs
    then continue loop
```

Idempotency rule (must be enforced by the command):
- If an artifact already exists and validates, do not rewrite it unless a revision controller says it is allowed.

### D3 — Three operator modes (to enable step isolation)
We explicitly support three modes to avoid “rerun everything”:

1) **Fixture-run (offline)**
   - No web calls, no agent spawning.
   - Inputs are fixture bundles / dry-run seeds.
   - Purpose: verify later steps (citations/summaries/synthesis/review/gates) deterministically.

2) **Dry-run (offline planning)**
   - Plans only (perspectives + wave plans), no agent spawning.
   - Purpose: align/iterate on routing and contracts.

3) **Live-run (real research)**
   - Agent spawning allowed (Wave 1/2).
   - Web/API calls allowed only through controlled surfaces (research-shell / approved tools).
   - Purpose: produce real answer.

---

## 2) Spec alignment matrix (stage machine → artifacts → tools → acceptance)

This table is the anti-drift contract. It maps every stage transition to concrete artifacts, tools, and proof.

### 2.1 Stage transitions (from `spec-stage-machine-v1.md`)

| From → To | Preconditions (spec) | Required artifacts (exact paths under run root) | Tool(s) that produce/validate | Gate evidence | Test/fixture evidence |
|---|---|---|---|---|---|
| init → wave1 | perspectives.json exists + validates | `manifest.json`, `gates.json`, `perspectives.json` | `run_init`, `perspectives_write`, `stage_advance` | Gate A already present in gates schema | `deep_research_run_init.test.ts`, `deep_research_perspectives_write.test.ts`, `deep_research_stage_advance.test.ts` |
| wave1 → pivot | wave1 artifacts exist; Gate B pass | `wave-1/*.md`, `wave-1/wave1-plan.json` | `wave1_plan`, `wave_output_validate`, `wave_review`, `gates_write`, `stage_advance` | Gate B written via `gates_write` | `deep_research_wave1_plan.test.ts`, `deep_research_wave_output_validate.test.ts`, `deep_research_wave_review.test.ts` |
| pivot → wave2 | pivot decision says wave2 | `pivot.json` | `pivot_decide`, `stage_advance` | (pivot integrity feeds Gate B) | `deep_research_pivot_decide.test.ts` |
| pivot → citations | pivot decision complete | `pivot.json` | `pivot_decide`, `stage_advance` | Gate B already pass | `deep_research_pivot_decide.test.ts`, `deep_research_stage_advance.test.ts` |
| wave2 → citations | wave2 artifacts exist OR wave2 skipped | `wave-2/*.md` (if used) | (live orchestrator writes), `stage_advance` | Gate B already pass | (future) fixture-run / live-run tests |
| citations → summaries | Gate C pass | `citations/` + `citations/citations.jsonl` | citations extract/normalize/validate + `gate_c_compute` + `gates_write` + `stage_advance` | Gate C PASS | `deep_research_citations_phase04.test.ts`, `deep_research_gate_c_compute.test.ts` |
| summaries → synthesis | Gate D pass | `summaries/summary-pack.json` (+ summary md) | `summary_pack_build`, `gate_d_evaluate`, `gates_write`, `stage_advance` | Gate D PASS | `deep_research_summary_pack_build.test.ts`, `deep_research_gate_d_evaluate.test.ts` |
| synthesis → review | draft/final exists | `synthesis/final-synthesis.md` | `synthesis_write`, `stage_advance` | Gate D already pass | `deep_research_synthesis_write.test.ts` |
| review → finalize | Gate E hard metrics pass | reviewer outputs + Gate E reports | `review_factory_run`, `gate_e_evaluate`, `gate_e_reports`, `gates_write`, `stage_advance` | Gate E PASS | `deep_research_review_factory_run.test.ts`, `deep_research_gate_e_evaluate.test.ts`, `deep_research_gate_e_reports.test.ts` |

Notes:
- “Live orchestrator writes” indicates the missing automation: command must spawn agents and persist their markdown outputs.
- Fixture-run mode can satisfy some artifact expectations by copying fixtures into the run root (deterministically) to isolate downstream tools.

---

## 3) Milestones (re-scoped to be proof-driven)

### M0 — Operator-grade documentation package (this is not a “quickstart”)
Deliverables (in this dated directory):
- `01-operator-runbook.md`
- `02-pipeline-step-catalog.md` (includes the matrix above or references it)
- `03-orchestrator-design.md` (driver model + idempotency + pause/resume)

Acceptance evidence:
- Every procedure includes an executable tool-call snippet and expected artifacts.
- A “doc surface test” exists (or is specified) that fails if the runbook references a non-existent tool.

### M1 — Offline end-to-end finalize smoke (fixture-run)
Goal:
- A single reproducible procedure reaches `finalize` without live web calls.

Acceptance evidence:
- A canonical smoke artifact (test or command) exists and is runnable in CI:
  - creates temp root
  - produces run root artifacts
  - advances stage machine through `finalize`
  - exits non-zero on any failure
- The run root contains:
  - `manifest.json`, `gates.json`, `logs/audit.jsonl`
  - required stage artifacts for the chosen fixture path

### M2 — Live Wave 1 execution (agent spawning) with fixture-run driver support
Goal:
- Same orchestrator path runs in two modes:
  - fixture-run (agents simulated)
  - live-run (real agents)

Acceptance evidence:
- Deterministic test demonstrates the orchestrator calls a driver `runAgent()` N times and persists outputs.
- Validators enforce contracts; bounded retries are recorded.

### M3 — Pivot + Wave 2 + bounded review loop
Acceptance evidence:
- Tests for max-iteration behavior and hard gate blocking.

---

## 4) Concrete next work items (to get to runnable reality)

These are the next five items the reviews converged on:

1) Update master plan language re: scratchpad vs research-runs (doc-only consistency).
2) Write `03-orchestrator-design.md` with explicit driver loop + idempotency + pause/resume.
3) Define M1 smoke artifact (test file path + exact assertions) and implement it.
4) Implement the minimal “wave output ingest/commit” tool for M2 (batch writes + validation).
5) Add QA acceptance checklist + negative tests for gate blocking.

---

## 5) Independent review protocol for this v2

Reviewers must produce markdown files in this directory:
- `ARCHITECT-REVIEW-v2.md`
- `QA-REVIEW-v2.md`
- `ENGINEER-DEEP-REVIEW-v2.md`

Each must include:
- Verdict PASS/FAIL
- Gaps
- Specific improvements
- Next 5 work items (with acceptance)
