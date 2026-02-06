# Minimal Canonicalization Policy

This document defines what **“minimal canonicalization”** means when importing an existing skill into the PAI/OpenCode skill tree.

Scope:
- Applies to CreateSkill’s import flow and the `ImportSkill` tool.
- Defines what the importer **may change** vs **must not change**.

Related docs (runtime paths):
- Import workflow: `/Users/zuul/.config/opencode/skills/CreateSkill/workflows/ImportSkill.md`
- Import tool help: `/Users/zuul/.config/opencode/skills/CreateSkill/Tools/ImportSkill.help.md`
- Skill structure: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`
- Skill frontmatter: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md`
- Validation checklist: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md`

## Canonicalization modes

Canonicalization is any transformation that makes an imported skill conform better to the SkillSystem conventions.

**Policy goal:** default to **minimal** changes so imports are fast, low-risk, and reversible. Deeper rewrites happen later as explicit tasks.

### Minimal vs strict (clear contract)

| Dimension | Minimal canonicalization (default) | Strict canonicalization (only by explicit request) |
|---|---|---|
| Primary goal | Make the skill *discoverable/routable* with mandatory-only edits | Make the skill fully compliant, even if intrusive |
| Content rewriting | Forbidden | Still discouraged; may add minimal required stubs |
| Typical changes | Frontmatter normalization; directory casing normalization | Minimal changes plus required-section stubs; renames with ref updates |
| File renames | Only directory casing for `workflows/` / `tools/` → `Workflows/` / `Tools/` | May rename non-TitleCase workflow/tool filenames (and update references) |
| Structural additions | Avoid new content/docs; prefer “fail + re-run strict” | May add missing structural pieces needed for compliance |
| When to use | Default for almost all imports; safest path | Only when explicitly requested |
| Failure behavior | If minimal cannot satisfy mandatory constraints, abort with a specific reason | Attempt to fix mandatory constraints within strict scope |

Notes:
- The tool exposes a third mode, `none`, which is pure copy (no canonicalization). See: `/Users/zuul/.config/opencode/skills/CreateSkill/Tools/ImportSkill.help.md`.
- The meaning of “minimal” is defined by the **Allowed edits** list below, not by “whatever seems helpful”.

## Import procedure (author in base repo, then install)

This is the canonical import flow. Do not edit runtime files directly.

### 1) Choose source and destination

- Source skill directory: `<SourceSkillDir>`
- Destination skills root (base repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills`
- Destination skill name: `<SkillName>` (TitleCase)

### 2) Run the import tool (prefer dry-run first)

Minimal (recommended default):

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/CreateSkill/Tools/ImportSkill.ts" \
  --source "<SourceSkillDir>" \
  --dest "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --name "<SkillName>" \
  --canonicalize minimal \
  --dry-run
```

Then re-run without `--dry-run` once the planned edits look correct.

Strict (only when explicitly requested):

```bash
bun "/Users/zuul/Projects/pai-opencode/.opencode/skills/CreateSkill/Tools/ImportSkill.ts" \
  --source "<SourceSkillDir>" \
  --dest "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --name "<SkillName>" \
  --canonicalize strict
```

If overwriting an existing destination is intended, add:

```bash
  --force
```

### 3) Install into runtime (post-import)

After importing into the base repo, deploy into runtime:

```bash
cd "/Users/zuul/Projects/pai-opencode" && bun "Tools/Install.ts" --target "/Users/zuul/.config/opencode"
```

### 4) Verify

Minimum verification checks:

- Base repo path exists:
  - `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/SKILL.md`
- Runtime path exists:
  - `/Users/zuul/.config/opencode/skills/<SkillName>/SKILL.md`
- Skill index includes the skill:
  - `/Users/zuul/.config/opencode/skills/skill-index.json`

## Allowed edits (explicit)

Allowed edits are the entire definition of canonicalization scope.

### Allowed in minimal canonicalization

1) Copy the full tree
   - Copy the entire source directory into `/Users/zuul/Projects/pai-opencode/.opencode/skills/<SkillName>/`.
   - Include root docs/assets, plus `Workflows/` and `Tools/` (if present).

2) Normalize `SKILL.md` YAML frontmatter `description` (mandatory-only)
   - Ensure `description:` is a single line (no YAML multiline `|`).
   - Ensure the line contains the literal phrase `USE WHEN`.
   - Reference: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Frontmatter.md`

3) Normalize casing of workflows/tools directory names (only when safe)
   - If the source uses lowercase `workflows/` or `tools/`, rename to `Workflows/` and `Tools/`.
   - Do this only if the TitleCase directory does not already exist.
   - Rationale: preserve content; avoid merges/conflicts when both exist.

4) Record and report changes
   - The importer should list exactly what it changed (paths + short reason).

### Allowed in strict canonicalization (superset; only by explicit request)

All minimal edits, plus:

1) Add missing required stubs (minimal, non-opinionated)
   - If `SKILL.md` is missing required sections (e.g., `## Workflow Routing`, `## Examples`), add stubs without rewriting existing content.
   - Reference checklist: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Validation.md`

2) Normalize workflow/tool filenames to TitleCase (with reference updates)
   - Rename non-TitleCase workflow/tool filenames.
   - Update internal references to match.

## Forbidden edits (explicit)

These are forbidden in minimal and remain discouraged even in strict unless explicitly requested.

### Forbidden in minimal canonicalization

- Any rewrite of prose, meaning, or intent in skill docs (beyond the frontmatter `description` constraints above).
- Any changes to workflow logic/steps (workflows are treated as source material during import).
- Any changes to tool code (TypeScript/Python/etc.), dependencies, or behavior.
- Renaming workflow/tool files (other than the directory casing normalization rule above).
- Introducing new directories like `Docs/`, `Guides/`, `Resources/`, `Context/` under a non-PAI skill.
  - Reference: `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/Structure.md`
- “Improving” formatting, rewriting headings, or reorganizing files for taste.
- Adding new workflows/tools or deleting existing ones.

### Forbidden even in strict unless explicitly approved

- Changing the actual operational behavior described by a workflow.
- Semantic edits to `USE WHEN` triggers beyond making them present and single-line.
- Re-architecting the skill (splitting/merging docs, introducing new taxonomy).

## Decision rule (minimal by default)

- Default import mode is `--canonicalize minimal`.
- Use `--canonicalize strict` only when explicitly requested.
- If minimal mode cannot satisfy mandatory constraints without violating the forbidden list, the correct behavior is:
  1) abort,
  2) state the exact blocking constraint,
  3) recommend re-running with `--canonicalize strict` (or doing a follow-on rewrite task).
