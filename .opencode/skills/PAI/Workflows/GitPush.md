# Git Workflow - Push Updates

**Purpose:** Complete workflow for committing and pushing changes from the **PAI source repo** (`~/Projects/pai-opencode`).

**When User Says:** "push changes" or "update repo" or "commit and push"

---

## ⚠️ CRITICAL: SOURCE vs PUBLIC - NEVER CONFUSE

| Repository | Directory | Purpose |
|------------|-----------|---------|
| **PAI SOURCE REPO** | `~/Projects/pai-opencode/` | Where you edit and commit changes |
| **PAI RUNTIME** | `~/.config/opencode/` | Installed runtime (not authoritative source) |
| **PUBLIC TEMPLATE** | (varies) | Open source template / public repo |

**This workflow is for the SOURCE repo only.**

Before EVERY push: `git remote -v` must show your **private** remote, not any public template remote.

---

## What This Means

- Update documentation FIRST (before committing)
- Commit all current changes (staged and unstaged)
- Push to the private repository
- This is a FULL workflow: docs → git add → git commit → git push

---

## MANDATORY Workflow Steps

### 1. Verify Location and Remote (CRITICAL SECURITY)

```bash
# MUST be in the SOURCE repo
cd "~/Projects/pai-opencode" && pwd

# MUST show the correct (private) remote
git remote -v
# MUST NOT show: any public template remote
```

**⛔ STOP IMMEDIATELY if:**
- `pwd` is not `~/Projects/pai-opencode`
- `git remote -v` points to any public template remote

**This is a HARD STOP condition.** Never proceed if verification fails.

### 2. Review Current Changes

```bash
git status  # See all changes
git diff  # Review unstaged changes
git diff --staged  # Review staged changes
```

### 3. Update Documentation FIRST (BEFORE COMMITTING)

**Review what changes are about to be committed:**

- Verify that code changes align with documentation
- If this is a system-level change, update relevant documentation files
- Update SYSTEM docs if structure changed (SKILLSYSTEM.md, MEMORYSYSTEM.md, etc.)

This ensures documentation stays in sync with code changes.

### 4. Stage All Changes (Including Doc Updates)

```bash
git add .  # Stage all changes including documentation updates
# OR selectively stage specific files if needed
```

### 5. Create Commit with Descriptive Message

```bash
git commit -m "$(cat <<'EOF'
<descriptive commit message>

- Key change 1
- Key change 2
- Key change 3

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

- Commit message should describe WHAT changed and WHY
- Follow repository's commit message style (check git log)
- Use HEREDOC format for proper formatting

### 6. Push to Remote

```bash
git push origin <branch-name>
```

- Push current branch to origin
- Confirm push successful

### 7. Verify and Report

```bash
git status  # Confirm clean working directory
```

- Report commit hash, files changed, and push status to user
- Confirm documentation was updated and included in commit

---

## What to Commit

- Modified files that are part of the work
- New files that should be tracked
- Deleted files (properly staged with git rm)

---

## What NOT to Commit

- Files that likely contain secrets (.env, credentials.json, etc.)
- Temporary test files (use scratchpad for those)
- Log files with sensitive data
- Warn user if attempting to commit sensitive files

---

## Security Checklist (ALWAYS)

- ✅ Verified we're in ~/.config/opencode/ directory
- ✅ Verified remote is the correct private repository
- ✅ Reviewed changes for sensitive data
- ✅ Commit message is descriptive and professional
- ✅ No secrets or credentials in committed files

---

## Example Complete Workflow

```bash
# 1. Verify location and remote
pwd && git remote -v

# 2. Review changes
git status
git diff

# 3. Stage and commit
git add .
git commit -m "feat: add git workflow documentation to PAI skill"

# 4. Push
git push origin feature/enhanced-dashboard-metrics

# 5. Verify
git status
```

---

## CRITICAL

**This workflow is for the PRIVATE `~/.config/opencode` repo ONLY.**

| If User Says... | What to Do |
|-----------------|------------|
| "push to PAI repo" | ✅ Use this workflow (PRIVATE) |
| "update the PAI repo" | ✅ Use this workflow (PRIVATE) |
| "push to PAI repo" | ⚠️ STOP - use PAI skill instead |
| "update PAI" | ⚠️ STOP - clarify which repo |

For PUBLIC PAI repo (`~/Projects/PAI/`):
- Use the **PAI skill** workflows
- ALWAYS sanitize content first
- See CRITICAL SECURITY section in PAI skill

---

**Related Documentation:**
- ~/.config/opencode/skills/PAI/SKILL.md (CRITICAL SECURITY section)
