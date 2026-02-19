# RunLiveWave1ToPivot Workflow

Run live Wave 1 collection and stop when the run reaches `stage.current=pivot`.

## Inputs

- Query string
- Optional: `--run-id`

## Steps

1. Initialize run:

```bash
bun "pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
```

2. Execute Wave 1 autonomously (Option A: Task-backed driver) until the run reaches `stage.current: pivot`.

Preferred operator surface: `/deep-research live "<query>"` (see `../../../commands/deep-research.md`).

If you must use the CLI directly, do NOT use the operator-input driver loop. Instead, use the deterministic tools + Task spawning described in the command doc, then advance stage.

Notes:
- The CLI `--driver live` path is **operator-input/manual** by default.
- The autonomous Option A driver is executed by me (Marvin) using `functions.task` and deterministic deep-research tools.

3. If progress stalls, inspect blockers:

```bash
bun "pai-tools/deep-research-option-c.ts" triage --manifest "<manifest_abs>"
```

## Validation Contract

- [ ] The printed `wave1_plan_path` exists.
- [ ] Every planned perspective has an ingested wave output artifact (paths are inside `run_root` and produced by the CLI).
- [ ] A wave review artifact exists and reports `decision=PASS` with no retry directives.
- [ ] The printed `gates_path` has `gates.B.status=pass`.
- [ ] `manifest.stage.current` advanced to `pivot`.

## Per-perspective artifact contract (autonomous Option A target)

- [ ] `operator/prompts/<stage>/<perspective_id>.md` exists.
- [ ] `operator/outputs/<stage>/<perspective_id>.md` exists.
- [ ] `operator/outputs/<stage>/<perspective_id>.meta.json` exists and includes:
  - `agent_run_id`
  - `prompt_digest`
  - `retry_directives_digest` (`null` when no retry)
  - `started_at`
  - `finished_at`

## Notes

- Keep operator notes in scratchpad only.
- Use env vars only for explicit enablement (`PAI_DR_OPTION_C_ENABLED=1`). Pass other controls via CLI flags.
