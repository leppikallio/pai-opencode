# ResumeRun Workflow

Resume a paused Option C run and restore watchdog timing semantics.

## Inputs

- `manifest` absolute path
- Optional resume reason

## Steps

1. Resume:

```bash
bun "Tools/deep-research-option-c.ts" resume --manifest "<manifest_abs>" --reason "operator resume"
```

2. Verify run can continue with normal tick flow.

## Validation Contract

- [ ] `manifest.status` is `running`.
- [ ] `manifest.stage.started_at` is refreshed.
- [ ] `logs/resume-checkpoint.md` exists and includes stage + reason.

## Notes

- Keep temporary investigation notes in scratchpad only.
- No manual env var setup is required.
