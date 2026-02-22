# Workflow: DraftPerspectivesFromQuery

Derive a stable `perspectives.json` from a query so Wave 1 can run deterministically.

This is the default LLM-seam path after `Workflows/InitIntake.md`.

## Inputs

- Query text
- `run_id`
- `run_root`
- Wave cap from `manifest.limits.max_wave1_agents`

## CLI command forms (copy/paste)

```bash
# Repo checkout (this repository)
bun ".opencode/pai-tools/deep-research-cli.ts" <command> [flags]
```

```bash
# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" <command> [flags]
```

## Stability rules (required)

- Perspective IDs must be unique and deterministic (`p1`, `p2`, ... in final order).
- Ordering must be stable across reruns for the same intent.
- Keep one perspective per concern; avoid overlapping scopes.

## Required perspective contract fields

Each perspective entry must include:

- `id`
- `title`
- `track`
- `agent_type`
- `prompt_contract.max_words`
- `prompt_contract.max_sources`
- `prompt_contract.tool_budget.search_calls`
- `prompt_contract.tool_budget.fetch_calls`
- `prompt_contract.must_include_sections`

## Required heading policy

Set `prompt_contract.must_include_sections` with explicit headings expected in outputs.

Minimum baseline:

- `Findings`
- `Sources`
- `Gaps`

## Steps

1) Initialize a run (seam-first default, so you can enter the perspectives drafting seam):

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --run-id "<run_id>" \
  --json

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --run-id "<run_id>" \
  --json
```

`--no-perspectives` remains supported for explicitness/back-compat, but is no longer required.

2) Advance into `stage.current=perspectives`:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting"

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting"
```

