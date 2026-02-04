TraceRawSession

Read-only diagnostic tool for `MEMORY/RAW/*/*.jsonl` sessions.

Usage:

- `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/TraceRawSession.ts ses_...`
- `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/TraceRawSession.ts --latest`

Options:

- `--tail 80` show more timeline events
- `--json` output JSON summary
