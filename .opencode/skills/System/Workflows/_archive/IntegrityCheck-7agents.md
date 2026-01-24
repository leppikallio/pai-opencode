# IntegrityCheck Workflow

## Trigger
"integrity check", "audit system", "system health", "verify integrity", "check system", "health check"

## Purpose
Comprehensive system-wide integrity verification that identifies and optionally fixes issues across the jeremAIah infrastructure.

## What It Does

Spawns parallel verification agents to check:

1. **File References** - Scans all markdown files for broken links and missing file references
2. **Skill Configurations** - Validates YAML frontmatter and SKILL.md structure
3. **Hook Configurations** - Verifies hook files are valid TypeScript with proper exports
4. **MEMORY Structure** - Checks directory structure and required files exist
5. **Git Repository** - Validates repo health and identifies uncommitted changes
6. **MCP Servers** - Verifies server configurations and connectivity
7. **Dependencies** - Checks package.json files and validates imports

## Execution Pattern

```typescript
// Use parallel Task agents with subagent_type="Explore"
const checks = [
  { name: "FileReferences", path: "$PAI_DIR/**/*.md" },
  { name: "SkillConfigs", path: "$PAI_DIR/skills/**/SKILL.md" },
  { name: "HookConfigs", path: "$PAI_DIR/hooks/**/*.ts" },
  { name: "MEMORYStructure", path: "$PAI_DIR/MEMORY" },
  { name: "GitHealth", path: "." },
  { name: "MCPServers", path: "$PAI_DIR/mcp-servers" },
  { name: "Dependencies", path: "$PAI_DIR/**/package.json" }
];

// Run all checks in parallel
// Aggregate results
// Report findings
```

## Verification Details

### 1. File References Check

**What to verify:**
- All markdown links `[text](path)` point to existing files
- All image references exist
- All `{path}` references in skill files are valid
- Cross-references between MEMORY files are intact

**Auto-fix capability:**
- Update paths that moved to known locations
- Remove references to intentionally deleted files
- Flag unknown broken links for manual review

**Search patterns:**
```regex
\[.*?\]\((.*?)\)           # Markdown links
!\[.*?\]\((.*?)\)          # Image references
\{([^}]+)\}                 # Path placeholders
```

### 2. Skill Configuration Check

**What to verify:**
- YAML frontmatter is valid
- Required fields present: `name`, `description`
- `description` includes "USE WHEN" clause
- Skill name matches directory name
- No duplicate skill names
- All referenced workflows exist

**Auto-fix capability:**
- Standardize YAML formatting
- Add missing required fields with placeholders
- Fix common YAML syntax errors

**Validation schema:**
```yaml
required:
  - name: string
  - description: string (must contain "USE WHEN")
optional:
  - version: string
  - dependencies: array
  - workflows: array
```

### 3. Hook Configuration Check

**What to verify:**
- TypeScript syntax is valid
- Required exports exist (default export or named function)
- No import errors
- Hook files match naming convention
- Hooks registered in settings.json match actual files

**Auto-fix capability:**
- Update import paths if files moved
- Flag syntax errors for manual fix
- Suggest missing hook registrations

**Checks:**
```typescript
// Verify each hook has proper structure
export default function hookName(context: HookContext) {
  // Implementation
}
```

### 4. MEMORY Structure Check

**What to verify:**
- Required directories exist:
  - Learning/
  - Work/
  - State/
  - projects/
  - research/
  - sessions/
- State files are valid JSON
- No corrupted JSONL files
- Directory naming follows conventions (YYYY-MM for date-based)

**Auto-fix capability:**
- Create missing required directories
- Repair malformed JSON with backup
- Archive orphaned files

**Required structure:**
```
MEMORY/
├── Learning/
│   ├── README.md
│   └── ALGORITHM/
├── Work/
├── State/
│   ├── algorithm-state.json
│   └── current-work.json
├── projects/
├── research/
└── sessions/
```

### 5. Git Health Check

**What to verify:**
- Repository is not corrupted
- No detached HEAD state
- Remote tracking configured
- No massive uncommitted binary files
- .gitignore is effective

**Auto-fix capability:**
- None (report only for safety)

**Checks:**
```bash
git fsck --full
git status --porcelain
git remote -v
```

### 6. MCP Server Check

**What to verify:**
- Server directories contain valid package.json
- Server scripts are executable
- Required dependencies installed
- Servers respond to health checks (if running)

**Auto-fix capability:**
- Run `bun install` in server directories
- Flag configuration issues

**Health check:**
```typescript
// Verify MCP server structure
const requiredFiles = ['package.json', 'index.ts', 'README.md'];
```

### 7. Dependencies Check

**What to verify:**
- All package.json files are valid JSON
- No missing dependencies in imports
- Bun lockfile is up to date
- No version conflicts

**Auto-fix capability:**
- Run `bun install` to sync lockfile
- Flag version conflicts for review

**Validation:**
```typescript
// Check all TypeScript imports resolve
// Verify package.json dependencies match actual usage
```