3) Run the task-driver prompt-out command (this **writes ensemble prompts and HALTs**):

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task
```

On halt (`RUN_AGENT_REQUIRED`), use these artifact paths:

- Prompts to execute: `<run_root>/operator/prompts/perspectives/*.md`
- Raw agent output path (you create for each perspective):
  `<run_root>/operator/outputs/perspectives/<perspective_id>.raw.json`

4) Produce one JSON output per required perspective (no surrounding markdown), each matching schema `perspectives-draft-output.v1`.

5) Ingest each output (normalizes + writes canonical sidecars):

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage perspectives \
  --perspective "<perspective_id>" \
  --input "<run_root>/operator/outputs/perspectives/<perspective_id>.raw.json" \
  --agent-run-id "<agent_run_id_for_perspective>" \
  --reason "operator: ingest perspectives/<perspective_id>"

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage perspectives \
  --perspective "<perspective_id>" \
  --input "<run_root>/operator/outputs/perspectives/<perspective_id>.raw.json" \
  --agent-run-id "<agent_run_id_for_perspective>" \
  --reason "operator: ingest perspectives/<perspective_id>"
```

This writes for each `<perspective_id>`:

- `<run_root>/operator/outputs/perspectives/<perspective_id>.raw.json` (raw; verbatim)
- `<run_root>/operator/outputs/perspectives/<perspective_id>.json` (normalized)
- `<run_root>/operator/outputs/perspectives/<perspective_id>.meta.json` (`schema_version=agent-result-meta.v1`)

6) Rerun `perspectives-draft` to merge + (possibly) halt for human review, or auto-promote:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "approve perspectives draft" \
  --driver task

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "approve perspectives draft" \
  --driver task
```

On the happy path, this will:

- Write `<run_root>/operator/drafts/perspectives.draft.json`
- Promote `<run_root>/perspectives.json`
- Regenerate the Wave 1 plan
- Stage-advance to `stage.current=wave1`

### Post-promotion interactive perspective curation (LLM-driven)

After `<run_root>/perspectives.json` exists, run an interactive curation checkpoint with `functions.question` before continuing Wave 1.

Use defaults-first ordering for quick operation:

- Keep all existing perspectives (recommended default)
- Add no additional perspectives (recommended default)
- Rebalance tracks deterministically (recommended default)

#### 1) Read current perspectives

- Read `<run_root>/perspectives.json`.
- Build the current ordered list as `[p1, p2, ...]` using each perspective `id` + `title`.

#### 2) Ask which existing perspectives to keep

Use `functions.question` and include a multi-select list for existing perspectives (`multiple: true`):

- Keep mode question:
  - `Keep all existing`
  - `Select subset`
- Keep subset question (multi-select; options are existing perspectives in current order)

Application rule:

- If keep mode is `Keep all existing`, keep every current perspective.
- If keep mode is `Select subset`, keep exactly the selected IDs and preserve their relative order from the original file.

#### 3) Ask whether to add perspectives

Use `functions.question`:

- `Add none`
- `Add one`
- `Add multiple`

If add count is not none, collect each new perspective with guided follow-up `functions.question` prompts (one perspective at a time, in user-provided order):

1. **Title** (free text)
2. **Platform requirements** (multi-select, `multiple: true`, must select 1–3 from allowlist only):
   - `x`, `linkedin`, `bluesky`, `github`, `reddit`, `arxiv`, `youtube`, `hackernews`
3. **Tool policy**:
   - `Default primary includes websearch`
   - `Custom tool policy`
4. **Agent type**:
   - `researcher`
   - `Custom agent type`

Deterministic follow-ups for custom branches:

- If **Tool policy** is `Custom tool policy`, ask these fixed-choice follow-ups (in order):
  1. `Primary tools (1-3)` (`multiple: true`) from allowlist:
     - `websearch`, `webfetch`, `research-shell_perplexity_search`, `research-shell_gemini_search`, `research-shell_grok_search`, `apify_apify-slash-rag-web-browser`, `brightdata_search_engine`, `brightdata_scrape_as_markdown`
  2. `Secondary tools (0-3)` (`multiple: true`) from the same allowlist
  3. `Forbidden tools (0-3)` (`multiple: true`) from the same allowlist
- Validation for custom tool policy:
  - Normalize every selected/typed value: trim, collapse internal whitespace, lowercase.
  - Accept only allowlisted values; otherwise re-ask the same follow-up question.
  - Reject duplicates and cross-bucket overlap (`primary`, `secondary`, `forbidden`); re-ask offending follow-up.
  - Require `primary` to contain 1-3 values.
- If **Agent type** is `Custom agent type`, ask a fixed-choice follow-up built from available `functions.task` subagent types (`multiple: false`), sorted deterministically case-insensitive lexical before prompting.
- Validation for custom agent type:
  - Normalize selected/typed value: trim, collapse internal whitespace, lowercase.
  - Accept only values present in the current subagent allowlist; otherwise re-ask.
  - Persist the canonical cased subagent type value.

#### 3a) Question-tool determinism for fixed-choice prompts

Apply this rule to every fixed-choice `functions.question` in this workflow (keep mode, add mode, platform requirements, tool policy mode, agent type mode, track policy, and custom follow-ups):

1. Build a canonical allowlist from option labels for that question.
2. Normalize selected/typed answers with: trim, collapse internal whitespace, lowercase.
3. Accept only normalized values present in the normalized allowlist.
4. If any value is outside allowlist, re-ask the same question (do not continue with partial state).
5. Bounded retry policy: re-ask at most 2 times for the same invalid answer path.
   - If the question has deterministic options, select the first listed option after max retries.
   - If no safe deterministic fallback exists, abort explicitly and request operator intervention.

#### 4) Ask track handling policy

Use `functions.question`:

- `Rebalance tracks 50/25/25`
- `Preserve existing tracks`

#### 5) Apply changes deterministically

1. Start with kept existing perspectives in preserved relative order.
2. Append new perspectives in the exact order provided by the operator.
3. Renumber IDs deterministically to `p1..pN` in final list order.
4. Assign tracks:
   - Default: assign all tracks using deterministic `standard=50%`, `independent=25%`, `contrarian=25%` via largest remainder method.
   - Largest-remainder tie-break is deterministic: if remainders tie, allocate in order `standard`, then `independent`, then `contrarian`.
   - Preserve option: keep selected existing tracks unchanged; assign tracks only for additions deterministically.
5. For every new perspective, apply safe defaults:
   - `prompt_contract`: copy from existing `p1` when available; otherwise use standard drafting defaults.
   - `tool_policy`: default primary includes `websearch`.
   - `platform_requirements`: must remain 1–3 allowlisted platforms.
   - `agent_type`: default `researcher`.

#### 6) Persist and regenerate plan

- Persist updated perspectives by calling tool `deep_research_cli_perspectives_write` (validation + audit):
  - `perspectives_path`: `<run_root>/perspectives.json`
  - `reason`: e.g. `"operator: post-promotion perspective curation"`
- Then regenerate Wave 1 plan via tool `deep_research_cli_wave1_plan`:
  - `manifest_path`: `<manifest_abs>`
  - `perspectives_path`: `<run_root>/perspectives.json`
  - `reason`: e.g. `"operator: regenerate wave1 plan after curation"`
- Continue Wave 1 only after both tool calls succeed.

7) Continue with Wave 1:

- RunWave1WithTaskDriver.md

## Artifacts (new/important)

- `<run_root>/operator/state/perspectives-state.json`
- `<run_root>/operator/config/perspectives-policy.json`
- `<run_root>/operator/drafts/perspectives.draft.json`

## Staleness guard (Wave 1)

If Wave 1 fails with `WAVE1_PLAN_STALE`, regenerate the Wave 1 plan by re-running this workflow (do not keep executing a stale plan).

## Validation contract

- [ ] `stage-advance --requested-next perspectives` succeeds and `manifest.stage.current == perspectives`.
- [ ] `perspectives-draft --driver task` writes one or more prompts under `<run_root>/operator/prompts/perspectives/*.md` and halts with `RUN_AGENT_REQUIRED`.
- [ ] Each `*.raw.json` parses as JSON and `schema_version == perspectives-draft-output.v1`.
- [ ] One `agent-result --stage perspectives` call is executed per required perspective (as indicated by `halt.next_commands[]`).
- [ ] For each required perspective, `agent-result` writes:
  - `<run_root>/operator/outputs/perspectives/<perspective_id>.raw.json`
  - `<run_root>/operator/outputs/perspectives/<perspective_id>.json`
  - `<run_root>/operator/outputs/perspectives/<perspective_id>.meta.json` with `schema_version == agent-result-meta.v1`
- [ ] Second `perspectives-draft` run writes `perspectives.json` with `schema_version == perspectives.v1`.
- [ ] After promotion, Wave 1 plan exists (printed by CLI) and `manifest.stage.current == wave1`.
