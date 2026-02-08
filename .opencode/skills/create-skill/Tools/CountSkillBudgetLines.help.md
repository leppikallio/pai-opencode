# CountSkillBudgetLines

Counts “budget lines” in a `SKILL.md` file.

## Budget lines rule (procedural default)

- Count all lines (including YAML frontmatter and blanks)
- EXCEPT: exclude the `## Examples` section (heading + body)
  - section starts at `## Examples`
  - section ends immediately before the next `## <Heading>` line (or end-of-file)

## Usage

```bash
bun "/Users/zuul/.config/opencode/skills/create-skill/Tools/CountSkillBudgetLines.ts" \
  --file "/Users/zuul/Projects/pai-opencode/.opencode/skills/<skill-name>/SKILL.md" \
  --max 80
```

## Options

- `--file <path>`: path to `SKILL.md` (required)
- `--max <n>`: fail if budget lines exceed `n`
- `--format text|json`: output format (default: `text`)
- `--help`: show help

## Exit codes

- `0`: within budget (or no max provided)
- `1`: budget lines exceed max
- `2`: tool error
