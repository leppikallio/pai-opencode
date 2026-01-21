# Fresh Install Audit Mitigation Plan

**Created:** 2026-01-21
**Context:** Session 3 Fresh Install Test revealed 6 critical + 7 high severity issues
**System Integrity:** 69% → Target 90%+

---

## Executive Summary

The audit revealed that the converter **migrated documentation but not implementation**. Key infrastructure components (hooks/, plugins/, voice-server/) were never in converter scope.

### Root Cause
- Converter v0.9.5 only translates: settings, skills, agents, memory, tools
- Missing: hooks/, plugins/, observability/, voice-server/
- Result: Documentation describes features that don't exist

---

## Fix Categories

### Category A: CONVERTER EXPANSION (v0.9.6)
These require expanding the converter's scope.

| Component | Files | Fix |
|-----------|-------|-----|
| **hooks/** | 18 files + lib/ | Add `translateHooks()` |
| **plugins/** | adapters/, handlers/, lib/ | Add `translatePlugins()` |
| **package.json** | Dependencies | Add dependency merge |

### Category B: REPO FIXES (Direct)
These are bugs in the already-converted repository.

| Issue | Location | Fix |
|-------|----------|-----|
| Security regex | `.opencode/plugins/adapters/types.ts` | Fix `/tmp` pattern |
| Delegation rule | `.opencode/skills/CORE/SKILL.md` | Add rule |
| Missing dirs | `.opencode/MEMORY/` | Create RAW/, SESSIONS/, Backups/ |
| Settings schema | `.opencode/settings.json` | Fix schema structure |

### Category C: OUT OF SCOPE (v1.0)
Not vanilla PAI - requires user-specific setup.

| Component | Reason | Documentation |
|-----------|--------|---------------|
| Voice server | User API keys required | "Optional Setup Guide" |
| Observability | Dev tool, not core | "Optional Setup Guide" |

---

## Implementation Phases

### Phase 1: Immediate Repo Fixes (15 min)
Apply these directly to pai-opencode repository:

1. **Fix settings.json schema**
2. **Fix security regex**
3. **Add delegation rule to CORE SKILL.md**
4. **Create missing MEMORY directories**
5. **Create AnnualReports/Data/ stub**

### Phase 2: Converter Expansion (v0.9.6)
Expand converter to handle missing components:

1. **Add `translateHooks()`** - Migrate hooks/ directory
2. **Add `translatePlugins()`** - Migrate plugins/ directory
3. **Add dependency merge** - Merge package.json dependencies
4. **Add validation** - Post-conversion integrity check

### Phase 3: Documentation Updates
Update documentation to reflect reality:

1. **Create IMPLEMENTED.md** - What actually works
2. **Add status badges** - Implementation % per component
3. **Update README** - Accurate feature list
4. **Create OPTIONAL-SETUP.md** - Voice server, observability

---

## Detailed Fix Specifications

### Fix 1: Settings Schema (CRITICAL)

**Current (Wrong):**
```json
{
  "identity": { "assistant_name": "PAI" },
  "environment": { "PAI_DIR": ".opencode" }
}
```

**Required:**
```json
{
  "daidentity": {
    "name": "PAI",
    "fullName": "Personal AI",
    "voiceId": "OPTIONAL",
    "color": "#3B82F6"
  },
  "principal": {
    "name": "User",
    "timezone": "UTC"
  },
  "env": {
    "PAI_DIR": "$HOME/.opencode"
  },
  "hooks": {}
}
```

### Fix 2: Security Regex (CRITICAL)

**Current (Flawed):**
```typescript
/rm\s+-rf\s+\/(?!tmp)/,  // Allows /tmp deletion!
```

**Fixed:**
```typescript
/rm\s+-rf\s+\//,  // Block ALL root-level deletions
```

### Fix 3: Delegation Rule (CRITICAL)

**Add to CORE SKILL.md after Workflow Routing section:**

```markdown
## 🚨 DELEGATION RULE (CHECK BEFORE EVERY TASK!)

**BEFORE starting ANY multi-step or parallelizable task:**

### Quick Check:
- [ ] Multiple files to process? → Spawn 1 agent per file
- [ ] Multiple independent items? → Spawn 1 agent per item
- [ ] Comprehensive audit/analysis? → Spawn specialized agents
- [ ] Will this take >15 minutes? → Delegate to appropriate agent

**WHENEVER A TASK CAN BE PARALLELIZED → USE MULTIPLE AGENTS!**

**Model Selection:**
- Grunt work/verification → `model: "haiku"` (fast + cheap)
- Implementation/research → `model: "sonnet"` (balanced)
- Strategic planning → `model: "opus"` (maximum intelligence)
```

### Fix 4: Missing Directories

```bash
mkdir -p .opencode/MEMORY/{RAW,SESSIONS,Backups}
mkdir -p .opencode/skills/AnnualReports/{Data,Reports}
echo '{"sources":[]}' > .opencode/skills/AnnualReports/Data/sources.json
```

### Fix 5: npm Dependencies

```bash
cd pai-opencode
bun add replicate openai @google/generative-ai discord.js
```

---

## Converter Expansion Specification (v0.9.6)

### New Function: translateHooks()

```typescript
function translateHooks(source: string, target: string, dryRun: boolean, verbose: boolean): {
  converted: string[];
  warnings: string[];
} {
  const hooksSource = join(source, "hooks");
  const hooksTarget = join(target, "hooks");

  if (!existsSync(hooksSource)) {
    return { converted: [], warnings: ["No hooks/ directory in source"] };
  }

  // Copy all hook files
  // Replace .claude paths with .opencode
  // Update import paths
}
```

### New Function: translatePlugins()

```typescript
function translatePlugins(source: string, target: string, dryRun: boolean, verbose: boolean): {
  converted: string[];
  warnings: string[];
} {
  const pluginsSource = join(source, "plugins");
  const pluginsTarget = join(target, "plugins");

  // Handle Claude Code → OpenCode plugin API differences
  // This may require significant adaptation
}
```

### Hook Translation Challenges

| Claude Code | OpenCode | Translation |
|-------------|----------|-------------|
| SessionStart hook | `experimental.chat.system.transform` | Partial support |
| PreToolUse hook | `tool.execute.before` | Supported |
| PostToolUse hook | `tool.execute.after` | Supported |
| Stop hook | N/A | Need alternative |
| UserPromptSubmit | `chat.message` | Supported (v0.9.3) |

---

## Success Criteria

### Phase 1 Complete When:
- [ ] settings.json uses correct schema
- [ ] Security regex blocks /tmp deletion
- [ ] CORE SKILL.md contains delegation rule
- [ ] All MEMORY directories exist
- [ ] System integrity: 69% → 78%

### Phase 2 Complete When:
- [ ] Converter handles hooks/ directory
- [ ] Converter handles plugins/ directory
- [ ] Post-conversion validation passes
- [ ] System integrity: 78% → 85%

### Phase 3 Complete When:
- [ ] IMPLEMENTED.md documents actual features
- [ ] README reflects reality
- [ ] Optional setup guides exist
- [ ] System integrity: 85% → 90%

---

## LLM-Assisted Installation Consideration (v1.x)

The audit revealed a fundamental limitation of automated path translation:
**Context-blind conversion breaks dependencies.**

### The Problem
```
PAI Source → Blind Path Replace → OpenCode Target
         ↓
   Breaks when:
   - Paths have semantic meaning
   - Files reference each other
   - Platform APIs differ
```

### Daniel Miessler's Vision
PAI was designed for **LLM-assisted installation**:
1. AI reads source configuration
2. AI understands target platform
3. AI makes intelligent adaptations
4. AI validates result works

### Recommendation for v1.x
Consider hybrid approach:
1. **Automated**: File copying, basic path replace
2. **LLM-Assisted**: Dependency resolution, API adaptation, validation

This is OUT OF SCOPE for v1.0 but should be evaluated for v1.x.

---

## Next Steps

### Immediate (This Session)
1. Apply Phase 1 repo fixes
2. Commit and push fixes
3. Re-run fresh install test

### Next Session
1. Expand converter (v0.9.6)
2. Re-convert and test
3. Update documentation

### Future (v1.x)
1. Evaluate LLM-assisted installation
2. Build validation pipeline
3. Achieve 95%+ integrity

---

**Document Status:** ACTIVE
**Last Updated:** 2026-01-21
