# ResumeRun Workflow

Resume a paused Option C run and restore watchdog timing semantics.

## Inputs

- `manifest` absolute path
- Optional resume reason

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

1. Resume:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" resume --manifest "<manifest_abs>" --reason "operator resume"

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" resume --manifest "<manifest_abs>" --reason "operator resume"
```

2. Verify a resume checkpoint was written (the CLI prints the checkpoint path) and the run can continue normally.

## Validation Contract

- [ ] `manifest.status` is `running`.
- [ ] `manifest.stage.started_at` is refreshed.
- [ ] A resume checkpoint exists (the CLI prints the checkpoint path) and includes stage + reason.

## Notes

- Keep temporary investigation notes in scratchpad only.
- No manual env var setup is required.
