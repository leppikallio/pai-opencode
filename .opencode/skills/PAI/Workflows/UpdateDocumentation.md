# UpdateDocumentation Workflow

> **Trigger:** "update architecture", "refresh PAI state", OR explicit request to sync architecture docs

## Purpose

Keeps PAI Architecture tracking current by:
1. Regenerating the Architecture.md file with current installation state
2. Logging upgrades to the history system
3. Verifying system health after changes

## When This Runs

### Manual Invocation
- User says "update my PAI architecture"
- User says "refresh PAI state"
- User says "what's installed?"

### Automatic Invocation

This workflow is currently **manual/preferred**, not mandatory automation.

Run it when:
- Significant architecture/configuration changes happened
- A user asks for architecture/state refresh
- You need a documented snapshot for handoff

## Workflow Steps

> **NOTE:** The OpenCode port does not ship a dedicated architecture regeneration tool yet. Treat this as a checklist workflow.

### Step 1: Regenerate Architecture

```bash
# Manual update: edit the relevant architecture docs directly.
# Example targets:
# - ~/.config/opencode/skills/PAI/SYSTEM/PAISYSTEMARCHITECTURE.md
# - ~/.config/opencode/skills/PAI/SYSTEM/DOCUMENTATIONINDEX.md
```

### Step 2: Log the Change (If Applicable)

If this was triggered by an installation or upgrade:

```bash
# Optional: record summary in WORK/LEARNING docs as needed.
```

### Step 3: Verify Health

```bash
# Recommended verification checks:
# bun ~/.config/opencode/skills/system/Tools/ScanBrokenRefs.ts
# bun ~/.config/opencode/skills/system/Tools/ValidateSkillSystemDocs.ts
```

### Step 4: Report Status

Output the current architecture state to confirm the update was successful.

## Integration with Pack Installation

Pack installation workflows may include this at the end when documentation actually changed:

```markdown
## Post-Installation: Update Documentation

After all installation steps complete:

1. Run UpdateDocumentation workflow (manual checklist)
2. Log installation/upgrade notes (if relevant)
3. Verify documentation coherence checks pass

\`\`\`bash
# see Step 3 checks above
\`\`\`
```

## Example Output

```
📋 SUMMARY: Updated PAI architecture documentation
⚡ ACTIONS:
  - Updated architecture docs
  - Logged upgrade: "Installed kai-voice-system v1.0.0"
  - Verified system health
✅ RESULTS: Documentation reflects current architecture state
📊 STATUS: All systems healthy
🎯 COMPLETED: Architecture docs updated and coherence checks passed.
```
