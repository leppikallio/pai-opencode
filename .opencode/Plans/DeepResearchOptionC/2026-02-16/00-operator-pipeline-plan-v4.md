# Deep Research Option C — Operator Pipeline Plan v4 (acceptable plan target)

Date: 2026-02-16

**The Goal (no ambiguity):** You can run **end-to-end multi-agent deep research** in the real world.

**The Method (non-negotiable):** Every pipeline step is **isolatable** with deterministic tools + fixtures so we can refine it without rerunning full research.

This plan is written as an **operator contract** and an **engineering contract**.

## START HERE (new agent, no prior context)

Repo:
- `/Users/zuul/Projects/pai-opencode-graphviz`

Canonical plan directory (this directory):
- `.opencode/Plans/DeepResearchOptionC/2026-02-16/`

Read these files in order:
1) This plan: `00-operator-pipeline-plan-v4.md`
2) Testing Strategy v2: `04-testing-strategy-v2.md`
3) Testing Plan v2: `05-testing-plan-v2.md`
4) Tool & path map: `06-tool-and-path-map.md`
5) Bootstrap & operator commands: `07-bootstrap-and-operator-commands.md`
6) Glossary: `08-glossary.md`
7) Stage machine spec: `../spec-stage-machine-v1.md`
8) Master plan (invariants): `../deep-research-option-c-master-plan.md`

---

## 0) What exists vs what remains

### 0.1 Exists (deterministic substrate)
- Run roots + state: manifest/gates/audit log + stage directories.
- Deterministic stage machine: `deep_research_stage_advance`.
- Deterministic tools for wave planning/validation, citations, summaries, synthesis, Gate E evaluation/reports, review factory, fixture replay/regression.

### 0.2 Missing (the final mile to real-world usability)
The orchestrator layer that:
1) generates/chooses perspectives
2) spawns agents (Wave 1 / Wave 2)
3) ingests outputs into run root deterministically
4) enforces validators + bounded retries
5) advances stages until `finalize` (or stops on hard gate)

---

## 0.3 Current vs target operator surface (avoid confusion)

**Target (this plan):**
- `/deep-research <mode> "<query>" ...` supporting `plan|fixture|live` end-to-end.

**Current (as of 2026-02-16):**
- `.opencode/commands/deep-research.md` documents init + deterministic canary steps.
- The full orchestrator loop + live agent spawning + wave ingest tool are still to be implemented (Milestones M1–M3).

## 1) Canonical decisions

### D1 — Canonical run-root location
Run roots live under:

`/Users/zuul/.config/opencode/research-runs/<run_id>`

Scratchpad is for temporary drafts; run roots are the pause/resume state.

### D2 — Tool ID convention in operator docs
Tool IDs are referenced as:

`deep_research_<file_basename>`

### D3 — Orchestrator authority model
The orchestrator is a **stage-driven driver loop**. `deep_research_stage_advance` is the authority.

The orchestrator satisfies preconditions (writes artifacts), then asks the stage machine to advance, and repeats.

### D4 — Operator surface contract (the thing you will actually run)
We will support a single operator entrypoint command:

`/deep-research <mode> "<query>" [--run_id <id>] [--sensitivity normal|restricted|no_web]`

Where `<mode>` is one of:
- `plan` (dry-run planning only)
- `fixture` (fixture-run offline)
- `live` (real multi-agent research)

Command contract (must be documented and enforced):
- Always prints: `run_id`, `run_root`, `manifest_path`, `gates_path`, `stage.current`, `status`.
- On any hard failure: prints typed error + remediation hint and exits with failure.
- Supports `--run_id` to resume.

---

## 2) Step isolation model (how we avoid full reruns)

We implement the orchestrator with an explicit “drivers” boundary:

### Driver boundary (required)
The orchestrator must depend on an injected driver interface:

