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
- `--mode standard`
- `--sensitivity normal`

## Exact next commands sequence (repo path form)

1) Init the run at the LLM drafting seam:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" init "<query>" --mode standard --sensitivity normal --json

# Optional reproducible override:
#   --run-id "<run_id>"
```

`init` is seam-first by default. Add `--with-perspectives` only for the legacy fast path (`init -> wave1` in one command).

`<manifest_abs>` and `<gates_abs>` in subsequent commands come from init output:

- Printed contract fields: `manifest_path`, `gates_path`
- Or the `init --json` envelope: `contract.manifest_path`, `contract.gates_path`

2) Advance to perspectives:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting" \
  --json
```

3) Generate ensemble perspective prompts:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task \
  --json
```

## Handling custom free-text answers from `functions.question`

For option prompts where `custom` is enabled:

- `mode`: normalize custom text and map only if it matches allowed values (`quick`, `standard`, `deep`).
- `sensitivity`: normalize custom text and map only if it matches allowed values (`normal`, `restricted`, `no_web`).
- If a custom mode/sensitivity answer does not map cleanly, re-ask with allowed values.

For `run-id` / `runs-root` overrides:

- First ask whether to keep defaults or override.
- If override is chosen (or typed), issue a follow-up `functions.question` to collect the exact string value.
- Treat the follow-up custom text as the literal value for `--run-id` / `--runs-root`; if empty, re-ask.

## Expected seam behavior

- `perspectives-draft --driver task --json` halts with `RUN_AGENT_REQUIRED`.
- Prompt files are written under `<run_root>/operator/prompts/perspectives/`.
- Ingest each required result with one `agent-result` call per perspective (from `halt.next_commands[]`).
