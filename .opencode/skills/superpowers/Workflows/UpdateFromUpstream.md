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

### 2b) Apply PAI-local generalizations (REQUIRED)

Upstream Superpowers content is written for a Claude-centric environment. In PAI/OpenCode, we want the vendored skills to be **model-neutral** and to use **un-namespaced skill names**.

Apply these generalizations **immediately after each import** (or once after importing all skills):

1) Replace `For Claude` → `For the executor`
2) Drop the `superpowers:` prefix in required sub-skill references (skills load by plain name in this runtime)

Run (repeat with the imported skill name):

```bash
cd <PaiRepoDir>

SKILL_DIR="<PaiRepoDir>/.opencode/skills/<SkillName>"

python - <<'PY'
from pathlib import Path
import os

skill_dir = Path(os.environ["SKILL_DIR"])
for p in skill_dir.rglob("*.md"):
  txt = p.read_text(encoding="utf-8")
  new = txt
  new = new.replace("> **For Claude:**", "> **For the executor:**")
  new = new.replace("superpowers:", "")
  if new != txt:
    p.write_text(new, encoding="utf-8")
PY

# Sanity checks (should return no matches)
rg -n "For Claude" "$SKILL_DIR" || true
rg -n "superpowers:" "$SKILL_DIR" || true
```

Notes:
- If upstream ever introduces skill-name collisions, re-introduce namespacing deliberately. The default here is “no prefix”.
- Keep the changes minimal and mechanical; do not editorialize upstream docs beyond these generalizations.

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
