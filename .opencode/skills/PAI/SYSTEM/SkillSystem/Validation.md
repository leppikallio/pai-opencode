> Up (runtime): `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Source (repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Scope: How to validate skills and SkillSystem section docs are compliant.

<!-- SKILLSYSTEM:VALIDATION:v1 -->

# SkillSystem — Validation

This section defines what “valid” means for:

- Skills (`/Users/zuul/.config/opencode/skills/<SkillName>/...`)
- SkillSystem section docs (`/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/*.md`)

## Read-gate + canary (MANDATORY)

SkillSystem is split into section docs to reduce auto-loaded context.

Validation expectation:

- **Read-gate:** If you answer a question about a section, you MUST `Read` that section doc **in the same turn**.
- **Canary citation:** Your answer MUST cite the section’s canary comment (or the exact heading you used).

Rationale: prevents “I remember” drift and makes retrieval verifiable.

## Link policy (runtime-first)

- Internal references MUST use absolute runtime paths under `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/...`.
- If you mention repo paths, label them explicitly as source paths (authoring location), not runtime.

## SKILL.md size budget (default gate)

Default rule: newly generated procedural `SKILL.md` MUST be **≤ 80 budget lines**.

### Counting rule (budget lines)

- Count ALL lines (frontmatter + blank lines included)
- EXCEPT: do **not** count the `## Examples` section (the heading + its body) toward the budget.

Definition of the `## Examples` section for counting:

- Starts at a line that matches `## Examples`
- Ends immediately before the next `## <Heading>` line (or end-of-file)

If over budget: move detail into root context docs (e.g., `ApiReference.md`, `StyleGuide.md`, `Templates.md`) and keep `SKILL.md` router-first.

### Creative archetype exception

Creative archetype has **no hard SKILL.md line limit**.

Guidance to avoid essays:

- Prefer checklists, rubrics, and short templates over long prose.
- Put extended guidance into root docs (`StyleGuide.md`, `Examples.md`) and keep `SKILL.md` as a router.
- Keep “Creative Latitude” bounded (degrees of freedom + constraints + selection rubric).

## Compliance checklist (skills)

### 1) Naming

- [ ] Skill directory is TitleCase (system skills) OR `_ALLCAPS` (personal skills)
- [ ] `SKILL.md` is uppercase
- [ ] Workflow files are TitleCase (e.g., `<Workflows/UpdateInfo.md>`)
- [ ] Root reference docs are TitleCase (e.g., `ApiReference.md`)
- [ ] Tool files are TitleCase (e.g., `<Tools/ManageServer.ts>`)
- [ ] Names shown in tables match file names exactly

### 2) YAML frontmatter

- [ ] `name:` matches skill directory name (case-sensitive)
- [ ] `description:` is single line and includes `USE WHEN` triggers
- [ ] No YAML `triggers:` or `workflows:` arrays

### 3) Required body blocks

- [ ] `# <SkillName>` title
- [ ] `## Workflow Routing` table (when workflows exist)
- [ ] `## Examples` (minimal; 1–2 examples preferred)

CreateSkill-generated skills (default) SHOULD also include:

- [ ] `<negative_constraints>` (MUST NOT list; ~5+ items)
- [ ] `<output_shape>` (format + verbosity clamp)

### 4) Workflow routing table contract

- [ ] Table columns: `Workflow | Trigger | File`
- [ ] `Workflow` is TitleCase
- [ ] `File` uses relative skill paths (e.g., `<Workflows/Create.md>`) or absolute runtime paths if cross-skill
- [ ] Every referenced workflow file exists

### 5) Tools / workflows

- [ ] `Workflows/` contains only execution runbooks
- [ ] `Tools/` exists (even if empty)
- [ ] Workflows map intent → tool flags (don’t hardcode one rigid invocation)

Workflow structure notes:

- For state-changing or correctness-critical workflows, include `## Verify`.
- For pure writing/creative workflows, `## Verify` is optional (no external verification required), but a short self-check rubric is recommended.

### 6) Capability-truth (no pretending)

- [ ] Docs and workflows only claim tool outputs that were actually produced
- [ ] If you did not `Read` a file or run a tool, you do not claim you did

## Compliance checklist (SkillSystem section docs)

- [ ] Backlink header present (Up runtime + Source repo + Scope)
- [ ] Canary comment present and matches the section
- [ ] No instructions requiring SkillSearch (use explicit `Read`; `glob` then `Read` if unknown)
- [ ] All internal references are absolute runtime paths under `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/...`
