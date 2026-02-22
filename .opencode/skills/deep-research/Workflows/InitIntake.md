# Workflow: InitIntake

Canonical init intake for the **default operator happy path**: LLM drafting seam for perspectives.

## Required operator input

- `query`

## Optional overrides

- `mode` (default: `standard`)
- `sensitivity` (default: `normal`)
- `run-id` (recommended for reproducibility)
- `runs-root` (optional custom runs root)

## LLM-driven defaults

Use these defaults unless you explicitly need an override:

- `--json`
- `--no-perspectives`
- `--mode standard`
- `--sensitivity normal`

## Exact next commands sequence (repo path form)

1) Init the run at the LLM drafting seam:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" init "<query>" --mode standard --sensitivity normal --run-id "<run_id>" --no-perspectives --json
```

2) Advance to perspectives:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting"
```

3) Generate ensemble perspective prompts:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task
```

## Expected seam behavior

- `perspectives-draft --driver task` halts with `RUN_AGENT_REQUIRED`.
- Prompt files are written under `<run_root>/operator/prompts/perspectives/`.
- Ingest each required result with one `agent-result` call per perspective (from `halt.next_commands[]`).
