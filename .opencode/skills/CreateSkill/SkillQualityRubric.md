# Skill Quality Rubric (30 seconds)

Use this as a fast PASS/FAIL gate for new or edited skills. Each item has a quick evidence check.

## Core (all skills)

| Item | PASS if… | FAIL if… | Quick evidence check |
|---|---|---|---|
| Naming | Skill dir is TitleCase; `SKILL.md` is uppercase; root docs/Workflows/Tools are TitleCase | Any naming mismatch | Look at paths + filenames |
| Frontmatter `name` | `name:` exactly matches skill directory name (case-sensitive) | Name differs | Open `SKILL.md` frontmatter |
| Frontmatter `description` | Single line and includes `USE WHEN` triggers | Multi-line or missing `USE WHEN` | Open `SKILL.md` frontmatter |
| No YAML arrays | No `triggers:` or `workflows:` arrays in YAML | Either array exists | Scan YAML frontmatter |
| Title present | Body has `# <SkillName>` title | Missing or wrong title | First heading in `SKILL.md` |
| Workflow routing (when applicable) | `## Workflow Routing` table exists and columns are `Workflow | Trigger | File` | No table or wrong columns | Find the table header |
| Routing correctness | Every referenced workflow file exists; cross-skill links use absolute runtime paths | Broken file refs | Verify each referenced path exists |
| Examples minimal | `## Examples` exists and is minimal (prefer 1–2) | Missing, or long essay examples | Count examples + length |
| Tools folder | `Tools/` exists (even if empty) | No `Tools/` directory | Check skill directory tree |
| Runtime-first internal links | SkillSystem/internal docs referenced via absolute runtime paths under `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/...` | Relative links, repo-only links, or ambiguous “path” references | Search for `SkillSystem/` links |
| No “SkillSearch required” | Docs do not require SkillSearch as a step | Any “must SkillSearch” instruction | Scan for “SkillSearch” wording |

Reference (runtime):
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md` (see `## Compliance checklist (skills)`) — canary `<!-- SKILLSYSTEM:VALIDATION:v1 -->`

## Procedural archetype (default)

| Item | PASS if… | FAIL if… | Quick evidence check |
|---|---|---|---|
| `SKILL.md` size budget | `SKILL.md` is ≤ 80 lines (counts blanks + YAML) | > 80 lines | `wc -l <SKILL.md>` |
| Router-first shape | `SKILL.md` reads like a runbook/router, not a spec | Long prose/deep details embedded | Skim: mostly tables + bullets |
| Constraint blocks | Contains `<negative_constraints>` (~5+ MUST NOTs) and `<output_shape>` (format/verbosity clamp) | Missing either block | Search for those tags |

## Creative archetype

| Item | PASS if… | FAIL if… | Quick evidence check |
|---|---|---|---|
| No hard limit, still bounded | Not necessarily ≤80 lines, but avoids essays via rubrics/templates and root docs | Unbounded prose; everything shoved into `SKILL.md` | Skim for rubrics + pointers to root docs |
| Creative latitude explicit | Creativity is bounded and evaluable (degrees of freedom + constraints + selection rubric) | “Be creative” with no bounds | Search for a “Creative Latitude” block (or equivalent) |

Reference (runtime):
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md` → `### Creative archetype exception`

## Hallucination guard (SkillSystem citation)

| Item | PASS if… | FAIL if… | Quick evidence check |
|---|---|---|---|
| Canary/heading citation | Any claim about SkillSystem rules cites either the canary comment or the exact heading used, and points to the absolute runtime path | SkillSystem rules stated with no citation | Require citations like: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md` + `<!-- SKILLSYSTEM:VALIDATION:v1 -->` or `## Read-gate + canary (MANDATORY)` |
