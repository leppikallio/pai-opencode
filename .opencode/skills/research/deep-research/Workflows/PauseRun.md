# PauseRun Workflow

Safely pause a long-running Option C run.

## Inputs

- `manifest` absolute path
- Optional pause reason

## CLI command forms (copy/paste)

```bash
# Repo checkout (this repository)
bun ".opencode/pai-tools/deep-research-cli.ts" <command> [flags]
```

```bash
# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" <command> [flags]
```

## Steps

1. Pause:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" pause --manifest "<manifest_abs>" --reason "operator pause"

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" pause --manifest "<manifest_abs>" --reason "operator pause"
```

2. Confirm a pause checkpoint was written (the CLI prints the checkpoint path) and includes restart guidance.

## Validation Contract

- [ ] `manifest.status` is `paused`.
- [ ] A pause checkpoint exists (the CLI prints the checkpoint path).
- [ ] Checkpoint includes stage, reason, and `next_step` resume guidance.

## Notes

- Do not create temporary pause notes in repo; use scratchpad.
- No env var setup required.
