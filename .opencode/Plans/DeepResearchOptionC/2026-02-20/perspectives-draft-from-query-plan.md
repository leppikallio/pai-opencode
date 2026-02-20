# Option C — Perspectives Drafting From Query (Plan v0.4)

Status: **PLANNING ONLY** (no implementation in this document)

## 0) Decisions frozen (required for implementation readiness)

These were previously “open decisions” in v0.3. They are now frozen so subagents can implement without ambiguity.

1) **Stage model:** add explicit manifest stage `perspectives` (between `init` and `wave1`).
2) **Ingest command:** extend `agent-result` with `--stage perspectives`.
3) **Wave1 prompt content:** include platform requirements + tool hierarchy (PRIMARY/SECONDARY/FORBIDDEN) in `prompt_md` now.
4) **Allowed agent types:** use the current researcher agents (Claude/Gemini/Perplexity/Grok) as the default set.
5) **Policy defaults (stricter ensemble):**
   - `ensemble_threshold=80`
   - `backup_threshold=85`
   - `match_bonus=+10`
   - `mismatch_penalty=-25`
   - Comparison semantics: treat thresholds as `>=` checks on integer confidence 0–100.

## 1) The gap we’re closing

Current Option C behavior:

- `run_init` creates the run root + `manifest.json` + `gates.json` + `operator/scope.json`, but **does not generate perspectives**.
- The operator CLI `init` currently writes `perspectives.json` via `perspectives_write` using a **static default payload** (not query-derived).

This makes the pipeline “deterministic after artifacts exist,” but leaves the first major planning step (deriving research perspectives) as a manual/operator task.

Goal: add **LLM-assisted perspective drafting** while preserving Option C’s determinism contract by **capturing all LLM inputs/outputs as run artifacts**.

## 2) Non-negotiable constraints (carried forward)

1. **Deterministic after artifacts exist**
   - Any non-determinism must be isolated to “agent execution,” and the result must be stored as immutable artifacts.
2. **No-env operator contract**
   - No per-run instructions like “export API_KEY=…”.
   - Multi-model capability is achieved by running different OpenCode agent types (Claude/Gemini/Perplexity/Grok) via task-driver seams, not by tools reading env secrets.
3. **Primary execution environment is runtime root** (`~/.config/opencode/`)
   - All operator guidance + next commands must use runtime paths.
4. **Keep `perspectives.v1`** as the canonical artifact for Wave 1 planning.
5. **Architect PASS and QA PASS** required before we declare this feature “done”.
6. **UX is a first-class requirement (required for usability and alignment)**
   - The canonical operator surface is the **deep-research skill** and its workflows.
   - If we add perspective drafting but don’t update the skill workflows, the system will not be usable end-to-end.

## 3) Existing contracts we must respect

### 3.1 `perspectives.json` schema (perspectives.v1)
Validator: `validatePerspectivesV1()` (deep research tool surface)

Required fields:
- `schema_version: "perspectives.v1"`
- `run_id`
- `created_at`
- `perspectives[]` entries with:
  - `id`, `title`, `track ∈ {standard, independent, contrarian}`, `agent_type`
  - `prompt_contract.max_words`, `prompt_contract.max_sources`, `prompt_contract.tool_budget`, `prompt_contract.must_include_sections[]`

Note: The validator does **not** reject additional fields, so we can safely add optional metadata (e.g., platform requirements, tool hierarchy) without a schema bump — but consumers won’t use it until we wire it in.

### 3.2 Wave 1 plan depends on perspectives
Tool: `wave1_plan` reads `perspectives.json` and:
- enforces `run_id` match with manifest
- enforces `count(perspectives) <= manifest.limits.max_wave1_agents`
- emits deterministic `wave-1/wave1-plan.json` entries with `prompt_md` per perspective

Implication: **If we iterate perspectives.json, we must regenerate `wave1-plan.json`** (or force wave1_plan to run when inputs digest changed).

## 4) Operator-facing workflow (interactive, but artifact-captured)

### Step 0 — Initialize run without the static default (CANONICAL)

Preferred: add/standardize a path where init does not write the static default perspectives.

Operator (runtime) command:

```bash
bun "pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal --no-perspectives
```

Outcome:
- Run root exists with manifest/gates/scope.
- No perspectives written yet.

UX note (required): the deep-research skill workflows must be updated so that this is the default “start here” path.

### Step 0b — Enter perspectives stage (CANONICAL)

Since we now require `stage.current="perspectives"`, we need an explicit transition from init.

