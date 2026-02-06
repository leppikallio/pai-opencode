# VerifyMemoryWiring

Read-only verification that OpenCode PAI session artifacts are being written to `MEMORY/`.

**Source:** `.opencode/skills/PAI/Tools/VerifyMemoryWiring.ts`

## Usage

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/VerifyMemoryWiring.ts" \
  ses_...
```

Latest session:

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/VerifyMemoryWiring.ts" \
  --latest
```

## What it checks

- **Required:** RAW jsonl + WORK dir + `THREAD.md` + `ISC.json` + `META.yaml`
- **Optional:** SECURITY jsonl, LEARNING dir

## Exit codes

- `0` success
- `1` usage error
- `2` missing artifacts
