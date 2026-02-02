# UpdateDocumentation Workflow

> **Trigger:** "update architecture", "refresh PAI state", OR automatically after any pack/bundle installation

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

### Automatic Invocation (CRITICAL)
**This workflow MUST run automatically after:**
- Installing any PAI Pack
- Installing any PAI Bundle
- Making significant configuration changes
- Upgrading pack versions

## Workflow Steps

> **NOTE:** The OpenCode port does not ship an architecture tool yet. This workflow is a placeholder and does not execute any tool.

### Step 1: Regenerate Architecture

```bash
# (no-op)
```

### Step 2: Log the Change (If Applicable)

If this was triggered by an installation or upgrade:

```bash
# (no-op)
```

### Step 3: Verify Health

```bash
# (no-op)
```

### Step 4: Report Status

Output the current architecture state to confirm the update was successful.

## Integration with Pack Installation

**All pack installation workflows should include this at the end:**

```markdown
## Post-Installation: Update Documentation

After all installation steps complete:

1. Run UpdateDocumentation workflow (when available)
2. Log the pack installation (when available)
3. Verify the pack appears in Architecture.md (when available)

\`\`\`bash
# (no-op)
\`\`\`
```

## Example Output

```
📋 SUMMARY: Updated PAI Architecture documentation
⚡ ACTIONS:
  - Regenerated Architecture.md
  - Logged upgrade: "Installed kai-voice-system v1.0.0"
  - Verified system health
✅ RESULTS: Architecture.md now shows 4 packs, 1 bundle
📊 STATUS: All systems healthy
🎯 COMPLETED: Architecture updated - 4 packs installed, all healthy.
```
