# TraceRawSession

Read-only diagnostic tool for `MEMORY/RAW/*/*.jsonl` sessions.

**Source:** `.opencode/skills/PAI/Tools/TraceRawSession.ts`

## Usage

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/TraceRawSession.ts" \
  ses_...
```

Latest session:

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/TraceRawSession.ts" \
  --latest
```

## Options

- `--tail 80` show more timeline events
- `--json` output a JSON summary
