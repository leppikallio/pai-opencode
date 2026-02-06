# ImportSkill Workflow

Import an existing skill directory (including Workflows/ and Tools/ and any referenced tooling) into the PAI skill system with **surgical, mandatory-only** edits.

## Read first (policy + rubric)

- Minimal canonicalization policy (what you may/must not change):
  - `/Users/zuul/.config/opencode/skills/CreateSkill/MinimalCanonicalizationPolicy.md`
- 30-second quality gate (post-import quick check):
  - `/Users/zuul/.config/opencode/skills/CreateSkill/SkillQualityRubric.md`

## Import Contract (Default)

When Petteri asks to import skill(s), assume:

- Copy the **entire** skill directory tree (root docs/assets + `Workflows/` + `Tools/`)
- Do **not** rewrite the skill content; only apply **mandatory** canonicalization required for routing/discovery
- Prefer reversible changes; report any edits made
- Never edit `~/.config/opencode/` directly; import into the base repo and then install using the installer

## Mandatory-Only Canonicalization (What is allowed)

Allowed by default ("minimal"):

- Ensure `SKILL.md` frontmatter has a **single-line** `description:`
- Ensure the frontmatter `description:` contains `USE WHEN` (append a minimal clause if missing)
- If the source uses lowercase `workflows/` or `tools/`, rename to `Workflows/` and `Tools/` (only if the TitleCase directory does not already exist)

Only if explicitly requested ("strict"):

- Add missing `## Workflow Routing` and `## Examples` stubs (minimal, no content rewrite)
- Rename non-TitleCase workflow/tool filenames (and update references)

## Step 1: Collect Inputs

Ask Petteri for:

- Source skill path (directory)
- Destination base repo skill root (usually `/Users/zuul/Projects/pai-opencode/.opencode/skills`)
- Desired skill name (defaults to source folder name)
- Whether overwrite is allowed if the destination already exists

## Step 2: Run the Import Tool (Recommended)

Use the CreateSkill import tool to copy + minimally canonicalize:

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/CreateSkill/Tools/ImportSkill.ts" \
  --source "/abs/path/to/Skill" \
  --dest "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --canonicalize minimal
```

If destination exists and overwrite is desired, add:

```bash
  --force
```

If you want stricter canonicalization (more intrusive), use:

```bash
  --canonicalize strict
```

## Step 3: Install Into Runtime

From the repo root, install into runtime (this also regenerates `skills/skill-index.json`):

```bash
cd "/Users/zuul/Projects/pai-opencode" && bun "Tools/Install.ts" --target "/Users/zuul/.config/opencode"
```

## Step 4: Verify

- Destination exists: `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/SKILL.md`
- Runtime exists: `~/.config/opencode/skills/<SkillName>/SKILL.md`
- Skill index includes the new skill: `~/.config/opencode/skills/skill-index.json`

Optional post-import gate:
- Apply the 30-second rubric: `/Users/zuul/.config/opencode/skills/CreateSkill/SkillQualityRubric.md`
