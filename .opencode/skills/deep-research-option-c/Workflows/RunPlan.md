# RunPlan Workflow

Create a deterministic run root and stop at `stage=wave1`.

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

## Validation Contract

- [ ] `manifest.json` exists and parses as object.
- [ ] `gates.json` exists and parses as object.
- [ ] `perspectives.json` exists.
- [ ] `wave-1/wave1-plan.json` contains `inputs_digest`.

## Notes

- Keep temporary investigation files in scratchpad, never in repo.
- Do not rely on env vars; pass all run controls via CLI flags.
