# UpdateFromUpstream (Superpowers → PAI)

This workflow updates the **vendored** `obra/superpowers` skill library inside our PAI repo.

Goals:
- No edits to the upstream repo are required.
- Use the existing importer so canonicalization + validation stays consistent.
- Preserve PAI as the top-level response contract (Superpowers is additive).

## Inputs

- `<SuperpowersRepoDir>`: your local clone of `obra/superpowers`
- `<PaiRepoDir>`: your PAI repo worktree (graphviz)

## Steps

### 1) Update the upstream clone

```bash
cd <SuperpowersRepoDir>
git status --porcelain=v1 -b
git pull --rebase
```

### 2) Re-import the upstream skills into the PAI repo

Run the importer **once per upstream skill directory**.

Notes:
- Use `--canonicalize minimal`.
- Use `--force` to overwrite the previously-vendored copy.
- The importer enforces PAI frontmatter constraints (single-line description + `USE WHEN`).

```bash
cd <PaiRepoDir>

# Example: re-import one skill
bun "~/.config/opencode/skills/create-skill/Tools/ImportSkill.ts" \
  --source "<SuperpowersRepoDir>/skills/brainstorming" \
  --dest "<PaiRepoDir>/.opencode/skills" \
  --name "brainstorming" \
  --canonicalize minimal \
  --force

# Repeat for each directory under <SuperpowersRepoDir>/skills/* that contains SKILL.md
```

### 3) Review and commit

```bash
cd <PaiRepoDir>
git status --porcelain=v1 -b
git diff

# Commit with a clear message like:
#   chore(superpowers): update vendored skills to upstream <date/sha>
```

### 4) Install into runtime and verify

Use the normal installer (it will run the security gate + broken-ref verification + regenerate `skill-index.json`).

```bash
cd <PaiRepoDir>
bun Tools/Install.ts --target "~/.config/opencode"
```

### 5) Smoke-check in a fresh session

- Start a new OpenCode session.
- Ask for a task that should trigger a Superpowers process skill (e.g., “help me plan a feature”).

## When upstream adds new skills

If upstream adds a new skill directory, import it as well and ensure it’s selected in `~/.config/opencode/config/skills-selection.json` (or re-run the installer interactively once).