## Output Format

### Summary Report

```markdown
# jeremAIah Integrity Check Report
Generated: {timestamp}

## Executive Summary
- Total Checks: 7
- Issues Found: {count}
- Auto-Fixed: {count}
- Manual Action Required: {count}
- Overall Status: {HEALTHY|WARNINGS|CRITICAL}

## Detailed Results

### ✅ File References
- Scanned: 347 markdown files
- Links checked: 1,429
- Broken links: 0
- Auto-fixed: 0

### ✅ Skill Configurations
- Skills found: 20
- Valid configurations: 20
- YAML errors: 0
- Missing USE WHEN: 0

### ⚠️ Hook Configurations
- Hooks found: 8
- Valid TypeScript: 8
- Import errors: 0
- Warnings: 1
  - capture-all-events.ts: High CPU usage detected in logs

### ✅ MEMORY Structure
- Required directories: 6/6 present
- State files: Valid JSON
- Orphaned files: 0

### ✅ Git Repository
- Status: Clean
- Remote: origin configured
- Uncommitted changes: 23 files (normal working state)

### ✅ MCP Servers
- Servers found: 2
- Dependencies: Installed
- Health: Not running (expected)

### ⚠️ Dependencies
- package.json files: 4
- Outdated packages: 3
  - @types/node: 20.10.0 → 20.11.5
  - typescript: 5.3.3 → 5.4.2
  - vue: 3.4.15 → 3.4.19

## Actions Taken
1. Created missing MEMORY/archive directory
2. Fixed 2 broken links in Agents/SKILL.md (files moved to archive)

## Manual Actions Required
1. Review hook performance warning for capture-all-events.ts
2. Consider updating dependencies (run `bun update` in affected directories)
3. Review 23 uncommitted files - commit or stash if needed

## Recommendations
- Schedule integrity checks weekly
- Enable git pre-commit hooks for YAML validation
- Monitor hook performance metrics

---
Status: {HEALTHY|WARNINGS|CRITICAL}
Duration: {X.XX}s
```

### Status Levels

- **HEALTHY**: No issues or only minor warnings
- **WARNINGS**: Issues found but system functional, manual review recommended
- **CRITICAL**: Issues affecting core functionality, immediate action required

## Implementation Steps

When user triggers IntegrityCheck:

1. **Initialize**
   ```typescript
   const startTime = Date.now();
   const results = {
     checks: [],
     issuesFound: 0,
     autoFixed: 0,
     manualActionRequired: []
   };
   ```

2. **Spawn Parallel Agents**
   - Use Task tool with subagent_type="Explore"
   - Each agent runs one verification domain
   - Agents report findings in structured format

3. **Aggregate Results**
   - Collect all agent reports
   - Count totals (issues, fixes, warnings)
   - Determine overall status level

4. **Generate Report**
   - Create markdown report with summary
   - Detail each check with emoji status indicators
   - List all auto-fixes applied
   - List manual actions needed

5. **Save Report**
   ```bash
   $PAI_DIR/MEMORY/sessions/{date}/integrity-check-report.md
   ```

6. **Present to User**
   - Show summary in console
   - Provide path to full report
   - Highlight critical issues if any

## Example Usage

```
User: "Run an integrity check"

Jeremy: I'll perform a comprehensive system integrity check across all PAI components.

[Spawns 7 parallel verification agents]
[Agents complete checks]

## jeremAIah Integrity Check - Summary

✅ File References: 1,429 links checked, 0 broken
✅ Skills: 20 configurations valid
⚠️ Hooks: 1 performance warning
✅ MEMORY: Structure intact
✅ Git: Repository healthy
✅ MCP Servers: Configurations valid
⚠️ Dependencies: 3 packages outdated

**Overall Status: HEALTHY** (2 minor warnings)

Issues found: 4
Auto-fixed: 2
Manual review: 2

Full report saved to:
$PAI_DIR/MEMORY/sessions/2026-01/20260118T235500_integrity-check-report.md

Would you like me to address the warnings?
```

## Error Handling

- **Permission errors**: Report but continue other checks
- **Corrupted files**: Backup before attempting auto-fix
- **Timeout**: Individual checks timeout at 30s, report partial results
- **Agent failures**: Gracefully degrade, mark check as SKIPPED

## Integration Points

- **CORE skill**: Can request integrity check during session start
- **SpecFirst workflow**: Run integrity check before RELEASE phase
- **Stop hook**: Suggest integrity check if issues detected during session
- **Observability**: Log all integrity check results for trending

## Future Enhancements

- Automated weekly scheduled checks
- Performance benchmarking (check duration trends)
- Integration with git pre-commit hooks
- Slack/notification on CRITICAL status
- Historical comparison (issues trend over time)
- Fix preview mode (show what would be fixed without applying)

---

**Workflow Type**: Diagnostic
**Execution Time**: ~30-60 seconds (parallel)
**Destructive**: No (auto-fixes create backups)
**Requires User Input**: No
**Output**: Markdown report + console summary
