# SkillSystem (Index / Router)

**Purpose:** Stable entrypoint for PAI SkillSystem documentation.

## 🚨 Critical: section docs are NOT auto-loaded

Only this index/router is auto-loaded at session start.

**Section docs are NOT auto-loaded.** If you need any rule below, you MUST `Read` the relevant section doc **in the same turn** before answering.

Example (Structure question):

```text
Read /Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md
```

## Auto-loaded at session start (grounded in `context-loader.ts`)

The context loader explicitly loads the following SYSTEM docs (plus PAI `SKILL.md` and some USER/TELOS + USER identity docs). SYSTEM set:

- `/Users/zuul/.config/opencode/skills/PAI/SKILL.md` (or CORE fallback)
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md` (this file)
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/PAIAGENTSYSTEM.md`
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md`
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/PAISYSTEMARCHITECTURE.md`
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/RESPONSEFORMAT.md`

## Read-gated routing table (category → section doc)

**Rule:** If you answer a question in a category, you MUST `Read` the mapped doc first.

| Category | Read this section doc (NOT auto-loaded) | Canary / citation requirement |
|---|---|---|
| Structure, naming, allowed dirs, depth | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md` | Cite `<!-- SKILLSYSTEM:STRUCTURE:v1 -->` **or** exact heading |
| YAML frontmatter, `USE WHEN` rules | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md` | Cite `<!-- SKILLSYSTEM:FRONTMATTER:v1 -->` **or** exact heading |
| Workflow routing contract | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Workflows.md` | Cite `<!-- SKILLSYSTEM:WORKFLOWS:v1 -->` **or** exact heading |
| Tools / CLI expectations | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Tools.md` | Cite `<!-- SKILLSYSTEM:TOOLS:v1 -->` **or** exact heading |
| Skill customizations system | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Customizations.md` | Cite `<!-- SKILLSYSTEM:CUSTOMIZATIONS:v1 -->` **or** exact heading |
| Canonical examples | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Examples.md` | Cite `<!-- SKILLSYSTEM:EXAMPLES:v1 -->` **or** exact heading |
| Validation, budgets, checklists | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md` | Cite `<!-- SKILLSYSTEM:VALIDATION:v1 -->` **or** exact heading |
| Anti-patterns / drift / failure modes | `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/AntiPatterns.md` | Cite `<!-- SKILLSYSTEM:ANTIPATTERNS:v1 -->` **or** exact heading |

## Capability-truth (docs/templates MUST follow this)

**Docs and templates MUST NOT instruct `SkillSearch(...)` as a required step.**

Preferred pattern:

1) `Read` the exact file (absolute runtime path)
2) If you don’t know the exact path: `glob` for it, then `Read` the resolved path

Example discovery pattern:

```text
glob "/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/*.md"
Read  "/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/<Section>.md"
```

Also: **do not claim you consulted a section doc unless you actually `Read` it.**

## Canary rule (anti-guessing)

When you answer using any section doc, you MUST include either:

- the section’s canary comment (preferred), e.g. `<!-- SKILLSYSTEM:STRUCTURE:v1 -->`, **or**
- the **exact heading** you used (verbatim)

This is required to prove the correct doc was actually read.

## Two important exceptions (PAI-wide) — summaries only

These are intentionally brief here; details live in the section docs.

1) **PAI-wide depth exception:** deeper nesting is allowed under `/Users/zuul/.config/opencode/skills/PAI/**` when it improves organization.
   - Canonical guidance: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`

2) **Numeric prefixes exception:** numeric-prefixed filenames are allowed **only** under `/Users/zuul/.config/opencode/skills/PAI/Components/**`.
   - Canonical guidance: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`

---

**If you are unsure where a rule lives:** use the routing table above, then `Read`.
