# Deep Research Option C — Operator Pipeline Plan v3 (superseded)

Date: 2026-02-16

⚠️ **Superseded:** see `00-operator-pipeline-plan-v4.md` in this directory.

This plan is the path to the **actual goal**:

> You can conduct **multi-agent deep research end-to-end** (real-world usage), while still being able to isolate and refine individual pipeline steps without re-running full research.

It is written to be **reviewable and enforceable**: concrete artifacts, concrete tool IDs, concrete tests/fixtures, and concrete operator procedures.

---

## 0) The core clarity (no more ambiguity)

### 0.1 What Phase 00–07 already gave us
We have a strong deterministic substrate:
- artifact-first run roots (`manifest.json`, `gates.json`, `logs/audit.jsonl`, stage folders)
- deterministic stage machine (`deep_research_stage_advance`)
- deterministic validators/planners for wave/citations/summaries/synthesis/review
- entity tests and fixture bundles for multiple gates

### 0.2 What is still missing (and must be built)
We still need the **orchestrator command layer** that makes this usable in practice:

1) chooses perspectives (policy + override)
2) spawns agents for Wave 1 / Wave 2
3) persists outputs into run root deterministically
4) runs validators + bounded retries
5) advances stages until `finalize` (or hard-gate stop)

Smoke tests and fixtures are not “the goal”; they are how we prevent regressions and refine steps cheaply while we build the real orchestrator.

---

## 1) Canonical decisions (resolved)

### D1 — Canonical run-root location
Canonical run roots live under:

`/Users/zuul/.config/opencode/research-runs/<run_id>`

Scratchpad is for temporary drafts; the run root is the pause/resume state.

**Doc consistency:** `deep-research-option-c-master-plan.md` now explicitly states this.

### D2 — Tool ID convention used in operator docs
In operator docs, tool IDs are written as:

`deep_research_<file_basename>`

Examples:
- `.opencode/tools/deep_research_cli/run_init.ts` → `deep_research_run_init`
- `.opencode/tools/deep_research_cli/wave1_plan.ts` → `deep_research_wave1_plan`

This matches how tools are referenced throughout Option C specs and prevents naming drift.

### D3 — Orchestrator driver model (authoritative)
The orchestrator is a **stage-driven driver loop** where `deep_research_stage_advance` is the authority.

The orchestrator’s job is to:
- satisfy the preconditions for the next transition (by producing artifacts), then
- ask the stage machine to advance, then
- repeat until blocked or `finalize`.

This is how we get determinism, pause/resume, and step isolation.

---

## 2) Operator modes (this is how we isolate steps)

### Mode A — Fixture-run (offline)
Purpose: refine downstream steps (citations/summaries/synthesis/review/gates) **without rerunning research**.

Inputs: fixture bundles and/or fixture run roots.

### Mode B — Dry-run (offline planning)
Purpose: refine perspective selection + wave planning + contracts **without running agents**.

### Mode C — Live-run (real research)
Purpose: conduct real multi-agent deep research end-to-end.

Constraint: live-run is required for the actual goal, but the other two modes are how we iterate quickly.

---

## 3) Spec alignment matrix (complete, stage-machine aligned)

This table is the anti-drift contract: it maps **every stage transition** from `spec-stage-machine-v1.md` to artifacts, tools, and proof.

Legend:
- Artifacts are paths under the run root.
- Tool IDs use the convention in D2.

| From → To | Preconditions (spec) | Required artifacts | Tool(s) that produce/validate | Gate evidence | Proof (tests/fixtures) |
|---|---|---|---|---|---|
| init → wave1 | manifest valid; perspectives.json exists | `manifest.json`, `gates.json`, `perspectives.json` | `deep_research_run_init`, `deep_research_perspectives_write`, `deep_research_stage_advance` | Gate A present | entity tests: `deep_research_run_init`, `deep_research_perspectives_write`, `deep_research_stage_advance` |
| wave1 → pivot | wave1 outputs exist; Gate B pass | `wave-1/wave1-plan.json`, `wave-1/*.md`, `wave-review.json` | `deep_research_wave1_plan`, `deep_research_wave_output_validate`, `deep_research_wave_review`, `deep_research_gates_write`, `deep_research_stage_advance` | Gate B PASS, plus `wave-review.json` as evidence | entity tests: wave plan/validate/review + new fixture run `fixtures/runs/gate-b-blocks/` |
| pivot → wave2 | pivot decision says wave2 | `pivot.json` | `deep_research_pivot_decide`, `deep_research_stage_advance` | pivot artifact integrity | entity tests: `deep_research_pivot_decide` |
| pivot → citations | pivot decision complete (wave2 skipped or planned) | `pivot.json` | `deep_research_pivot_decide`, `deep_research_stage_advance` | Gate B already PASS | entity tests: pivot + stage advance |
| wave2 → citations | wave2 outputs exist OR skipped | `wave-2/*.md` (if used) OR explicit skip recorded in pivot | (live orchestrator writes + validates) + `deep_research_stage_advance` | Gate B already PASS | M2 fixture-run driver test + one negative fixture |
| citations → summaries | Gate C pass | `citations/extracted-urls.txt`, `citations/citations.jsonl` | `deep_research_citations_extract_urls`, `deep_research_citations_normalize`, `deep_research_citations_validate`, `deep_research_gate_c_compute`, `deep_research_gates_write`, `deep_research_stage_advance` | Gate C PASS | existing entity tests + existing phase04 fixtures |
| summaries → synthesis | Gate D pass | `summaries/summary-pack.json` | `deep_research_summary_pack_build`, `deep_research_gate_d_evaluate`, `deep_research_gates_write`, `deep_research_stage_advance` | Gate D PASS | existing entity tests + fixtures under `.opencode/tests/fixtures/summaries/phase05/*` |
| synthesis → review | synthesis final exists | `synthesis/final-synthesis.md` | `deep_research_synthesis_write`, `deep_research_stage_advance` | Gate D already PASS | entity test: `deep_research_synthesis_write` |
| review → synthesis | reviewer says CHANGES_REQUIRED; iterations < max | `review/review-bundle.json` + revision record | `deep_research_review_factory_run`, `deep_research_revision_control`, `deep_research_stage_advance` | Gate E not PASS yet; review directive recorded | fixture run `fixtures/runs/review-loop-one-iteration/` (to be created) |
| review → finalize | Gate E hard metrics pass | Gate E reports + reviewer PASS | `deep_research_gate_e_evaluate`, `deep_research_gate_e_reports`, `deep_research_gates_write`, `deep_research_stage_advance` | Gate E PASS | existing Gate E bundle fixtures + `deep_research_fixture_replay` |
| review → terminal failed | Gate E fails and iterations >= max | terminal failure artifact + reports snapshot | `deep_research_gate_e_evaluate`, `deep_research_gate_e_reports`, `deep_research_stage_advance` | Gate E FAIL recorded | fixture run `fixtures/runs/review-loop-hit-cap/` (to be created) |

