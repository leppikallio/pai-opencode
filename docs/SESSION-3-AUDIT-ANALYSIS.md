# Session 3 Fresh Install Audit - Complete Analysis

**Date:** 2026-01-21
**Audit Location:** `/Users/opencode/pai-opencode/`
**System Integrity:** 69%

---

## Executive Summary

**Root Cause:** The converter migrated **documentation but not implementation**. Infrastructure components (hooks/, plugins/, voice-server/) were never in converter scope.

---

## Issue Inventory (Categorized)

### Category A: CONVERTER GAPS (v0.9.6 required)

| Component | Source Exists | Converted | Files Missing |
|-----------|--------------|-----------|---------------|
| **hooks/** | ✅ 18 files + lib/ | ❌ 0% | All 18 hook files |
| **plugins/lib/** | ✅ Exists | ❌ Partial | identity.ts schema issues |
| **observability/** | ✅ Exists | ❌ 0% | Dashboard app |
| **voice-server/** | ✅ Exists | ❌ 0% | TTS server |

**Converter currently translates:**
- `translateSettings()` - settings.json
- `translateSkills()` - skills/
- `translateAgents()` - agents/
- `translateMemory()` - MEMORY/
- `translateTools()` - Tools/

**Converter MISSING:**
- `translateHooks()` - hooks/ NOT CONVERTED
- `translatePlugins()` - plugins/ NOT CONVERTED
- `translateObservability()` - observability/ NOT CONVERTED
- Dependency merge - package.json deps NOT merged

### Category B: REPO BUGS (Direct fixes needed)

| Issue | File | Line | Problem | Fix |
|-------|------|------|---------|-----|
| **Settings schema** | `settings.json` | - | Uses `identity` not `daidentity` | Schema rewrite |
| **Security regex** | `plugins/adapters/types.ts` | 135 | `/rm\s+-rf\s+\/(?!tmp)/` allows /tmp | Remove `/(?!tmp)` |
| **Delegation rule** | `skills/CORE/SKILL.md` | - | Rule not present | Add rule |
| **Missing dirs** | `MEMORY/` | - | RAW/, SESSIONS/, Backups/ missing | Create |
| **AnnualReports** | `skills/AnnualReports/` | - | Data/, Reports/ missing | Create stubs |
| **npm deps** | `package.json` | - | Missing replicate, openai, etc. | bun add |

### Category C: OUT OF SCOPE (v1.0)

| Component | Reason | Resolution |
|-----------|--------|------------|
| Voice server | User API keys needed | Document as "Optional Setup" |
| Observability | Dev tool, not core | Document as "Optional Setup" |
| Custom hooks | User-specific automation | Document limitations |

---

## Specific Bug Details

### Bug 1: Settings Schema Mismatch (CRITICAL)

**Current (`settings.json`):**
```json
{
  "identity": { "assistant_name": "PAI" },
  "environment": { "PAI_DIR": ".opencode" }
}
```

**Expected by `identity.ts`:**
```json
{
  "daidentity": { "name": "PAI", "voiceId": "..." },
  "principal": { "name": "User", "timezone": "UTC" },
  "env": { "PAI_DIR": "..." }
}
```

**Result:** All identity lookups return DEFAULT values.

### Bug 2: Security Regex Flaw (CRITICAL)

**Location:** `plugins/adapters/types.ts` line 135

**Current:**
```typescript
/rm\s+-rf\s+\/(?!tmp)/,  // Allows /tmp deletion!
```

**Should be:**
```typescript
/rm\s+-rf\s+\//,  // Block ALL root-level deletions
```

**Risk:** `rm -rf /tmp` passes validation.

### Bug 3: Delegation Rule Missing (CRITICAL)

**Location:** `skills/CORE/SKILL.md`

**Missing section:**
```markdown
## DELEGATION RULE (CHECK BEFORE EVERY TASK!)

WHENEVER A TASK CAN BE PARALLELIZED → USE MULTIPLE AGENTS!

- Multiple files? → 1 agent per file
- Multiple items? → 1 agent per item
- Takes >15 min? → Delegate

Model Selection:
- Grunt work → haiku
- Implementation → sonnet
- Strategic → opus
```

**Impact:** AI does all work sequentially instead of parallel agents.

---

## Converter Expansion Specification (v0.9.6)

### Required New Functions

```typescript
// hooks/ directory
function translateHooks(source, target, dryRun, verbose)

// plugins/ directory (more complex - API differences)
function translatePlugins(source, target, dryRun, verbose)

// package.json dependency merge
function mergeDependencies(source, target, dryRun, verbose)
```

### Hook Translation Challenges

| PAI Hook | OpenCode API | Support |
|----------|-------------|---------|
| SessionStart | `experimental.chat.system.transform` | ✅ Works |
| PreToolUse | `tool.execute.before` | ✅ Works |
| PostToolUse | `tool.execute.after` | ✅ Works |
| Stop | None direct | ⚠️ Use `event` |
| UserPromptSubmit | `chat.message` | ✅ Works (v0.9.3) |

---

## Fix Plan Summary

### Phase 1: Repo Fixes (15 min)
1. Fix settings.json schema
2. Fix security regex
3. Add delegation rule to CORE SKILL
4. Create missing MEMORY dirs
5. Install npm deps

### Phase 2: Converter Expansion (v0.9.6)
1. Add `translateHooks()`
2. Add `translatePlugins()`
3. Add dependency merge
4. Expand validation

### Phase 3: Documentation
1. Create IMPLEMENTED.md
2. Add status badges
3. Update README
4. Create OPTIONAL-SETUP.md

---

## Files Changed in This Session

**Created:**
- `docs/AUDIT-MITIGATION-PLAN.md`
- `docs/SESSION-3-AUDIT-ANALYSIS.md` (this file)

**To be updated (next steps):**
- `settings.json` - Schema fix
- `plugins/adapters/types.ts` - Regex fix
- `skills/CORE/SKILL.md` - Add delegation rule
- `MEMORY/` - Create dirs
- `package.json` - Add deps

---

## Validation Commands

```bash
# Check settings schema
cat .opencode/settings.json | jq '.daidentity'

# Check security regex
grep -n "rm.*rf.*tmp" .opencode/plugins/adapters/types.ts

# Check delegation rule
grep -n "DELEGATION" .opencode/skills/CORE/SKILL.md

# Check MEMORY dirs
ls -la .opencode/MEMORY/

# Check deps
cat package.json | jq '.dependencies'
```

---

**Next Session:** Apply Phase 1 fixes, re-test, then expand converter.
