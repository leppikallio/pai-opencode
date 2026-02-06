# LearningPatternSynthesis

Aggregates `MEMORY/LEARNING/SIGNALS/ratings.jsonl` into recurring patterns and writes a synthesis report.

**Source:** `.opencode/skills/PAI/Tools/LearningPatternSynthesis.ts`

## Usage

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/LearningPatternSynthesis.ts" \
  --week
```

## Commands

- `--week` analyze last 7 days (default)
- `--month` analyze last 30 days
- `--all` analyze all ratings
- `--dry-run` show analysis without writing

## Output

Writes a report under:

`MEMORY/LEARNING/SYSTEM/<date>_pattern-synthesis_<period>.md`
