---
name: CreateSkill
description: Create, validate, canonicalize, and import skills. USE WHEN you want a new skill OR need to update/canonicalize/import an existing skill.
---

## Customization

**Before executing, check for user customizations at:**
`/Users/zuul/.config/opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/CreateSkill/` (optional)

If this directory exists, load and apply any PREFERENCES.md or configs found there. These override defaults.

# CreateSkill

## Authoritative SkillSystem docs (runtime, read-gated)

Index/router (start here):
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`

Section docs (read in the same turn you need a rule):
- Structure + naming + depth: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`
- YAML frontmatter + `USE WHEN`: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md`
- Workflow routing contract: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Workflows.md`
- Tools/CLI expectations: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Tools.md`
- Validation + budgets: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md`
- Examples contract: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Examples.md`
- Skill customizations: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Customizations.md`

Rule: MUST NOT claim you consulted a section doc unless you actually `Read` it.

## Non-negotiables (CreateSkill output targets)

1) **TitleCase naming** for skill dir, workflows, tools, and root docs (except `SKILL.md`).
2) **Folder depth policy:**
   - Default (non-PAI): keep skills flat; only `Tools/` and `Workflows/` directories.
   - PAI exception: deeper nesting allowed under `/Users/zuul/.config/opencode/skills/PAI/**` when it improves organization.
3) **No “SkillSearch required” instructions** in skills or templates.
   - Prefer explicit `Read` of absolute runtime paths.
   - If you don’t know a path: `glob` then `Read`.
4) **`SKILL.md` budget:** newly generated skills default to **≤ 80 lines** (count ALL lines, including blanks).
   - Creative archetype: no hard limit (still prefer “router + root docs”, not essays).
5) Keep deep detail out of `SKILL.md`: move it into **root** context docs (`Examples.md`, `ApiReference.md`, `StyleGuide.md`, etc.).
6) **Binding constraint blocks:** newly generated skills MUST include:
   - `<negative_constraints>` with ~5+ explicit MUST NOT bullets
   - `<output_shape>` with a concise format/verbosity clamp

## Skill Archetypes (for output shape + creativity)

Choose an archetype before drafting a new skill. The archetype changes what blocks you include, but the skill should remain a runbook (contracts-first, verifiable).

- **Procedural (default):** deterministic runbooks; minimal prose; strict ≤80-line SKILL.md budget.
- **Creative:** still a runbook, but explicitly bounds creativity via a Creative Latitude block; no hard SKILL.md limit.
- **Hybrid:** procedural scaffolding plus bounded creative sub-steps.

Creative archetype guidance:
- Prefer rubrics + short templates over long prose.
- Move extended guidance into root docs (`StyleGuide.md`, `Examples.md`) and keep `SKILL.md` as a router.

## Dynamic loading template (router-first; placeholder-safe)

Use this pattern when a skill would exceed the default ≤80-line `SKILL.md` budget.

```md
---
name: {SkillName}
description: One line summary. USE WHEN user intent indicates activation.
---

# {SkillName}

## Workflow Routing

| Workflow | Trigger | File |
|---|---|---|
| **Create** | create/new/draft | `<Workflows/Create.md>` |

## Quick Reference

- 3–5 bullets max (router, not a spec)

Full docs (root context):
- `/Users/zuul/.config/opencode/skills/{SkillName}/Examples.md`
- `/Users/zuul/.config/opencode/skills/{SkillName}/ApiReference.md`

<negative_constraints>
- MUST NOT ...
</negative_constraints>

<output_shape>
- Default: concise bullets.
- For multi-step work: short labeled sections.
</output_shape>
```

Notes:
- Use `{SkillName}` or `<SkillName>` placeholders in templates to avoid broken-link scanning.
- Prefer adding root docs over growing `SKILL.md`.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **CreateSkill** | Create a new skill | `Workflows/CreateSkill.md` |
| **UpdateSkill** | Update an existing skill | `Workflows/UpdateSkill.md` |
| **ValidateSkill** | Validate a skill against SkillSystem | `Workflows/ValidateSkill.md` |
| **CanonicalizeSkill** | Canonicalize naming/structure | `Workflows/CanonicalizeSkill.md` |
| **ImportSkill** | Import a skill directory from a path | `Workflows/ImportSkill.md` |

## Examples

**Example 1: Create a new skill**
```
You: "Create a skill for managing my recipes"
→ Invokes CreateSkill workflow
→ Produces `{SkillName}/SKILL.md` + `Workflows/` + `Tools/` (budgeted)
→ Returns a patch or file contents for review
```

**Example 2: Validate/canonicalize an existing skill**
```
You: "Canonicalize the Daemon skill"
→ Invokes CanonicalizeSkill workflow
→ Aligns naming/structure + routing table with SkillSystem rules
→ Returns the minimal, reviewable changes
```
