# Deep Research Overview (BUILD + EXECUTE)

This file contains the **BUILD** and **EXECUTE** sections from the deep-research workflow explanation.

## BUILD

### 1) What “deep-research” is (surfaces)

From the skill’s own contract:

- **Workflows:** `.opencode/skills/deep-research/Workflows/*.md` (operator guidance)
- **CLI:** `bun ".opencode/pai-tools/deep-research-cli.ts" <command> [...flags]`
- **Source of truth:** the **run root artifacts** (manifest, gates, stage outputs), not chat history or env vars.

### 2) What it achieves (concretely)

It gives you a deterministic, inspectable pipeline where:

- The system always knows which stage you’re in (`manifest.json`).
- It records quality/contract decisions as gates (`gates.json` for Gates A–F).
- It can halt and tell you exactly what to do next (`halt.next_commands` in `--json` output, and `operator/halt/latest.json`).
- “Real research” vs “scaffolding” is explicit:
  - **Fixture/generate** paths prove the pipeline/gates execute deterministically.
  - The **task-driver loop** (`tick --driver task` + `agent-result`) is the seam where real agent outputs are produced/ingested.

## EXECUTE

### 3) The step-by-step workflow you follow (operator runbook)

#### Step 0 — Choose run controls (always)

You decide:

- `query` (the research question)
- `run_id` (strongly recommended for deterministic reproduction)
- `mode`: `quick | standard | deep` (controls caps/limits)
- `sensitivity`: `normal | restricted | no_web` (controls citations policy and web access)

---

#### Step 1 — Initialize a run (creates the run root + core ledgers)

You run `init ...` which prints (contract):

- `run_id`, `run_root`, `manifest_path`, `gates_path`, `stage.current`, `status`

Two initialization variants:

**A) Default init (perspectives auto-created)**

Use when you’re fine with auto-generated `perspectives.json`.

- Result: run root + `manifest.json` + `gates.json` + `perspectives.json` + Wave 1 plan; stage typically advances to `wave1`.

**B) Perspectives drafting seam (agent-authored perspectives)**

Use when you want an agent to draft the perspective set.

- Run `init --no-perspectives`
- Then explicitly enter `stage.current=perspectives`
- Then run `perspectives-draft --driver task` (this writes a prompt and halts)
- You produce a JSON payload (`perspectives-draft-output.v1`)
- Ingest via `agent-result --stage perspectives ...`
- Re-run `perspectives-draft` to promote `perspectives.json`, regenerate the Wave 1 plan, and advance to `wave1`

Why this exists: it makes the “what perspectives should we run?” step deterministic and auditable, instead of implicit.

---

#### Step 2 — Run Wave 1 (primary research fan-out)

This is the canonical live operator loop:

1) `tick --driver task --json`

2) If it halts with `RUN_AGENT_REQUIRED`:

   - Read prompts under: `operator/prompts/wave1/<perspective_id>.md`
   - Run your agent/LLM for each prompt
   - Write outputs to a file (your choice of location), then ingest each with:
     `agent-result --stage wave1 --perspective <id> --input <md> --agent-run-id <id> ...`

3) Repeat `tick` until Wave 1 completes.

Wave 1 writes (operator-critical):

- `wave-1/<perspective_id>.md`
- `wave-1/<perspective_id>.meta.json`
- `wave-review.json` (aggregated PASS/FAIL + retry directives)
- Gate B is derived/written; stage advances to `pivot` when ready.

---

#### Step 3 — Pivot (decide if Wave 2 is needed)

At `stage.current=pivot`, the system produces:

- `pivot.json` describing:
  - whether Wave 2 is required
  - which gaps to fill if yes

If Wave 2 is required, you repeat a similar task-driver loop for gap-only prompts.

---

#### Step 4 — Wave 2 (gap-only specialists; optional)

If pivot says “run Wave 2”:

- You’ll ingest gap responses; artifacts look like:
  - `wave-2/<gap_id>.md`

Then the run advances toward citations.

---

#### Step 5 — Citations (build + validate the citation pool; Gate C)

This stage enforces the citations ladder:

1) Extract candidate URLs (`citations_extract_urls`)

2) Normalize URLs and compute deterministic IDs (`citations_normalize`)

3) Validate citations (`citations_validate`)

   - `sensitivity=no_web` => offline validation only
   - `sensitivity=normal|restricted` => online validation required

4) Compute Gate C (`gate_c_compute`) and persist with `gates_write`

Key artifacts:

- `citations/citations.jsonl` (validated pool)
- `citations/blocked-urls.json` (must not be hidden)

Only after Gate C is written does the run advance to summaries.

---

#### Step 6 — Summaries (bounded summary pack; Gate D)

Build the bounded input pack for synthesis:

- `summary_pack_build` → `summaries/summary-pack.json`
- `gate_d_evaluate` (+ `gates_write`) records whether summary coverage/boundedness is acceptable

---

#### Step 7 — Synthesis + Review loop (Gate E) → Finalize or terminal failure

This is an iterative bounded loop:

- `synthesis_write` → `synthesis/final-synthesis.md`
- `review_factory_run` → `review/review-bundle.json` (PASS / CHANGES_REQUIRED)
- `gate_e_reports` → report files under `reports/` (numeric claims, sections present, citation utilization, etc.)
- `gate_e_evaluate` (+ `gates_write`) records Gate E
- `revision_control` decides:
  - `advance` → finalize
  - `revise` → loop back to synthesis
  - `escalate` → operator intervention

The loop is capped by `manifest.limits.max_review_iterations`. If cap is hit and still failing, the run writes:

- `review/terminal-failure.json` and marks the run failed.

---

#### Step 8 — Finalize (terminal completed state)

Terminal successful outputs you care about:

- `synthesis/final-synthesis.md`
- `review/review-bundle.json` (PASS)
- `gates.json` shows Gate E pass
- `logs/audit.jsonl` exists as the audit trail
- `manifest.status=completed`, `manifest.stage.current=finalize`

---

### 4) Modes + drivers (the part that saves you from confusion)

Operator “modes” you’ll talk about:

- **plan:** offline-first; create run root + perspectives + wave plans; stop early; no agents, no web.
- **fixture:** deterministic offline progression end-to-end; validates contracts/gates; not “real research.”
- **live:** real operator run where agent outputs are produced/ingested via the driver seam.

Execution “drivers” (how stages get outputs):

- `driver=fixture`: uses known-good deterministic outputs to prove the pipeline works.
- `driver=task`: halts with prompts, you run agents, you ingest outputs (`agent-result`). This is the “real research seam”.
- `driver=live`: described as operator/manual by default; the skill recommends the task-driver loop for non-blocking, canonical artifacts.

---

### 5) Practical checklist (copy/paste shape, conceptually)

Later, when you do run it, the operator rhythm is:

1) `init ... --run-id ... --json` → capture `manifest_path`, `gates_path`, `run_root`

2) Repeat:

   - `tick --manifest <manifest> --driver task --json`
   - If halted with `RUN_AGENT_REQUIRED`:
     - read `operator/prompts/<stage>/<id>.md`
     - run agent/LLM
     - `agent-result --stage <stage> --perspective <id> --input <file> --agent-run-id <id> --json`

3) Stop at `finalize` (or handle a typed blocker via `triage`)

Optional operator controls:

- `pause` / `resume` for long runs
- `triage` when stalled/blocked
