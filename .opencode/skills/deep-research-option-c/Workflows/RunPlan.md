# RunPlan Workflow

Create a deterministic run root, produce the Wave 1 plan artifact, and stop at `stage.current=wave1`.

## Inputs

- Query string
- Optional: `--run-id`, `--mode quick|standard|deep`, `--sensitivity normal|restricted|no_web`

## Steps

1. Initialize run:

```bash
bun "Tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity no_web
```

2. Confirm required artifacts under `run_root`:
   - `manifest.json`
   - `gates.json`
   - `perspectives.json`
   - `wave-1/wave1-plan.json`

The `init` command now performs this deterministic sequence:

1. `run_init`
2. `perspectives_write`
3. `wave1_plan`
4. `stage_advance` with `requested_next=wave1` using `gates_path`

No environment variables are required for this transition.

## Validation Contract

- [ ] `manifest.json` exists and parses as object.
- [ ] `gates.json` exists and parses as object.
- [ ] `perspectives.json` exists.
- [ ] `wave-1/wave1-plan.json` contains `inputs_digest`.
- [ ] `manifest.stage.current` equals `wave1` after `init`.

## Notes

- Keep temporary investigation files in scratchpad, never in repo.
- Do not rely on env vars; pass all run controls via CLI flags.
