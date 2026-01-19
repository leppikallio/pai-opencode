# PAI-to-OpenCode Converter Tool

**Version:** 0.9.1
**Purpose:** Automated migration of PAI 2.x configurations from Claude Code to OpenCode
**Performance:** Converts 767+ files in under 5 seconds

---

## Overview

The PAI-to-OpenCode Converter is a high-performance command-line tool that automatically translates Personal AI Infrastructure (PAI) configurations from Claude Code format to OpenCode format. This tool is the foundation of PAI-OpenCode's import capability, enabling you to:

- **Migrate existing PAI installations** from Claude Code to OpenCode
- **Import PAI updates** from the upstream repository
- **Maintain compatibility** with new PAI releases
- **Preserve your data** with automatic backups and dry-run mode

### Why This Matters

PAI-OpenCode follows the **"import capability over backwards compatibility"** principle. Rather than maintaining backwards compatibility with Claude Code formats, we provide a converter that automatically imports and translates new PAI releases. This means:

- You can upgrade to new PAI versions as they're released
- The OpenCode port remains in sync with upstream PAI development
- Platform-specific adaptations are handled automatically
- Manual work is minimized (only hooks → plugins require manual migration)

### What Gets Converted

The converter handles **4 major translation tasks**:

| Source | Target | Translation Method |
|--------|--------|-------------------|
| `settings.json` | `opencode.json` | Schema mapping (environment, MCP, identity) |
| `skills/` | `skill/` | Directory copy + path updates + YAML sanitization |
| `agents/` | `agent/` | Directory copy + color conversion (named → hex) |
| `MEMORY/` | `MEMORY/` | Direct copy with path reference updates |

The converter generates a detailed **migration report** documenting all changes and any manual work required.

---

## Quick Start

### Basic Usage

```bash
# Convert with defaults (from ~/.claude to .opencode)
bun run tools/pai-to-opencode-converter.ts

# Preview changes without modifying files
bun run tools/pai-to-opencode-converter.ts --dry-run --verbose

# Convert from specific source directory
bun run tools/pai-to-opencode-converter.ts --source /path/to/.claude --target .opencode
```

### Typical Workflow

```bash
# 1. Preview the conversion
bun run tools/pai-to-opencode-converter.ts --dry-run --verbose

# 2. Run the actual conversion
bun run tools/pai-to-opencode-converter.ts

# 3. Review the migration report
cat .opencode/MIGRATION-REPORT.md

# 4. Manually migrate hooks to plugins (see report)
# (Hooks require manual work - cannot be auto-translated)

# 5. Test the OpenCode installation
cd $(dirname .opencode)
opencode
```

---

## Features

### 1. Configuration Translation

**Translation:** `settings.json` → `opencode.json`

The converter maps PAI's settings schema to OpenCode's configuration format:

| PAI Field | OpenCode Field | Notes |
|-----------|----------------|-------|
| `principal.name` | `username` | User identity |
| `mcpServers` | `mcp` | MCP server configurations (may need adjustment) |
| `daidentity.*` | *(not mapped)* | AI identity handled via CORE skill customization |
| `permissions.*` | *(not mapped)* | Permissions handled via plugin system |
| `hooks.*` | *(not mapped)* | Hooks require manual migration to plugins |

**Output location:** `opencode.json` goes to project root (parent of `.opencode/`)

**Example:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "theme": "dark",
  "model": "anthropic/claude-sonnet-4-5",
  "snapshot": true,
  "username": "Steffen",
  "mcp": {
    "garrett-ai": {
      "command": "bun",
      "args": ["run", ".opencode/mcp-servers/garrett-ai/index.ts"]
    }
  }
}
```

### 2. Skills Translation

**Translation:** `skills/` → `skill/` (directory copy with transformations)

The converter copies all skill files and performs three key transformations:

1. **Path Updates:** `.claude/` → `.opencode/`
2. **Directory Corrections:** `.opencode/skills/` → `.opencode/skill/` (OpenCode uses singular)
3. **YAML Sanitization:** Quotes descriptions containing special characters (`:`, `'`, `"`, `#`, `|`, `>`)

**Example transformation:**

```yaml
# Before (PAI format)
---
name: Research
description: USE WHEN: research tasks, web search, content analysis
---

# After (OpenCode format)
---
name: Research
description: "USE WHEN: research tasks, web search, content analysis"
---
```

