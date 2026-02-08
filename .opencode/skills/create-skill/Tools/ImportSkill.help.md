# ImportSkill

Import an existing skill directory into the PAI/OpenCode skill tree with minimal, mandatory-only canonicalization.

## Usage

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/create-skill/Tools/ImportSkill.ts" \
  --source "/abs/path/to/SkillDir" \
  --dest "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --canonicalize minimal
```

## Options

- `--name <skill-name>`: override destination directory name (input is canonicalized to kebab-case)
- `--canonicalize <mode>`: `none` | `minimal` | `strict`
  - `none`: copy only
  - `minimal` (default): normalize `SKILL.md` description to single-line + ensure `USE WHEN`; normalize `workflows/` and `tools/` dir casing
  - `strict`: also ensure `Workflows/` and `Tools/` exist and add minimal required sections if missing
- `--force`: overwrite destination if it exists
- `--dry-run`: show what would happen without writing
- `--help`: print CLI help

## Notes

- This tool intentionally avoids "improving" the imported skill. It only makes the minimal changes needed for PAI discovery/routing.
- After import, you still need to install into runtime:

```bash
cd "/Users/zuul/Projects/pai-opencode" && bun "Tools/Install.ts" --target "/Users/zuul/.config/opencode"
```
