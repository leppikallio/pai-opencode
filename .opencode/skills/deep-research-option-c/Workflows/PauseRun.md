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

2. Confirm checkpoint artifact exists under run logs.

## Validation Contract

- [ ] `manifest.status` is `paused`.
- [ ] `logs/pause-checkpoint.md` exists.
- [ ] Checkpoint includes stage and reason.

## Notes

- Do not create temporary pause notes in repo; use scratchpad.
- No env var setup required.
