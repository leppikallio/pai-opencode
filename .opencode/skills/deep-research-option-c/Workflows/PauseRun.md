# PauseRun Workflow

Safely pause a long-running Option C run.

## Inputs

- `manifest` absolute path
- Optional pause reason

## Steps

1. Pause:

```bash
bun "Tools/deep-research-option-c.ts" pause --manifest "<manifest_abs>" --reason "operator pause"
```

2. Confirm checkpoint artifact exists under run logs and includes restart guidance.

## Validation Contract

- [ ] `manifest.status` is `paused`.
- [ ] `logs/pause-checkpoint.md` exists.
- [ ] Checkpoint includes stage, reason, and `next_step` resume guidance.

## Notes

- Do not create temporary pause notes in repo; use scratchpad.
- No env var setup required.
