# RunLiveWave1ToPivot Workflow

Run live Wave 1 collection and stop when the run reaches `stage.current=pivot`.

## Inputs

- Query string
- Optional: `--run-id`

## Steps

1. Initialize run:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
```

2. Execute Wave 1 autonomously (Option A: Task-backed driver) until the run reaches `stage.current: pivot`.

Use the task-driver loop documented in:

- `.opencode/skills/deep-research/Workflows/RunWave1WithTaskDriver.md`

Notes:
- The CLI `--driver live` path is **operator-input/manual** by default.
- The task-driver loop (`tick --driver task` + `agent-result`) is non-blocking and produces canonical Wave 1 artifacts.

3. If progress stalls, inspect blockers:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<manifest_abs>"
```

## Validation Contract

- [ ] The printed `wave1_plan_path` exists.
- [ ] Every planned perspective has an ingested wave output artifact (paths are inside `run_root` and produced by the CLI).
- [ ] A wave review artifact exists and reports `decision=PASS` with no retry directives.
- [ ] The printed `gates_path` has `gates.B.status=pass`.
- [ ] `manifest.stage.current` advanced to `pivot`.

## Per-perspective artifact contract (autonomous Option A target)

- [ ] `operator/prompts/<stage>/<perspective_id>.md` exists.
- [ ] `wave-1/<perspective_id>.md` exists.
- [ ] `wave-1/<perspective_id>.meta.json` exists and includes:
  - `schema_version=wave-output-meta.v1`
  - `agent_run_id`
  - `prompt_digest`
  - `ingested_at`

## Notes

- Keep operator notes in scratchpad only.
- No env vars required; use CLI flags and run artifacts.