Canonical (runtime) command:

```bash
bun "pai-tools/deep-research-option-c.ts" stage-advance \
  --manifest "<abs manifest_path>" \
  --requested-next perspectives \
  --reason "begin perspective drafting"
```

Expected artifact outcomes:
- `<run_root>/manifest.json` updated with `stage.current="perspectives"` and stage history appended

Quick verification:

```bash
rg -n '"current":\s*"perspectives"' "<run_root>/manifest.json"
```

### Step 1 — Draft perspectives from query (CANONICAL)

**We must freeze the canonical operator command surface now** (engineer-deep review blocker).

Canonical (runtime) command (new CLI command; do not overload `tick`):

```bash
bun "pai-tools/deep-research-option-c.ts" perspectives-draft \
  --manifest "<abs manifest_path>" \
  --reason "draft perspectives" \
  --driver task
```

Expected artifact outcomes:
- `<run_root>/operator/prompts/perspectives/<perspective_step_or_model>.md` (1+ files)
- `<run_root>/operator/halt/latest.json` with `code=RUN_AGENT_REQUIRED`
- Halt details includes `missing_perspectives[]` for the perspectives drafting stage

Quick verification (operator):

```bash
test -f "<run_root>/operator/halt/latest.json" && rg -n "RUN_AGENT_REQUIRED" "<run_root>/operator/halt/latest.json"
ls -la "<run_root>/operator/prompts/perspectives" 
```

Implementation note:
- This command MUST NOT call any LLMs directly.
- It only writes prompt artifacts and halts with `RUN_AGENT_REQUIRED`, identical to existing task-driver seams.

Normative behavior (idempotent):
- If stage outputs are missing, `perspectives-draft` writes/refreshes prompts and halts (`RUN_AGENT_REQUIRED`).
- If all required stage outputs exist and validate, `perspectives-draft` merges candidates, writes a draft, (optionally) halts for human review, then promotes `perspectives.json`, regenerates `wave1-plan.json`, and **automatically stage-advances to `wave1`**.

### Step 2 — Run agents + ingest (existing pattern)

The operator (me) runs the requested agents (multi-model selective ensemble) and ingests outputs as artifacts.

We will extend `agent-result` with an additional stage:

- `--stage perspectives`

…that writes:
- raw model outputs (verbatim)
- normalized JSON
- meta sidecar with `prompt_digest`, `agent_run_id`, timestamps

Idempotency rule (REQUIRED):
- Re-ingesting the same prompt_digest into the same output path is a no-op (PASS) and MUST NOT rewrite outputs.
- Ingesting a different prompt_digest into an existing output path is a deterministic failure (conflict) unless `--force` is provided.

### Step 2a — Drafting lifecycle state (REQUIRED)

We must persist a drafting lifecycle state so the process is resumable and idempotent.

Proposed artifact:
- `<run_root>/operator/state/perspectives-state.json`

Minimum fields:
- `schema_version`: `perspectives-draft-state.v1`
- `run_id`
- `status`: `drafting|awaiting_agent_results|merging|awaiting_human_review|promoted`
- `policy_path` (see policy artifact below)
- `inputs_digest` (manifest + scope + policy + prompt templates digests)
- `draft_digest` (if a draft exists)
- `promoted_digest` (if promoted)

Deterministic transition rules:
- If prompts are written and any required outputs are missing → status `awaiting_agent_results`
- If all required outputs present and validated → status `merging`
- If draft written and human review required → status `awaiting_human_review`
- If `perspectives.json` promoted + wave1 plan regenerated → status `promoted`

### Step 3 — Merge + promote into canonical `perspectives.json`

After all required model outputs exist, the tool deterministically:

1) merges candidates with stable rules
2) assigns stable IDs (`p1`, `p2`, …) with stable ordering
3) writes a draft (`operator/drafts/perspectives.draft.json`)
4) optionally halts for human review (interactive step with you)
5) calls `perspectives_write` to atomically write `<run_root>/perspectives.json`
6) calls `wave1_plan` to produce `wave-1/wave1-plan.json`

Hard requirement (engineer-deep review blocker): wave1 plan staleness must be mechanically enforceable.

Proposed addition to the wave1 plan artifact contract:
- `wave-1/wave1-plan.json` must include `perspectives_digest` (sha256 over canonicalized perspectives.json)
- Any wave1 execution path must fail fast if the digest does not match current perspectives.json

Stage exit (CANONICAL):
- On successful promotion + wave1 plan regeneration, `perspectives-draft` MUST stage-advance to `wave1` with a stage history entry.

