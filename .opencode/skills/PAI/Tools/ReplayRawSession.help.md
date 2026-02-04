ReplayRawSession

Offline normalization and “replay” analysis for `MEMORY/RAW/*/*.jsonl`.

Usage:

- Analyze a session:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts ses_...`

- Analyze latest:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts --latest`

- Write normalized jsonl:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts --latest --out /tmp/pai-normalized.jsonl`

Options:

- `--json` output JSON summary
- `--max 50` increase sample size