**Why YAML sanitization?** OpenCode's YAML parser is strict about special characters. The converter automatically quotes description fields that contain colons or other YAML-sensitive characters to prevent parsing errors.

### 3. Agents Translation

**Translation:** `agents/` → `agent/` (directory copy with color + model conversion)

The converter handles agent-specific requirements:

1. **Named Colors → Hex:** OpenCode requires `#RRGGBB` format (e.g., `cyan` → `"#00FFFF"`)
2. **Model Format Conversion:** OpenCode requires `provider/model` format
3. **Cost-Aware Model Assignment:** Different agents get different model tiers
4. **Unsupported Field Removal:** Removes PAI-specific fields (`voiceId`, `permissions`)
5. **Path Updates:** Same as skills (`.claude/` → `.opencode/`)

#### Model Mapping (v0.9+)

OpenCode requires full provider/model format instead of simple model names. The converter applies **cost-aware model assignment**:

| Agent Type | PAI Model | OpenCode Model | Rationale |
|------------|-----------|----------------|-----------|
| `intern` | `opus` | `anthropic/claude-haiku-4-5` | Grunt work, parallel tasks - fast & cheap |
| `explore` | `opus` | `anthropic/claude-haiku-4-5` | Fast exploration - speed over capability |
| All other named agents | `opus` | `anthropic/claude-sonnet-4-5` | Balanced cost/capability for implementation |

**Why not all Opus?** In PAI, the main orchestrator (Opus) delegates to named agents. Named agents don't need Opus-level capability - they execute specific tasks. Using Sonnet/Haiku for agents optimizes cost while maintaining quality.

**Model mapping in code:**

```typescript
// Cost-aware: intern/explore → haiku, all others → sonnet
const MODEL_MAPPING = {
  opus: "anthropic/claude-opus-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",
  haiku: "anthropic/claude-haiku-4-5",
};

const HAIKU_AGENTS = ["intern", "explore"];
```

**Supported named colors:**

| Name | Hex | Name | Hex |
|------|-----|------|-----|
| `red` | `#FF0000` | `green` | `#00FF00` |
| `blue` | `#0000FF` | `cyan` | `#00FFFF` |
| `magenta` | `#FF00FF` | `yellow` | `#FFFF00` |
| `orange` | `#FFA500` | `purple` | `#800080` |
| `pink` | `#FFC0CB` | `gray` / `grey` | `#808080` |
| `lime` | `#00FF00` | `navy` | `#000080` |
| `teal` | `#008080` | `olive` | `#808000` |
| `maroon` | `#800000` | `silver` | `#C0C0C0` |
| `coral` | `#FF7F50` | `gold` | `#FFD700` |
| `indigo` | `#4B0082` | `violet` | `#EE82EE` |

**Example transformation:**

```yaml
# Before (PAI format)
---
name: engineer
model: opus
color: cyan
voiceId: shimmer
permissions:
  allow: ["bash", "edit"]
---

# After (OpenCode format)
---
name: engineer
model: anthropic/claude-sonnet-4-5
color: "#00FFFF"
# voiceId removed (PAI-specific)
# permissions removed (use OpenCode plugins instead)
---
```

**Intern agent example (gets haiku):**

```yaml
# Before (PAI format)
---
name: intern
model: opus
color: green
---

# After (OpenCode format)
---
name: intern
model: anthropic/claude-haiku-4-5
color: "#00FF00"
---
```

### Agent Invocation in OpenCode (CRITICAL)

**This is a critical difference between PAI (Claude Code) and OpenCode!**

OpenCode has TWO different contexts for agent invocation. The AI and the User invoke agents differently:

| Who | Method | Works? |
|-----|--------|--------|
| **AI (Task tool)** | `Task({subagent_type: "Architect", prompt: ...})` | ✅ Yes - Creates clickable session |
| **AI (response text)** | `@architect design X` | ❌ No - This is just text! |
| **User (input field)** | `@architect design X` | ✅ Yes - Agent is invoked |

**Verified via testing (2026-01-19):**

```typescript
// ✅ WORKS - AI uses Task tool for agent delegation
Task({ subagent_type: "Intern", prompt: "research X" })
Task({ subagent_type: "Architect", prompt: "design Y" })
Task({ subagent_type: "Engineer", prompt: "implement Z" })

// ❌ DOES NOT WORK - @syntax in AI response is just text
@intern research X    // This does NOTHING when written by AI!
@architect design Y   // Agent is NOT called!
```

