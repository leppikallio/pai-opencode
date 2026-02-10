---
name: system
description: System maintenance - integrity check, document session, secret scan. USE WHEN integrity, audit, document session, secrets, security scan.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/system/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# System Skill

System validation, integrity audits, documentation tracking, and security scanning for the PAI system.

## Visibility

This skill runs in the foreground so you can see all output, progress, and hear voice notifications as work happens. Documentation updates, integrity checks, and other system operations should be visible to maintain transparency.

---

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running WORKFLOWNAME workflow from system skill"
User: "Run an integrity check"
→ Invokes IntegrityCheck workflow
→ Spawns parallel agents to audit ~/.config/opencode
→ Finds broken references, missing files
→ Returns list of issues found/fixed
```

**Example 2: Document Current Session**
```
User: "Document this session"
→ Invokes DocumentSession workflow
→ Reads current session transcript
→ Uses AI to extract what changed and why
→ Creates entry in MEMORY/PAISYSTEMUPDATES/
→ Automatically calls GitPush
```

**Example 3: Catch-up Documentation**
```
User: "What's undocumented? Catch up the docs."
→ Invokes DocumentRecent workflow
→ Finds last documented update timestamp
→ Compares git history since then
→ Generates documentation for missed changes
→ Automatically calls GitPush
```

**Example 4: Git Push**
```
User: "Git Push"
→ Invokes GitPush workflow
→ Verifies we're in ~/.config/opencode (PRIVATE repo)
→ git add + commit + push
```

### Security Workflows

**Example 5: Credential Scanning**
```
User: "Check for secrets before I push"
→ Invokes SecretScanning workflow
→ Runs TruffleHog on specified directory
→ Reports any API keys, credentials found
```

### Utility

**Example 7: Recall Past Work**
```
User: "We just changed the plugin - why broken again?"
→ Invokes WorkContextRecall workflow
→ Searches MEMORY/, git history for "plugin" and related terms
→ Presents timeline of changes and possible regression
```

---

## Quick Reference

### The Four Core Operations

| Operation | Input | Output | Duration |
|-----------|-------|--------|----------|
| **IntegrityCheck** | Codebase scan | List of broken refs found/fixed | ~2-5 min |
| **DocumentSession** | Session transcript | PAISYSTEMUPDATES entry | ~30s |
| **DocumentRecent** | Git history since last update | Multiple PAISYSTEMUPDATES entries | ~1-2 min |
| **GitPush** | PAISYSTEMUPDATES directory | git commit + push | ~10s |

### Composition Patterns

```
End of Session:     DocumentSession → GitPush
After Refactoring:  IntegrityCheck → DocumentSession → GitPush
Catch-up:           DocumentRecent → GitPush
Quick Push:         GitPush (if docs already created)
```

### Security Audits

| Audit Type | Tool | Scope | Duration |
|------------|------|-------|----------|
| Secret Scan | TruffleHog | Any directory | ~30s-2min |
| Privacy Check | grep/patterns | skills/ (excl USER/WORK) | ~30s |

### Documentation Format

**Verbose Narrative Structure:**
- **The Story** (1-3 paragraphs): Background, Problem, Resolution
- **How It Used To Work**: Previous state with bullet points
- **How It Works Now**: New state with improvements
- **Going Forward**: Future implications
- **Verification**: How we know it works

---

## When to Use

### Integrity Checks
- After major refactoring
- Before releasing updates
- Periodic system health checks
- When something "feels broken"
- Before pushing to public jeremAIah repo

### Documentation
- End of significant work sessions
- After creating new skills/workflows/tools
- When architectural decisions are made
- To maintain system history

### Security Scanning
- Before any git commit to public repos
- When auditing for credential leaks
- Periodic security hygiene checks
- After receiving external code/content

### Privacy Validation
- After working with USER/ or WORK/ content
- Before any public commits
- When creating new skills that might reference personal data
- Periodic audit to ensure data isolation

### Work Context Recall
- When Daniel asks about past work ("we just fixed that")
- Questions about why decisions were made
- Finding artifacts from previous sessions
- Debugging something that was "already fixed"
- Resuming multi-session projects

---

## Tools

| Tool | Purpose | Location |
|------|---------|----------|
| **SecretScan.ts** | TruffleHog wrapper for credential detection | `Tools/SecretScan.ts` |
| **ValidateSkillSystemDocs.ts** | Validate SkillSystem router + section invariants (static) | `Tools/ValidateSkillSystemDocs.ts` |
| **SmokeTestSkillSystem.ts** | Static + parallel behavioral smoke tests for SkillSystem/create-skill | `Tools/SmokeTestSkillSystem.ts` |
| **CreateUpdate.ts** | Create new system update entries | `Tools/CreateUpdate.ts` |
| **UpdateIndex.ts** | Regenerate index.json and CHANGELOG.md | `Tools/UpdateIndex.ts` |
| **UpdateSearch.ts** | Search and query system updates | `Tools/UpdateSearch.ts` |

## Templates

| Template | Purpose | Location |
|----------|---------|----------|
| **Update.md** | Template for system update entries | `Templates/Update.md` |

---

## Output Locations

| Output | Location |
|--------|----------|
| Integrity Reports | `~/.config/opencode/MEMORY/STATE/integrity/<YYYY-MM-DD>.md` |
| System Updates | `~/.config/opencode/MEMORY/PAISYSTEMUPDATES/YYYY/MM/*.md` |
| Update Index | `~/.config/opencode/MEMORY/PAISYSTEMUPDATES/index.json` |
| Changelog | `~/.config/opencode/MEMORY/PAISYSTEMUPDATES/CHANGELOG.md` |

---

## Related Skills

- **PAI** - Public PAI repository management (includes PAIIntegrityCheck)
- **CORE** - System architecture and memory documentation
- **Evals** - Regression testing and capability verification
