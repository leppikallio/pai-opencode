# Workflow: DraftPerspectivesFromQuery

Derive a stable `perspectives.json` from a query so Wave 1 can run deterministically.

## Inputs

- Query text
- `run_id`
- `run_root`
- Wave cap from `manifest.limits.max_wave1_agents`

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

1) Initialize a run **without** perspectives (so you can enter the perspectives drafting seam):

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --no-perspectives
```

2) Advance into `stage.current=perspectives`:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting"
```

3) Run the task-driver prompt-out command (this **writes prompts and HALTs**):

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task
```

On halt (`RUN_AGENT_REQUIRED`), use these artifact paths:

- Prompt to execute: `<run_root>/operator/prompts/perspectives/primary.md`
- Raw agent output path (YOU create): `<run_root>/operator/outputs/perspectives/primary.raw.json`

4) Produce the JSON output (no surrounding markdown) matching schema `perspectives-draft-output.v1`.

5) Ingest it (normalizes + writes canonical sidecars):

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage perspectives \
  --perspective "primary" \
  --input "<run_root>/operator/outputs/perspectives/primary.raw.json" \
  --agent-run-id "<agent_run_id>" \
  --reason "operator: ingest perspectives/primary"
```

This writes:

- `<run_root>/operator/outputs/perspectives/primary.raw.json` (raw; verbatim)
- `<run_root>/operator/outputs/perspectives/primary.json` (normalized)
- `<run_root>/operator/outputs/perspectives/primary.meta.json` (`schema_version=agent-result-meta.v1`)

6) Rerun `perspectives-draft` to merge + (possibly) halt for human review, or auto-promote:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" perspectives-draft \
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
- [ ] `perspectives-draft --driver task` writes `<run_root>/operator/prompts/perspectives/primary.md` and halts with `RUN_AGENT_REQUIRED`.
- [ ] `primary.raw.json` parses as JSON and `schema_version == perspectives-draft-output.v1`.
- [ ] `agent-result --stage perspectives` writes:
  - `<run_root>/operator/outputs/perspectives/primary.raw.json`
  - `<run_root>/operator/outputs/perspectives/primary.json`
  - `<run_root>/operator/outputs/perspectives/primary.meta.json` with `schema_version == agent-result-meta.v1`
- [ ] Second `perspectives-draft` run writes `perspectives.json` with `schema_version == perspectives.v1`.
- [ ] After promotion, Wave 1 plan exists (printed by CLI) and `manifest.stage.current == wave1`.
