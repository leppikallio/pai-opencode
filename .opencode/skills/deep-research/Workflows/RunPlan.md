# RunPlan Workflow

Create a deterministic run root, produce the Wave 1 plan artifact, and stop at `stage.current=wave1`.

## Inputs

- Query string
- Optional: `--run-id`, `--mode quick|standard|deep`, `--sensitivity normal|restricted|no_web`

## Choose CLI invocation

```bash
# Repo checkout (this repository)
CLI='bun .opencode/pai-tools/deep-research-cli.ts'
# Runtime install (~/.config/opencode)
# CLI='bun pai-tools/deep-research-cli.ts'
```

## Steps

1. Initialize run:

```bash
$CLI init "<query>" --mode standard --sensitivity no_web
```

> This workflow assumes you **do not** pass `--no-perspectives`.
> If you want the perspectives drafting seam (`perspectives-draft`), use `init --no-perspectives` and follow `DraftPerspectivesFromQuery.md`.

2. Confirm required artifacts using the printed contract fields:
   - `manifest_path`
   - `gates_path`
   - `run_root`
   - `perspectives_path` (printed)
   - `wave1_plan_path` (printed)

When perspectives are written (i.e., `init` without `--no-perspectives`), the CLI performs this deterministic sequence:

1. `run_init`
2. `perspectives_write`
3. `wave1_plan`
4. `stage_advance` with `requested_next=wave1` using `gates_path`

No environment variables are required for this transition.

## Validation Contract

- [ ] The printed `manifest_path` exists and parses as JSON object.
- [ ] The printed `gates_path` exists and parses as JSON object.
- [ ] The printed `perspectives_path` exists.
- [ ] The printed `wave1_plan_path` points to an existing file and its JSON contains `inputs_digest`.
- [ ] The Wave 1 plan JSON includes `perspectives_digest`.
- [ ] `manifest.stage.current` equals `wave1` after `init` (only when not using `--no-perspectives`).

## Notes

- Keep temporary investigation files in scratchpad, never in repo.
- Do not rely on env vars; pass all run controls via CLI flags.
