# CreateSkill Workflow

Create a new skill following canonical structure and **TitleCase (PascalCase)** naming.

## Critical rule: author in base repo, then install to runtime

- **Authoring (base repo):** `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/...`
- **Runtime (after install):** `/Users/zuul/.config/opencode/skills/<SkillName>/...`
- **Install step:** run `bun Tools/Install.ts --target /Users/zuul/.config/opencode` from `/Users/zuul/Projects/pai-opencode`

Do **not** create/edit files under `/Users/zuul/.config/opencode/skills/...` directly.

---

## Step 1: Read the authoritative SkillSystem docs (Read-gated)

SkillSystem is split into an index/router plus section docs.

1) Read the SkillSystem index/router:

`/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`

2) Then, in the **same turn**, `Read` the section docs you need:

- Structure + naming: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`
- YAML frontmatter rules: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md`
- Workflow routing contract: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Workflows.md`
- Validation + budgets: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md`

Notes:

- Prefer explicit `Read`. If you don’t know an exact path, `glob` then `Read`.
- When citing a section doc, include its canary (e.g., `<!-- SKILLSYSTEM:STRUCTURE:v1 -->`) or the exact heading used.

---

## Step 2: Understand the request

Capture:

1) What does the skill do (1–2 sentences)?
2) What intent should trigger it (`USE WHEN` triggers)?
3) What workflows are needed (verbs; executable runbooks)?
4) Does it need CLI tools (and what flags/outputs)?
5) What are the top “MUST NOT” constraints (drift prevention)?
6) Which archetype applies?
   - Procedural (default)
   - Creative (bounded creativity; no hard SKILL.md limit)
   - Hybrid

---

## Step 3: Determine TitleCase names (placeholders only)

All names use TitleCase (PascalCase):

| Component | Required format | Placeholder example |
|---|---|---|
| Skill directory | TitleCase | `<SkillName>` |
| Workflow files | TitleCase.md | `<WorkflowName>.md` |
| Root reference docs | TitleCase.md | `<ApiReference>.md`, `<Examples>.md` |
| Tool files | TitleCase.ts | `<ToolName>.ts` |
| Help files | TitleCase.help.md | `<ToolName>.help.md` |

Never use kebab/snake/all-caps for names (except `SKILL.md`).

---

## Step 4: Create the skill directory skeleton (base repo)

```bash
mkdir -p "/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Workflows"
mkdir -p "/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Tools"
```

---

## Step 5: Author `SKILL.md` (base repo) — keep it within the budget

Create:

`/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/SKILL.md`

### Default budget gate (new procedural skills)

Newly generated procedural `SKILL.md` MUST be **≤ 80 budget lines**.

Budget counting rule:

- Count all lines (frontmatter + blanks)
- EXCEPT: the `## Examples` section (heading + body) does not count toward the budget

If you exceed budget: move detail into root docs (e.g., `ApiReference.md`, `StyleGuide.md`, `Templates.md`) and keep `SKILL.md` as a router.

Budget-line check:

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/CreateSkill/Tools/CountSkillBudgetLines.ts" \
  --file "/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/SKILL.md" \
  --max 80
```

### Minimal template (router-first)

```md
---
name: <SkillName>
description: <What it does>. USE WHEN <intent cue 1> OR <intent cue 2> OR <intent cue 3>. <Any critical constraints>.
---

# <SkillName>

<1–2 sentence description>

## Workflow Routing

| Workflow | Trigger | File |
|---|---|---|
| **<WorkflowName>** | <intent cues> | `<Workflows/<WorkflowName>.md>` |

## Examples

**Example 1: <Use case>**
```
User: "<request>"
→ Invokes <WorkflowName>
→ <result>
```

<negative_constraints>
- MUST NOT <drift rule 1>
- MUST NOT <drift rule 2>
- MUST NOT <drift rule 3>
- MUST NOT <drift rule 4>
- MUST NOT <drift rule 5>
</negative_constraints>

<creative_latitude>
- (Creative/Hybrid only) Degrees of freedom: <tone/style/variants>
- (Creative/Hybrid only) Constraints: <what must remain true / what to avoid>
- (Creative/Hybrid only) Selection rubric: <how to pick the best option>
</creative_latitude>

<output_shape>
- Default: concise bullets.
- For multi-step work: short labeled sections.
</output_shape>
```

---

## Step 6: Create workflow files (base repo)

For each routing entry, create the workflow runbook under:

`/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Workflows/<WorkflowName>.md`

Recommended workflow structure:

```md
# <WorkflowName>

## Purpose

## Inputs

## Steps

## Verify

## Output
```

If the workflow calls a CLI tool, include an intent-to-flag mapping.

---

## Step 7: Create tool files (only if needed)

If the skill needs tools, place them under:

- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Tools/<ToolName>.ts`
- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Tools/<ToolName>.help.md`

---

## Step 8: Install to runtime (for testing)

```bash
cd "/Users/zuul/Projects/pai-opencode" && bun Tools/Install.ts --target "/Users/zuul/.config/opencode"
```

---

## Step 9: Verify (quick checklist)

- TitleCase naming everywhere (except `SKILL.md`)
- `SKILL.md` budget lines ≤ 80 (examples excluded)
- `name:` matches `<SkillName>` exactly
- `description:` is one line and contains `USE WHEN`
- Workflow routing table matches real files
- Workflows are runbooks (Purpose/Inputs/Steps/Verify/Output)

---

## Done

Skill authored in the base repo, then installed to runtime for use.
