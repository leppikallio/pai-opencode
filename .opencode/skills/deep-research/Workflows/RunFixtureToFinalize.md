# RunFixtureToFinalize Workflow

Execute deterministic fixture progression end-to-end until terminal state.

## Inputs

- Query string
- Optional: `--run-id`

## Choose CLI invocation

```bash
# Repo checkout (this repository)
CLI='bun .opencode/pai-tools/deep-research-cli.ts'
# Runtime install (~/.config/opencode)
# CLI='bun pai-tools/deep-research-cli.ts'
```

## Steps

1. Initialize fixture run:

```bash
$CLI init "<query>" --sensitivity no_web --mode standard
```

2. Advance with fixture driver until stop:

```bash
$CLI run --manifest "<manifest_abs>" --gates "<gates_abs>" --reason "fixture finalize" --driver fixture --max-ticks 30
```

3. If blocked, inspect + triage:

```bash
$CLI inspect --manifest "<manifest_abs>"
```

## Validation Contract

- [ ] CLI exits code 0.
- [ ] `manifest.status` is `completed`.
- [ ] `manifest.stage.current` is `finalize`.

## Notes

- Store operator notes in scratchpad only.
- Do not require env vars; use CLI flags and manifest artifacts.
