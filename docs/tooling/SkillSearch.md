# SkillSearch

Search the generated skill index (`skill-index.json`) to quickly find which skill to use.

**Source:** `.opencode/skills/PAI/Tools/SkillSearch.ts`

## Prerequisite

`skill-index.json` must exist. If it doesn’t, generate it:

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/GenerateSkillIndex.ts"
```

## Usage

Search:

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/SkillSearch.ts" "scrape instagram"
```

List skills:

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/SkillSearch.ts" --list
```

List by tier:

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/SkillSearch.ts" --tier always
bun run "$HOME/.config/opencode/skills/PAI/Tools/SkillSearch.ts" --tier deferred
```