**Why this matters for migration:**

In PAI (Claude Code), the documentation may reference `@agentname` as a universal invocation method. In OpenCode, this ONLY works when the **user** types it in the input field. The AI must use the **Task tool** with `subagent_type` parameter.

**All these subagent_types work in OpenCode:**
- `Intern` (haiku)
- `Architect` (sonnet)
- `Engineer` (sonnet)
- `Designer` (sonnet)
- `Pentester` (sonnet)
- `Researcher` (sonnet)
- `Explore` (native)
- `Plan` (native)
- `general-purpose` (native)

**Migration action:** After conversion, ensure any AI delegation documentation refers to `Task({subagent_type})` syntax, not `@agentname` syntax.

### 4. MEMORY Copy

**Translation:** `MEMORY/` → `MEMORY/` (direct copy)

The MEMORY directory structure is compatible between PAI and OpenCode, so it's copied directly. The converter updates path references within files (`.claude/` → `.opencode/`) but preserves all session data, learnings, signals, and work artifacts.

**MEMORY structure:**

```
MEMORY/
├── History/              # Session transcripts
├── LEARNING/             # Captured learnings
├── Signals/              # Rating signals (quality feedback)
├── WORK/                 # Active work sessions
└── PAISYSTEMUPDATES/     # System update history
```

### 5. Migration Report

**Output:** `.opencode/MIGRATION-REPORT.md`

Every conversion generates a detailed migration report documenting:

- Files converted (count and paths)
- Warnings (permissions, hooks, MCP adjustments)
- Errors (if any)
- Manual work required (hooks → plugins mapping)
- Next steps for completing the migration

**Example report section:**

```markdown
## Hooks Requiring Manual Migration

The following hooks were found but **cannot be auto-translated** due to architectural differences:

| PAI Hook File | OpenCode Equivalent | Migration Notes |
|---------------|---------------------|-----------------|
| `security-validator.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `initialize-session.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
```

### 6. Automatic Backup

**Default:** Enabled (use `--no-backup` to disable)

Before modifying any files, the converter creates a timestamped backup:

```bash
.opencode.backup-1705708800000/
```

This allows you to roll back if needed:

```bash
# Restore from backup
rm -rf .opencode
mv .opencode.backup-1705708800000 .opencode
```

### 7. Dry Run Mode

**Flag:** `--dry-run`

Preview all changes without modifying any files. Combine with `--verbose` for detailed output:

```bash
bun run tools/pai-to-opencode-converter.ts --dry-run --verbose
```

**Output:**

```
╭──────────────────────────────────────────╮
│  PAI → OpenCode Converter v0.9.1        │
╰──────────────────────────────────────────╯

Source: /Users/steffen/.claude
Target: .opencode
Mode:   DRY RUN

📋 Translating settings.json...
  Reading: /Users/steffen/.claude/settings.json
  Writing: /Users/steffen/workspace/project/opencode.json

📚 Translating skills/...
  Copy: .claude/skills/CORE/SKILL.md → .opencode/skill/CORE/SKILL.md
  Copy: .claude/skills/Research/SKILL.md → .opencode/skill/Research/SKILL.md
  ...

🤖 Translating agents/...
  Color converted: cyan → #00FFFF in engineer.md
  ...

╭──────────────────────────────────────────╮
│  Conversion Complete                     │
╰──────────────────────────────────────────╯

✅ Converted: 767 files
⚠️  Warnings:  3
🔧 Manual:    5 items

This was a DRY RUN - no files were modified.
```

---

## CLI Options

### Complete Reference

```bash
bun run tools/pai-to-opencode-converter.ts [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--source <path>` | Source PAI directory | `~/.claude` |
| `--target <path>` | Target OpenCode directory | `.opencode` |
| `--dry-run` | Preview changes without modifying files | `false` |
| `--backup` | Create backup before conversion | `true` |
| `--no-backup` | Skip backup creation | `false` |
| `--verbose` | Show detailed output | `false` |
| `--help` / `-h` | Show help message | `false` |

### Path Expansion

The converter automatically expands `~` to your home directory:

```bash
# These are equivalent
--source ~/.claude
--source /Users/steffen/.claude
```

---

## Usage Examples

### Example 1: First-Time Migration

**Scenario:** Migrating your PAI installation from Claude Code to OpenCode for the first time.

