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

1. Initialize run and capture contract fields:

```bash
bun "pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
```

2. Draft perspective entries in scratchpad, then write the final artifact to run root:
   - `<run_root>/perspectives.json`

3. Persist via `deep_research_perspectives_write` using that absolute path.

4. Regenerate Wave 1 plan to lock deterministic ordering:
   - run `deep_research_wave1_plan` with `manifest_path`.

## Validation contract

- [ ] `perspectives.json` `schema_version` is exactly `perspectives.v1`.
- [ ] All perspective `id` values are unique.
- [ ] Perspective count is `<= manifest.limits.max_wave1_agents`.
- [ ] Every perspective has `prompt_contract.tool_budget` and `must_include_sections`.
- [ ] Every perspective includes required headings (`Findings`, `Sources`, `Gaps`) in `must_include_sections`.
