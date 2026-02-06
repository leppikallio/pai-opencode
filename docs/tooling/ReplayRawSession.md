# ReplayRawSession

Offline normalization and “replay” analysis for `MEMORY/RAW/*/*.jsonl`.

**Source:** `.opencode/skills/PAI/Tools/ReplayRawSession.ts`

## Usage

Analyze a specific session:

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts" \
  ses_...
```

Analyze latest session:

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts" \
  --latest
```

Write normalized jsonl:

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts" \
  --latest --out /tmp/pai-normalized.jsonl
```

## Options

- `--json` output JSON summary
- `--max 50` increase sample size