```ts
interface OrchestratorDrivers {
  // Agent execution
  runAgent(input: {
    perspective_id: string;
    agent_type: string;
    prompt_md: string;
  }): Promise<{
    markdown: string;
    // Required for reproducibility and debugging
    agent_run_id?: string;
    started_at?: string;
    finished_at?: string;
    error?: { code: string; message: string };
  }>

  // Determinism controls
  nowIso(): string;
  sleepMs(ms: number): Promise<void>;

  // Optional retrieval boundary (fixture can stub; live can call approved tools)
  retrieve?(input: { url: string; reason: string }): Promise<{ ok: boolean; status: number; body?: string }>;

  // Optional standardized audit/event sink (fixture can record; live writes to audit.jsonl)
  logEvent?(kind: string, payload: Record<string, unknown>): void;
}
```

Implementations:
- **Fixture driver:** returns deterministic outputs from `.opencode/tests/fixtures/runs/**`.
- **Live driver:** calls the OpenCode Task tool to spawn existing agents and captures markdown.

This is the key to “refine steps without rerunning full research.”

### Live-run evidence capture contract (required)
In `live` mode, the orchestrator must persist enough evidence to debug and (optionally) replay in fixture mode:
- agent spawn metadata (agent_type, perspective_id, prompt hash, agent_run_id)
- raw agent markdown outputs (written under `wave-1/` and `wave-2/`)
- validation and retry directives (artifact files, not console-only)
- stage transitions and gate writes (audit log)

---

## 3) Spec alignment matrix (stage machine → artifacts → tools)

We map every stage transition to:
- required artifacts (paths)
- producing/validating tools
- enforcement gates

This matrix is authoritative for the runbook and for acceptance tests.

**Note on terminal failure:** the stage spec describes a “terminal failed” branch; we implement that as `manifest.status = failed` written via `deep_research_manifest_write` plus a terminal failure artifact, rather than a new stage ID.

| Transition | Preconditions | Required artifacts | Tool(s) | Gate evidence |
|---|---|---|---|---|
| init → wave1 | perspectives exists | `perspectives.json` | `deep_research_run_init`, `deep_research_perspectives_write`, `deep_research_stage_advance` | Gate A present |
| wave1 → pivot | wave outputs exist; Gate B pass (bounded retries) | `wave-1/*.md`, `wave-1/wave1-plan.json`, `wave-review.json` | `deep_research_wave1_plan`, `deep_research_wave_output_validate`, `deep_research_wave_review`, `deep_research_gate_b_derive`, `deep_research_gates_write`, `deep_research_stage_advance` | Gate B PASS iff `ok=true`, `pass=true`, `validated>0`, `failed=0`, `retry_directives=0`, `results_count=validated`, and every result passes |
| pivot → (wave2 or citations) | pivot decision complete | `pivot.json` | `deep_research_pivot_decide`, `deep_research_stage_advance` | pivot integrity |
| wave2 → citations | wave2 outputs exist (or skipped) | `wave-2/*.md` (if used) | orchestrator + `deep_research_wave_output_ingest` + `deep_research_stage_advance` | Gate B still PASS |
| citations → summaries | Gate C pass | `citations/citations.jsonl` | citation tools + `deep_research_gate_c_compute` + `deep_research_gates_write` + `deep_research_stage_advance` | Gate C PASS |
| summaries → synthesis | Gate D pass | `summaries/summary-pack.json` | `deep_research_summary_pack_build` + `deep_research_gate_d_evaluate` + `deep_research_gates_write` + `deep_research_stage_advance` | Gate D PASS |
| synthesis → review | synthesis exists | `synthesis/final-synthesis.md` | `deep_research_synthesis_write` + `deep_research_stage_advance` | Gate D already PASS |
| review → synthesis | CHANGES_REQUIRED; iterations < max | `review/review-bundle.json` + revision record | `deep_research_review_factory_run` + `deep_research_revision_control` + `deep_research_stage_advance` | revision bounded |
| review → finalize | Gate E pass | Gate E reports + gates snapshot | `deep_research_gate_e_evaluate` + `deep_research_gate_e_reports` + `deep_research_gates_write` + `deep_research_stage_advance` | Gate E PASS |
| review → terminal failed | Gate E fail and iterations >= max | `review/terminal-failure.json` + reports snapshot | `deep_research_gate_e_evaluate` + `deep_research_gate_e_reports` + `deep_research_manifest_write` | manifest.status=failed |