At this point, perspectives planning becomes an **interactive process**:

- I propose a draft set of perspectives and rationale.
- You edit/approve.
- I write the approved result via `perspectives_write`.
- We regenerate `wave1_plan`.

### Step 4 — Iterate (repeatable)

Iteration is allowed because:
- `perspectives_write` is atomic and validated
- `wave1_plan` is deterministic given manifest+scope+perspectives

Rule: iterations must happen **before** Wave 1 outputs are produced.
If Wave 1 has already run, we either:
- start a new run_id, or
- explicitly clean wave-1 artifacts and regenerate plan (this should be a deliberate “dangerous” operation with explicit confirmation).

## 5) Multi-model “selective ensemble” design (ported conceptually)

We port the *architecture*, not the old env/API-key implementation.

### 5.1 Primary analyzer
One model produces the initial perspectives list with:
- domain classification
- confidence
- recommended agent_type
- platform requirements (if we include this)

### 5.2 Keyword sanity check (deterministic)
We maintain a deterministic keyword/domain check to detect obvious mismatches.

### 5.3 Selective ensemble triggers
Escalate to additional models only when:
- primary confidence below threshold, OR
- keyword mismatch, OR
- platform/tool policy ambiguity detected

### 5.3a Deterministic policy artifact (REQUIRED)

We must freeze thresholds + rounding + fallback rules as a per-run artifact so draft behavior is replayable.

Proposed artifact:
- `<run_root>/operator/config/perspectives-policy.json`

Minimum fields:
- `schema_version`: `perspectives-policy.v1`
- `primary_model_agent_type` (e.g. `claude-researcher`)
- `ensemble_models_agent_types[]` (e.g. `[gemini-researcher, perplexity-researcher]`)
- `confidence_thresholds`:
  - `ensemble_threshold`
  - `backup_threshold`
  - `mismatch_penalty`
  - `match_bonus`
- `max_perspectives`
- `track_allocation`:
  - target ratio `standard=0.50 independent=0.25 contrarian=0.25`
  - deterministic rounding rule: `largest_remainder_method`
- `partial_failure_policy`:
  - if a required ensemble model output missing/unparseable → fail closed and keep status `awaiting_agent_results`
  - never silently drop ensemble requirement (no “fail-open needsEnsemble=false”)

### 5.4 Track allocation (standard/independent/contrarian)

We explicitly assign `track` per perspective (required by `perspectives.v1`).

Carry-forward rule from prior system:
- 50% standard
- 25% independent
- 25% contrarian

This should be stable and deterministic given final perspective count.

## 6) Carry-forward requirements (blog series)

These become design requirements for the drafting step:

1) Perspectives must be **distinct angles** (no duplicates) and sufficiently specific.
2) Each perspective should include **platform requirements + rationale** (platform coverage enforcement).
3) Tool hierarchy should be explicit:
   - PRIMARY tools mandatory; if primary fails → stop + report gap (no silent substitution)
4) Coverage must be measured separately from “quality”.
5) Ensemble must be selective, not always-on.

## 7) Artifacts (proposed)

Under `<run_root>/operator/`:

- `prompts/perspectives/<model_or_step>.md`
- `outputs/perspectives/<model_or_step>.json` + `.meta.json`
- `drafts/perspectives.draft.json`
- `drafts/perspectives.merge-report.md`

Canonical:
- `<run_root>/perspectives.json` (written only via `perspectives_write`)
- `<run_root>/wave-1/wave1-plan.json` (regenerated on perspectives change)

## 8) Perspectives draft output contract (REQUIRED; removes implementation guesswork)

All perspective-draft agent outputs MUST conform to this schema, so that `agent-result --stage perspectives` can validate and normalize deterministically.

### 8.1 Raw agent output file
Path:
- `<run_root>/operator/outputs/perspectives/<source>.raw.json`

Contract:
- This file is stored verbatim and is NOT parsed for correctness.

### 8.2 Normalized draft output file (normative)
Path:
- `<run_root>/operator/outputs/perspectives/<source>.json`

Schema: `perspectives-draft-output.v1`

