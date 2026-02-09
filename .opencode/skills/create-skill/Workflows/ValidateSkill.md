# ValidateSkill Workflow

**Purpose:** Validate that a skill (or SkillSystem section doc) follows canonical structure, naming, and split-doc rules.

## Critical rule: validate base repo artifacts

- **Authoring (base repo):** `/Users/zuul/Projects/pai-opencode/.opencode/skills/...`
- **Runtime (after install):** `/Users/zuul/.config/opencode/skills/...`

Prefer validating the base repo source first; install to runtime only to confirm runtime layout.

---

## Step 1: Read the authoritative SkillSystem docs (Read-gated)

1) Read the index/router:

`/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`

2) Then `Read` the relevant section docs in the same turn:

- Structure + naming: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`
- Frontmatter rules: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md`
- Workflows contract: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Workflows.md`
- Validation + budgets: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md`

When reporting conclusions derived from section docs, include the relevant canary comment (or exact heading).

---

## Step 2: Decide what you are validating

### A) A skill

Base repo target:

- `/Users/zuul/Projects/pai-opencode/.opencode/skills/<skill-name>/...`

### B) A SkillSystem section doc (split-doc rules)

Base repo target:

- `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem/<Section>.md`

---

## Step 3: Validate a skill (checklist)

### 3.1 Naming + structure

- Skill directory is kebab-case (system) or `_ALLCAPS` (personal)
- `SKILL.md` exists and is uppercase
- `Workflows/` and `Tools/` directories exist (may be empty)
- Workflow/tool/root-doc filenames are TitleCase

### 3.2 `SKILL.md` budget

Default gate for newly generated procedural skills: `SKILL.md` **≤ 80 budget lines** (examples excluded).

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/create-skill/Tools/CountSkillBudgetLines.ts" \
  --file "/Users/zuul/Projects/pai-opencode/.opencode/skills/<skill-name>/SKILL.md" \
  --max 80
```

If over budget: move detail into root docs and keep `SKILL.md` as a router.

### 3.3 YAML frontmatter

- `name:` matches `<skill-name>` exactly
- `description:` is a single line and contains `USE WHEN`
- No `triggers:` or `workflows:` arrays

### 3.4 Markdown body

- `# ...` title present and clearly matches the skill identity
- `## Workflow Routing` table present when workflows exist
- Routing table uses relative paths like `<Workflows/<WorkflowName>.md>` (absolute only when cross-skill)
- `## Examples` section present (minimal is fine)
- Constraints present (5+ MUST NOT bullets recommended)

### 3.5 Workflow files

For each workflow file under `Workflows/`:

- Filename is TitleCase
- It’s an execution runbook (Purpose/Inputs/Steps/Verify/Output)
- If it invokes tools, it maps intent → flags (not a single hardcoded invocation)

### 3.6 Security vetting + allowlist hygiene

Run single-skill scan:

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode single \
  --skill-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills/<skill-name>"
```

If scanner suppressions are used for this skill:

- ensure suppressions are narrow (skill + rule + optional analyzer/file)
- ensure `owner`, `reason`, and `expires_at` are present
- ensure no expired suppressions remain (or fail on expired in strict checks)

---

## Step 4: Validate SkillSystem split-doc rules (section docs)

If the target is a SkillSystem section doc under:

`/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem/*.md`

Validate:

1) Backlink header present:
   - `> Up (runtime): ...`
   - `> Source (repo): ...`
   - `> Scope: ...`

2) Canary comment present and matches the section (e.g., `<!-- SKILLSYSTEM:...:v1 -->`).

3) No instructions requiring SkillSearch; preferred is explicit `Read` (or `glob` then `Read`).

4) Internal references are runtime-first (absolute paths under `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/...`).

---

## Step 5: (Optional) Install to runtime and spot-check paths

```bash
cd "/Users/zuul/Projects/pai-opencode" && bun Tools/Install.ts --target "/Users/zuul/.config/opencode"
```

Then confirm the runtime tree exists at:

- `/Users/zuul/.config/opencode/skills/<skill-name>/...`

---

## Step 6: Report results

COMPLIANT if all applicable checks pass.

NON-COMPLIANT if any check fails; list failures and point to the smallest corrective action.
