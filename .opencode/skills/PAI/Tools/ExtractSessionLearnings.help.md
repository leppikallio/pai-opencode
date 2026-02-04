ExtractSessionLearnings

Manual, loop-safe extraction of learnings from `MEMORY/WORK` into `MEMORY/LEARNING`.

Usage:

- Print extracted learnings:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts ses_...`

- Persist learnings to MEMORY/LEARNING:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts ses_... --persist`

- Use latest session:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts --latest --persist`

Options:

- `--json` output JSON
- `--include-markers` also scan for "Learning:"/"Key insight:" markers (noisier)