```json
{
  "schema_version": "perspectives-draft-output.v1",
  "run_id": "<run_id>",
  "source": {
    "agent_type": "<claude-researcher|gemini-researcher|perplexity-researcher|grok-researcher>",
    "label": "<freeform stable label, e.g. primary|ensemble-gemini>"
  },
  "candidates": [
    {
      "title": "<string>",
      "questions": ["<string>", "<string>"] ,
      "track": "standard|independent|contrarian",
      "recommended_agent_type": "<string>",
      "domain": "social_media|academic|technical|multimodal|security|news|unknown",
      "confidence": 0,
      "rationale": "<string>",
      "platform_requirements": [{ "name": "<string>", "reason": "<string>" }],
      "tool_policy": {
        "primary": ["<tool>"] ,
        "secondary": ["<tool>"],
        "forbidden": ["<tool>"]
      },
      "flags": {
        "human_review_required": false,
        "missing_platform_requirements": false,
        "missing_tool_policy": false
      }
    }
  ]
}
```

Validation rules:
- `confidence` MUST be an integer in `[0,100]`.
- `candidates[].track` MUST be present (no implicit track). If missing, set `flags.human_review_required=true` and default track to `standard`.
- If `platform_requirements` missing/empty, set `missing_platform_requirements=true` and `human_review_required=true`.
- If `tool_policy` missing/empty, set `missing_tool_policy=true` and `human_review_required=true`.
- If the normalized file fails schema validation, the ingest step FAILS CLOSED and the drafting state remains `awaiting_agent_results`.

## 9) Deterministic merge rules (minimum viable, but complete)

Input: N model outputs with candidate perspectives.

Rules:
1) Canonicalize text (trim, normalize whitespace).
2) Compute a stable candidate key per candidate:
   - `key = sha256(track + "\n" + normalized_title + "\n" + join(questions))`
3) Dedupe within the same track by key.
4) Cross-track near-duplicates:
   - If two candidates across different tracks share the same `normalized_title`, keep both ONLY if human explicitly approves; otherwise default to keeping the `standard` one.
   - Mark those candidates `human_review_required=true` in the draft.
5) Deterministic conflict resolution for the same key (same track):
   - `recommended_agent_type`: prefer the primary model’s value; else lexicographically smallest.
   - `domain`: prefer primary model; else `unknown`.
   - `platform_requirements` / `tool_policy`: union by unique name/tool string, stable sorted.
6) Stable sort final perspectives by (track weight, domain, title) and assign IDs `p1..pK`.
7) Persist merge decisions in a merge report artifact, including:
   - all candidate keys
   - winners/losers and tie-break reason codes
   - list of candidates requiring human approval

## 10) Validation contracts and gates

Hard gates (must pass):
- `validatePerspectivesV1(perspectives.json)` returns null
- perspective count <= `manifest.limits.max_wave1_agents`
- all `id` unique; all `title` non-empty; all prompt_contract fields present

Additional hard gates (REQUIRED for deep-research pipeline integrity):
- No silent substitution contract:
  - each perspective must include a tool policy block (PRIMARY/SECONDARY/FORBIDDEN) OR the drafting step must explicitly mark tool policy as `unassigned` and force human review.
- Coverage enforcement readiness:
  - each perspective must include a platform requirements list (may be empty only with explicit human override).

Soft checks (warnings):
- duplicate-ish titles
- track distribution deviates from 50/25/25 due to small N
- platform requirements empty (if we add them)

Gate definition (required checkpoint):
- **G-STAGE** (Mini-gate: stage + CLI preconditions align)
  - Must prove with entity tests that:
    - commands requiring `stage.current==perspectives` fail fast with a deterministic error code
    - commands that must work in `init` still work (e.g., init itself)
    - promotion path exits perspectives cleanly (stage history shows perspectives → wave1)

## 11) QA strategy (fixture-first determinism)

We will need:
- Entity tests for:
  - invalid perspective payloads (stable failure codes)
  - merge determinism (ordering independent)
  - wave1_plan regeneration when perspectives change
- Fixture bundle replay tests:
  - raw model outputs frozen → merged draft stable → promoted perspectives stable
- Smoke in runtime:
  - install to `~/.config/opencode`
  - run `bun "pai-tools/deep-research-option-c.ts" --help`
  - run a minimal init → draft perspectives prompts written

## 12) Implementation orchestration model (subagent-driven)

This plan assumes an orchestration pattern:

- **Marvin (main agent):** coordinates only, maintains progress tracker, requests gates.
- **Engineer/engineer-deep subagents:** implement exactly one extraction unit each (small diff + tests + clean working tree).
- **Architect gate:** PASS required after major contract changes (stage model + artifact contracts).
- **QA gate:** PASS required after tests + runtime install + runtime smoke.

Commit policy:
- commit-per-extraction is preferred to keep rollback cheap.

