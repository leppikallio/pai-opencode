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