```bash
# Step 1: Preview the migration
bun run tools/pai-to-opencode-converter.ts --dry-run --verbose

# Step 2: Review what will be converted
# Check the output carefully - especially warnings about MCP servers and hooks

# Step 3: Run the actual conversion
bun run tools/pai-to-opencode-converter.ts

# Step 4: Review the migration report
cat .opencode/MIGRATION-REPORT.md

# Step 5: Manually migrate hooks (see report for details)
# Create .opencode/plugin/pai-unified.ts based on your hooks

# Step 6: Test the OpenCode installation
opencode
```

### Example 2: Importing PAI Updates

**Scenario:** You're already using PAI-OpenCode and want to import updates from upstream PAI.

```bash
# Step 1: Update your vendor/PAI directory
cd vendor/PAI
git pull origin main
cd ../..

# Step 2: Run converter with backup
bun run tools/pai-to-opencode-converter.ts \
  --source vendor/PAI/.claude \
  --target .opencode \
  --verbose

# Step 3: Review changes
cat .opencode/MIGRATION-REPORT.md

# Step 4: Test that existing customizations still work
opencode
```

### Example 3: Converting a Custom PAI Fork

**Scenario:** You have a custom PAI fork with additional skills.

```bash
# Step 1: Dry run to see what will be converted
bun run tools/pai-to-opencode-converter.ts \
  --source /path/to/custom-pai/.claude \
  --target .opencode-custom \
  --dry-run \
  --verbose

# Step 2: Run conversion without backup (testing)
bun run tools/pai-to-opencode-converter.ts \
  --source /path/to/custom-pai/.claude \
  --target .opencode-custom \
  --no-backup

# Step 3: Review and test
cat .opencode-custom/MIGRATION-REPORT.md
```

### Example 4: Selective Migration

**Scenario:** You only want to import specific skills, not a full migration.

```bash
# Step 1: Run converter to a temporary directory
bun run tools/pai-to-opencode-converter.ts \
  --source ~/.claude \
  --target /tmp/pai-conversion \
  --no-backup

# Step 2: Copy only the skills you want
cp -r /tmp/pai-conversion/skill/Research .opencode/skill/
cp -r /tmp/pai-conversion/skill/Browser .opencode/skill/

# Step 3: Clean up
rm -rf /tmp/pai-conversion
```

---

## What Gets Converted

### Complete Translation Matrix

| Source Path | Target Path | Translation | Automatic? |
|-------------|-------------|-------------|------------|
| `settings.json` | `opencode.json` | Schema mapping | ✅ Yes |
| `skills/` | `skill/` | Directory copy + path updates + YAML sanitization | ✅ Yes |
| `agents/` | `agent/` | Directory copy + color conversion | ✅ Yes |
| `MEMORY/` | `MEMORY/` | Direct copy + path updates | ✅ Yes |
| `hooks/` | `plugin/` | *(no translation)* | ❌ Manual |
| `mcp-servers/` | `mcp-servers/` | Direct copy | ✅ Yes |
| `Plans/` | `Plans/` | Direct copy | ✅ Yes |
| `Commands/` | `Commands/` | Direct copy | ✅ Yes |
| `Backups/` | *(not copied)* | Excluded | N/A |

### Detailed Conversion Table

#### Configuration Files

| File | Converts? | Target | Notes |
|------|-----------|--------|-------|
| `settings.json` | ✅ Yes | `opencode.json` | Schema mapped to OpenCode format |
| `.clauderc` | ❌ No | *(ignored)* | Claude Code specific |
| `config.yaml` | ❌ No | *(ignored)* | Not used in PAI 2.x |

#### Skill Files

| Pattern | Converts? | Target | Transformations |
|---------|-----------|--------|----------------|
| `skills/*/SKILL.md` | ✅ Yes | `skill/*/SKILL.md` | Path updates, YAML sanitization |
| `skills/*/Workflows/*.md` | ✅ Yes | `skill/*/Workflows/*.md` | Path updates |
| `skills/*/Tools/*.ts` | ✅ Yes | `skill/*/Tools/*.ts` | Path updates |
| `skills/*/SYSTEM/*.md` | ✅ Yes | `skill/*/SYSTEM/*.md` | Path updates |
| `skills/*/USER/*` | ✅ Yes | `skill/*/USER/*` | Path updates (preserves user data) |

#### Agent Files