---

## 4) Acceptance milestones (these guarantee real-world usability)

### M1 — Offline fixture-run reaches `finalize` (proves substrate + gates)
Deliverables:
- Smoke test: `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`
- Fixture scenarios (dirs):
  - `.opencode/tests/fixtures/runs/m1-finalize-happy/`
  - `.opencode/tests/fixtures/runs/gate-b-blocks/`
  - `.opencode/tests/fixtures/runs/gate-c-blocks/`
  - `.opencode/tests/fixtures/runs/review-loop-one-iteration/`
  - `.opencode/tests/fixtures/runs/review-loop-hit-cap/`

Minimum assertions:
- reaches `finalize` for happy fixture
- typed failure for each blocking fixture
- audit log contains one entry per stage transition

### M2 — Live Wave 1 works (first true real-world milestone)
Deliverables:
- New tool: `.opencode/tools/deep_research_cli/wave_output_ingest.ts` (tool id: `deep_research_wave_output_ingest`)
- Entity test: `.opencode/tests/entities/deep_research_wave_output_ingest.test.ts`
- Orchestrator live mode drives:
  - perspective selection → wave1 plan → spawn agents → ingest outputs → validate/review → Gate B → pivot

Acceptance:
- One real operator run reaches `pivot` and leaves a run root with:
  - wave outputs
  - wave review report
  - Gate B recorded from validator outputs

### M3 — Live end-to-end finalize (real world)
Acceptance:
- One real operator run reaches `finalize` with:
  - Gate C/D/E enforced
  - bounded review iterations
  - audit trail sufficient to debug

---

## 5) Next steps (turn plan into implementation)

1) Write `03-orchestrator-design.md` (driver loop + idempotency + retry directives + audit event types).
2) Build M1 smoke + fixtures.
3) Implement `deep_research_wave_output_ingest`.
4) Implement live orchestrator path using Task tool behind `drivers.runAgent()`.
5) Run one real live end-to-end query and capture the run root as evidence.

---

## 5.1 Parallel execution workstreams (subagents)

These are intentionally separable so multiple engineers can proceed in parallel:

- **Workstream A (M1):** add fixture-run smoke test + fixture scenarios
  - Targets: `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts` + `.opencode/tests/fixtures/runs/m1-*`

- **Workstream B (Stage transitions):** complete deterministic transition coverage for `deep_research_stage_advance`
  - Target: `.opencode/tests/entities/deep_research_stage_advance.test.ts`

- **Workstream C (M2):** implement `deep_research_wave_output_ingest` + entity tests
  - Targets: `.opencode/tools/deep_research_cli/wave_output_ingest.ts` + `.opencode/tests/entities/deep_research_wave_output_ingest.test.ts`

- **Workstream D (Orchestrator core):** implement driver loop + fixture driver boundary test
  - Targets: orchestrator module + `.opencode/tests/entities/deep_research_orchestrator_tick_fixture.test.ts`

- **Workstream E (Live):** implement gated live smoke tests (Wave1→pivot and finalize)
  - Targets: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`, `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

Canonical testing docs for engineers:
- `04-testing-strategy-v2.md`
- `05-testing-plan-v2.md`

---

## 5.2 Review-before-commit protocol (non-negotiable)

**No commits until reviews PASS.**

For each workstream or PR-sized change:
1) Builder implements changes on a branch/worktree and stages them locally.
2) Builder runs local checks:
   - `bun test ./.opencode/tests`
   - `bun Tools/Precommit.ts`
3) Builder writes an evidence note (what changed, which tests, which fixtures) under this dated directory.
4) **Architect review** and **QA review** are run against the staged diff and artifacts.
5) Only when both reviews are **PASS** do we create the git commit.


---

## 6) Independent review protocol (v4)

Reviewers must produce:
- `ARCHITECT-REVIEW-v4.md`
- `QA-REVIEW-v4.md`
- `ENGINEER-DEEP-REVIEW-v4.md`
