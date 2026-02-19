# RunFixtureToFinalize Workflow

Execute deterministic fixture progression end-to-end until terminal state.

## Inputs

- Query string
- Optional: `--run-id`

## Steps

1. Initialize fixture run:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --sensitivity no_web --mode standard
```

2. Advance with fixture driver until stop:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" run --manifest "<manifest_abs>" --gates "<gates_abs>" --reason "fixture finalize" --driver fixture --max-ticks 30
```

3. If blocked, inspect + triage:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --manifest "<manifest_abs>"
```

## Validation Contract

- [ ] CLI exits code 0.
- [ ] `manifest.status` is `completed`.
- [ ] `manifest.stage.current` is `finalize`.

## Notes

- Store operator notes in scratchpad only.
- Do not require env vars; use CLI flags and manifest artifacts.