| Pattern | Converts? | Target | Transformations |
|---------|-----------|--------|----------------|
| `agents/*.md` | ✅ Yes | `agent/*.md` | Color conversion (named → hex) |
| `agents/Traits.yaml` | ✅ Yes | `agent/Traits.yaml` | Direct copy |

#### MEMORY Files

| Pattern | Converts? | Target | Notes |
|---------|-----------|--------|-------|
| `MEMORY/History/*` | ✅ Yes | `MEMORY/History/*` | Session transcripts preserved |
| `MEMORY/LEARNING/*` | ✅ Yes | `MEMORY/LEARNING/*` | Learnings preserved |
| `MEMORY/Signals/*` | ✅ Yes | `MEMORY/Signals/*` | Rating signals preserved |
| `MEMORY/WORK/*` | ✅ Yes | `MEMORY/WORK/*` | Work artifacts preserved |
| `MEMORY/PAISYSTEMUPDATES/*` | ✅ Yes | `MEMORY/PAISYSTEMUPDATES/*` | Update history preserved |

#### Hook Files

| Pattern | Converts? | Target | Manual Work Required |
|---------|-----------|--------|---------------------|
| `hooks/*.ts` | ❌ No | `plugin/*.ts` | Complete rewrite (see next section) |

---

## What Requires Manual Work

### Hooks → Plugins Migration

**Why manual work?** Hooks and plugins use fundamentally different architectures:

| Aspect | PAI Hooks (Claude Code) | OpenCode Plugins |
|--------|-------------------------|------------------|
| **Format** | Shell scripts | TypeScript modules |
| **Blocking** | Exit code 2 | Throw Error |
| **Event Names** | `PreToolUse`, `PostToolUse` | `tool.execute.before`, `tool.execute.after` |
| **Arguments** | `input.args` | `output.args` |
| **Tool Names** | PascalCase (`Bash`) | lowercase (`bash`) |
| **Logging** | `console.log()` | File-only (TUI corruption) |

### Migration Guide

The converter generates a detailed hook → plugin migration guide in `MIGRATION-REPORT.md`. Here's the basic pattern:

#### 1. PAI Hook Example (Claude Code)

```typescript
// hooks/security-validator.ts
export default async function(input: any) {
  const command = input.args?.command;

  // Check for dangerous patterns
  if (command?.includes("rm -rf /")) {
    console.log("BLOCKED: Dangerous command detected");
    process.exit(2); // Block execution
  }
}
```

#### 2. OpenCode Plugin Equivalent

```typescript
// plugin/pai-unified.ts
import type { PluginHook } from "@opencode/types";

export default {
  "tool.execute.before": async (input, output) => {
    // CRITICAL: Args are in OUTPUT, not input!
    const command = output.args?.command;

    // Check for dangerous patterns
    if (command?.includes("rm -rf /")) {
      // File-only logging (console.log corrupts TUI)
      await logToFile("/tmp/pai-opencode-debug.log", "BLOCKED: Dangerous command");

      // Throw to block execution
      throw new Error("Blocked: Dangerous command detected");
    }
  }
} satisfies PluginHook;
```

### Key Differences to Watch

1. **Args Location:** `output.args` (NOT `input.args`)
2. **Tool Names:** lowercase (`bash`, not `Bash`)
3. **Blocking Mechanism:** `throw Error` (NOT `process.exit(2)`)
4. **Logging:** File-only (NOT `console.log` - corrupts TUI)

### Hook → Event Mapping

| PAI Hook | OpenCode Event | Example Use Case |
|----------|----------------|------------------|
| `SessionStart` | `experimental.chat.system.transform` | Inject CORE skill context |
| `PreToolUse` | `tool.execute.before` | Block dangerous commands |
| `PostToolUse` | `tool.execute.after` | Log tool executions |
| `Stop` | `event` (filtered by `session.ended`) | Session cleanup |
| `SubagentStop` | *(not supported)* | Agent-specific cleanup |

**Complete guide:** See `docs/PLUGIN-ARCHITECTURE.md` and `docs/EVENT-MAPPING.md` for detailed hook → plugin migration patterns.

---

## Architecture

### How It Works

The converter follows a **4-phase pipeline**:

