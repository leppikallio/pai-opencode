# UpdateSkill Workflow

**Purpose:** Update an existing skill (add workflows/tools, adjust triggers, refine constraints) while keeping canonical structure and TitleCase naming.

## Critical rule: author in base repo, then install to runtime

- **Authoring (base repo):** `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/...`
- **Runtime (after install):** `/Users/zuul/.config/opencode/skills/<SkillName>/...`
- **Install step:** run `bun Tools/Install.ts --target /Users/zuul/.config/opencode` from `/Users/zuul/Projects/pai-opencode`

Do **not** edit under `/Users/zuul/.config/opencode/skills/...` directly.

---

## Step 1: Read the authoritative SkillSystem docs (Read-gated)

1) Read the index/router:

`/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`

2) Then `Read` the relevant section docs in the same turn:

- Structure + naming: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`
- Frontmatter rules: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md`
- Workflow routing contract: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Workflows.md`
- Validation + budgets: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md`

---

## Step 2: Read the current skill (base repo)

- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/SKILL.md`
- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Workflows/*.md`
- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Tools/*`

Confirm:

- Current `description:` shape (single line + `USE WHEN`)
- Current workflow routing table and files
- Current constraints (MUST NOT) coverage

---

## Step 3: Understand the update

Classify the change:

- Add workflow
- Update workflow content
- Update `description` triggers
- Add/modify tool
- Add missing constraints/output clamp
- Split content out of `SKILL.md` into root docs (budget control)

---

## Step 4: Apply the change (base repo)

### A) Add a new workflow

1) Pick a TitleCase workflow name: `<WorkflowName>`.
2) Create the file:

`/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Workflows/<WorkflowName>.md`

3) Add/adjust the `## Workflow Routing` table in `SKILL.md` using relative skill paths:

```md
| **<WorkflowName>** | <intent cues> | `<Workflows/<WorkflowName>.md>` |
```

### B) Update triggers

Update the single-line frontmatter `description:` (keep it one line):

```yaml
description: <What it does>. USE WHEN <intent cue 1> OR <intent cue 2> OR <intent cue 3>. <Any critical constraints>.
```

### C) Add or update a tool

Add tool + help files under:

- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Tools/<ToolName>.ts`
- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/Tools/<ToolName>.help.md`

If workflows invoke tools, ensure they map intent → flags (do not hardcode a single rigid invocation).

---

## Step 5: Re-check `SKILL.md` budget (when applicable)

If this update expands `SKILL.md`, re-check the default budget gate (budget lines exclude the `## Examples` section):

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/CreateSkill/Tools/CountSkillBudgetLines.ts" \
  --file "/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/SKILL.md" \
  --max 80
```

If over budget, move detail into root docs and keep `SKILL.md` as a router.

---

## Step 6: Install to runtime (for testing)

```bash
cd "/Users/zuul/Projects/pai-opencode" && bun Tools/Install.ts --target "/Users/zuul/.config/opencode"
```

---

## Step 7: Verify (quick checklist)

- TitleCase naming (skill dir, workflows, tools; `SKILL.md` uppercase)
- `name:` matches `<SkillName>` exactly
- `description:` is single line and includes `USE WHEN`
- Routing table matches existing workflow files
- Workflow runbooks include Purpose/Inputs/Steps/Verify/Output
- Constraints (MUST NOT) present and specific

---

## Done

Skill updated in the base repo, then installed to runtime.
