# ResumeRun Workflow

Resume a paused Option C run and restore watchdog timing semantics.

## Inputs

- `manifest` absolute path
- Optional resume reason

## Steps

1. Resume:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" resume --manifest "<manifest_abs>" --reason "operator resume"
```

2. Verify a resume checkpoint was written (the CLI prints the checkpoint path) and the run can continue normally.

## Validation Contract

- [ ] `manifest.status` is `running`.
- [ ] `manifest.stage.started_at` is refreshed.
- [ ] A resume checkpoint exists (the CLI prints the checkpoint path) and includes stage + reason.

## Notes

- Keep temporary investigation notes in scratchpad only.
- No manual env var setup is required.