```
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 1: Validation                      │
│  • Check source directory exists                            │
│  • Parse CLI arguments                                       │
│  • Create backup (if enabled)                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 2: Translation                      │
│  • settings.json → opencode.json (schema mapping)           │
│  • skills/ → skill/ (copy + transforms)                     │
│  • agents/ → agent/ (copy + color conversion)               │
│  • MEMORY/ → MEMORY/ (direct copy)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  PHASE 3: Post-Processing                    │
│  • Update path references (.claude → .opencode)             │
│  • Sanitize YAML frontmatter (quote special chars)          │
│  • Convert agent colors (named → hex)                       │
│  • Remove unsupported fields (voiceId, permissions)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   PHASE 4: Reporting                         │
│  • Generate MIGRATION-REPORT.md                             │
│  • List converted files                                     │
│  • Document warnings and manual work                        │
│  • Provide next steps                                       │
└─────────────────────────────────────────────────────────────┘
```

### Internal Structure

```typescript
// Core translation functions
translateSettings()    // settings.json → opencode.json
translateSkills()      // skills/ → skill/
translateAgents()      // agents/ → agent/
translateMemory()      // MEMORY/ → MEMORY/

// Helper functions
copyDir()              // Recursive directory copy
convertColorToHex()    // Named color → #RRGGBB
generateMigrationReport() // Create detailed report

// CLI handling
parseCliArgs()         // Parse command-line arguments
printHelp()            // Display help message
main()                 // Orchestrate conversion pipeline
```

### Key Design Decisions

1. **Bun Runtime:** Uses Bun for fast file operations and TypeScript support
2. **Recursive Copying:** Preserves directory structure automatically
3. **In-Place Transformation:** Applies transformations after copying (not during)
4. **Explicit Warnings:** Documents every limitation and manual requirement
5. **Dry Run Support:** Allows preview before making changes
6. **Automatic Backup:** Protects against data loss

---

## Troubleshooting

### Common Issues

#### 1. Source directory not found

**Error:**

```
❌ Source directory not found: /Users/steffen/.claude
```

**Solution:**

```bash
# Check if the source directory exists
ls -la ~/.claude

# If it doesn't exist, specify the correct path
bun run tools/pai-to-opencode-converter.ts --source /path/to/actual/.claude
```

#### 2. Permission denied

**Error:**

```
Error: EACCES: permission denied, mkdir '.opencode'
```

**Solution:**

```bash
# Check directory permissions
ls -la $(dirname .opencode)

# Ensure you have write permissions
chmod u+w $(dirname .opencode)
```

#### 3. MCP servers not working after conversion

**Warning in report:**

```
⚠️ MCP servers copied but may need adjustment.
   OpenCode MCP format may differ slightly from Claude Code.
```

**Solution:**

```bash
# Review MCP server configurations
cat opencode.json

# Test each MCP server individually
opencode --mcp-server garrett-ai

# Check MCP server logs
tail -f /tmp/mcp-*.log
```

#### 4. YAML parsing errors after conversion

**Error:**

```
Error: YAML parsing failed in skill/Research/SKILL.md
```

**Solution:**

The converter should have quoted special characters automatically. If you still see errors:

```bash
# Find the problematic YAML
grep -n "description:" .opencode/skill/Research/SKILL.md

# Manually quote the description
# Before:
# description: USE WHEN: research tasks

# After:
# description: "USE WHEN: research tasks"
```

#### 5. Agent colors not displaying

**Issue:** Agent colors appear as gray after conversion.

**Cause:** The named color wasn't in the converter's color map.

**Solution:**

```bash
# Check the agent file
cat .opencode/agent/engineer.md

# If color is unknown, manually set hex value
# Example:
# color: "custom-blue" → color: "#0066CC"
```

#### 6. Hooks not working

**Expected behavior:** Hooks are NOT auto-converted. This is by design.

**Solution:**

See the "What Requires Manual Work" section above for hook → plugin migration guide.

#### 7. Dry run shows different results than actual run

**Cause:** File system state changed between dry run and actual run.

**Solution:**

```bash
# Always run dry-run immediately before the actual conversion
bun run tools/pai-to-opencode-converter.ts --dry-run --verbose && \
bun run tools/pai-to-opencode-converter.ts
```

### Debug Mode

For detailed debugging output:

```bash
# Run with verbose flag
bun run tools/pai-to-opencode-converter.ts --verbose 2>&1 | tee conversion.log

# Review the log
less conversion.log
```

### Getting Help

If you encounter issues not covered here:

1. **Check the migration report:** `.opencode/MIGRATION-REPORT.md`
2. **Review verbose output:** Re-run with `--verbose` flag
3. **Check OpenCode logs:** `tail -f /tmp/pai-opencode-debug.log`
4. **File an issue:** https://github.com/Steffen025/pai-opencode/issues