Notes:
- The “missing automation” is explicit: wave output persistence + agent spawning.
- Gate B evidence must not be “written by hand”; it must be derived from validator outputs (`wave_review` report) and recorded.

---

## 4) Milestones (reframed so they guarantee real-world usability)

### M0 — Operator-grade documentation package (robust, not a quickstart)
Deliverables (under this dated directory):
- `01-operator-runbook.md`
- `02-pipeline-step-catalog.md` (includes the matrix above)
- `03-orchestrator-design.md`

Acceptance evidence:
- Every procedure has: tool calls + expected artifact paths + failure modes.
- A doc surface test is specified with exact path (below).

**Doc surface test (must be created):**
- `.opencode/tests/docs/deep_research_operator_docs_surface.test.ts`
- It must fail if runbook references a tool ID that doesn’t exist in `.opencode/tools/deep_research_cli/index.ts`.

### M1 — Offline end-to-end finalize smoke (fixture-run)
Purpose: prove the stage machine + gates + review loop can reach `finalize` deterministically.

This is necessary so we can refine steps cheaply, but it is not the end goal.

**Canonical smoke test (must be created):**
- `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`

**Fixture scenarios (must be created under `.opencode/tests/fixtures/runs/`):**
- `m1-finalize-happy/`
- `gate-b-blocks/`
- `gate-c-blocks/`
- `review-loop-one-iteration/`
- `review-loop-hit-cap/`

Smoke assertions (minimum):
- `manifest.json` ends at `stage.current = "finalize"`.
- `gates.json` shows required gates PASS for the chosen happy fixture path.
- `logs/audit.jsonl` contains a stage transition record per advance.
- Any missing artifact causes typed failure (non-zero test failure).

### M2 — Live Wave 1 execution (first real-world usability milestone)
Purpose: actually conduct multi-agent research.

Deliverable (must be built): **wave output ingest tool**
- `.opencode/tools/deep_research_cli/wave_output_ingest.ts`
- tool ID: `deep_research_wave_output_ingest`
- Behavior: batch write outputs to `wave-1/<id>.md` (or `wave-2/<id>.md`), validate via `deep_research_wave_output_validate`, emit ingest report + retry directives.

Acceptance evidence:
- In fixture-run mode, a deterministic test proves:
  - orchestrator calls `runAgent()` N times (driver-injected)
  - writes outputs and validators enforce contracts
- In live-run mode, an operator can run a small multi-agent research query end-to-end through pivot:
  - evidence: run root contains wave outputs + wave review report + Gate B recorded.

### M3 — Live end-to-end finalize (Wave 2 + review loop)
Purpose: the actual target behavior.

Acceptance evidence:
- A live-run completes to `finalize` with:
  - citations validated (Gate C)
  - summary pack bounded (Gate D)
  - synthesis + review loop bounded (Gate E)
  - full audit trail

---

## 5) What we do next (plan-to-implementation bridge)

This plan is acceptable only if it leads to the real system. Therefore, the next five work items are:

1) Write `03-orchestrator-design.md` with:
   - driver loop
   - idempotency rules
   - pause/resume semantics
   - audit event contract for orchestrator actions

2) Define and implement the M1 smoke test + fixture scenarios exactly as named above.

3) Implement `deep_research_wave_output_ingest` + entity tests.

4) Extend `.opencode/commands/deep-research.md` into two explicit operator flows:
   - `fixture-run` (offline)
   - `live-run` (spawns agents)

5) Add a live-run operator procedure that produces a final answer and stores run-root artifacts.

---

## 6) Independent review protocol (v3)

Reviewers must produce markdown files in this directory:
- `ARCHITECT-REVIEW-v3.md`
- `QA-REVIEW-v3.md`
- `ENGINEER-DEEP-REVIEW-v3.md`