## 13) Progress tracking (REQUIRED for coordination)

Update this table after every extraction so it’s always clear what is implemented vs in progress vs waiting.

Status values: `TODO | IN_PROGRESS | BLOCKED | DONE`

| ID | Milestone | Status | Owner | Verification / Evidence |
|---:|---|---|---|---|
| M0 | Decisions frozen (Section 0) | DONE | Marvin | This section present in plan |
| M1 | Add manifest stage `perspectives` end-to-end | DONE | Eng | 35afff1; bun test entities: 172 pass/1 skip/0 fail; bun test .opencode/tests: 182 pass/1 skip/0 fail |
| M2 | CLI: `perspectives-draft` command (prompt-out + HALT) | DONE | Eng | d4e4975; entity test passes; bun test entities: 173 pass/1 skip/0 fail; bun test .opencode/tests: 183 pass/1 skip/0 fail |
| G-STAGE | Mini-gate: stage+CLI preconditions align | TODO | QA | stage precondition entity tests; clear error codes |
| M3 | CLI: `agent-result --stage perspectives` ingest | TODO | Eng | entity test: writes outputs + meta + digest match |
| M4 | Artifacts: `operator/state/perspectives-state.json` lifecycle | TODO | Eng | entity test: deterministic transitions |
| M5 | Artifacts: `operator/config/perspectives-policy.json` (defaults + overrides) | TODO | Eng | entity test: policy persisted + read |
| M6 | Merge + promote: `perspectives.json` + `wave1_plan` regen | TODO | Eng | entity test: perspectives_write + wave1_plan |
| M7 | Mechanical staleness: `perspectives_digest` in wave1-plan + fail-fast mismatch | TODO | Eng | entity test: stale plan fails |
| M8 | Wave1 prompts include platform + tool policy blocks | TODO | Eng | snapshot test of prompt_md |
| M9 | Skill UX: update deep-research SKILL.md + workflows | TODO | Writer/Eng | manual review + link checks |
| G-ARCH | Architect PASS (implementation) | TODO | Architect | review report |
| G-QA | QA PASS (tests + runtime install + runtime smoke) | TODO | QA | test outputs + install output |

## 14) UX / Skill workflow requirements (REQUIRED for end-to-end usability)

This feature is only “done” when the *canonical operator surface* (the `deep-research` skill) leads you through an end-to-end run.

### 14.1 Update canonical skill entrypoint

Target (canonical):
- `.opencode/skills/deep-research/SKILL.md`

Required updates:
- Add a clear “Perspective Drafting” subsection explaining:
  - why the default `init` should be invoked with `--no-perspectives`
  - that perspectives are drafted interactively (you ↔ me) and then persisted via `perspectives_write`
  - that `wave1_plan` MUST be regenerated after any perspectives change

### 14.2 Update/create workflows so the happy path is explicit

Workflows to update (or create if missing) inside canonical skill:
- `Workflows/DraftPerspectivesFromQuery.md`
  - Must become the canonical “how perspectives are created” doc.
  - Must be updated to use the runtime path: `bun "pai-tools/deep-research-option-c.ts" ...`
  - Must include the new tool seam once implemented (prompt-out → RUN_AGENT_REQUIRED → agent-result ingest).

- `Workflows/RunPlan.md` and/or `Workflows/RunWave1WithTaskDriver.md`
  - Must explicitly link to the drafting workflow as a required prerequisite unless perspectives already exist.
  - Must include a short decision: reuse existing `perspectives.json` vs draft new vs edit+promote.

### 14.3 Maintain compatibility stubs without confusing UX

Compatibility skills (`deep-research-option-c`, `deep-research-production`) should:
- remain stubs/aliases
- clearly point to the canonical skill
- avoid duplicating full operator UX (to prevent divergence)

### 14.4 End-to-end UX acceptance criteria

Acceptance criteria for usability (binary, end-to-end):
1) Starting from the canonical skill docs alone, you can:
   - init a run
   - draft/iterate perspectives interactively
   - generate a wave1 plan
   - proceed into Wave 1 task-driver execution
2) At every “stop and do something” point, the workflow provides:
   - the exact runtime command to run next
   - what artifact should appear
   - how to verify it quickly

## 15) Review gates (definition of DONE)

This plan is not considered “accepted” until:
- Architect review: PASS
- engineer-deep (research pipeline specialist) review: PASS

The implementation is not considered “done” until:
- Architect review: PASS (post-implementation)
- QA review: PASS (tests + runtime install + runtime smoke)