---

## Version History

### v0.9.1 (2026-01-19)

**Agent invocation documentation and fixes**

**Documentation Corrections:**
- ✅ Documented TWO invocation contexts (AI vs User)
- ✅ Fixed incorrect claim that `Task({subagent_type: "Architect"})` doesn't work
- ✅ Clarified `@agentname` only works for USER input, not AI responses
- ✅ Added Agent Invocation section to CONVERTER.md
- ✅ Updated PAIAGENTSYSTEM.md with verified test results
- ✅ Updated CORE SKILL.md with correct routing rules

**Test Results (verified 2026-01-19):**
| Method | Result |
|--------|--------|
| `Task({subagent_type: "Architect"})` | ✅ Works, clickable session |
| `Task({subagent_type: "Intern"})` | ✅ Works, clickable session |
| `@architect` in AI response | ❌ Just text, no agent called |
| User types `@architect` in input | ✅ Works |

---

### v0.9.0 (2026-01-19)

**Model mapping and cost-aware agent assignment**

**New Features:**
- ✅ Model format conversion (e.g., `opus` → `anthropic/claude-opus-4-5`)
- ✅ Cost-aware model assignment:
  - `intern`, `explore` → Haiku (cheap, fast for parallel tasks)
  - All other agents → Sonnet (balanced cost/capability)
- ✅ CORE skill updated for OpenCode configuration (`opencode.json`)

**Bug Fixes:**
- Fixed `ProviderModelNotFoundError` when using `@agent` delegation
- Fixed CORE skill searching for `settings.json` instead of `opencode.json`

---

### v0.8.0 (2026-01-19)

**Initial public release**

**Features:**
- ✅ settings.json → opencode.json translation
- ✅ skills/ → skill/ translation with YAML sanitization
- ✅ agents/ → agent/ translation with color conversion
- ✅ MEMORY/ direct copy
- ✅ Automatic backup creation
- ✅ Dry run mode
- ✅ Verbose logging
- ✅ Migration report generation

**Performance:**
- Converts 767+ files in under 5 seconds

**Known Limitations:**
- hooks/ → plugin/ requires manual migration (by design)
- MCP server configurations may need adjustment
- Agent permissions not translated (use OpenCode plugins)

### Future Roadmap

#### v0.9.0 (Planned)

- **Incremental updates:** Only convert changed files
- **Smart merge:** Preserve user customizations in USER/ directories
- **Hook templates:** Generate plugin skeleton from hook patterns
- **Validation mode:** Verify converted files are valid

#### v1.0.0 (Planned)

- **Interactive mode:** Ask user for decisions during conversion
- **Rollback support:** Built-in undo for failed conversions
- **Custom transformations:** User-defined conversion rules
- **Web UI:** Browser-based conversion tool

---

## References

### Documentation

- **Plugin Architecture:** [docs/PLUGIN-ARCHITECTURE.md](PLUGIN-ARCHITECTURE.md)
- **Event Mapping:** [docs/EVENT-MAPPING.md](EVENT-MAPPING.md)
- **Skills Migration:** [docs/SKILLS-MIGRATION.md](SKILLS-MIGRATION.md)
- **Agent Delegation:** [docs/AGENT-DELEGATION.md](AGENT-DELEGATION.md)

### External Links

- **PAI-OpenCode Repository:** https://github.com/Steffen025/pai-opencode
- **Original PAI (Daniel Miessler):** https://github.com/danielmiessler/PAI
- **OpenCode Documentation:** https://opencode.ai/docs
- **OpenCode Plugin API:** https://opencode.ai/docs/plugins

### Related Tools

- **SkillSearch:** Search skills by keyword
- **GenerateSkillIndex:** Build skill index for fast loading
- **Agent Wrapper:** Task API for agent delegation

---

## Contributing

Found a bug or have a feature request? Contributions welcome!

1. **File an issue:** https://github.com/Steffen025/pai-opencode/issues
2. **Submit a PR:** Fork the repo and create a pull request
3. **Share feedback:** Tell us how the converter works for you

**Contribution guidelines:** See [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**PAI-to-OpenCode Converter v0.9.1** - *Enabling seamless PAI migration to OpenCode*

---

🎯 **COMPLETED:** [AGENT:engineer] `docs/CONVERTER.md` created (comprehensive converter documentation with examples, troubleshooting, and architecture)
