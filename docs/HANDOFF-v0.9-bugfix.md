# PAI-OpenCode v0.9 Bug-Fix Handoff

**Created:** 2026-01-19
**For:** Next session with Algorithm Skill
**Priority:** Fix blockers before v0.9 release

---

## Context

PAI-OpenCode v0.9 Integration Testing completed on 2026-01-19. Test results: 12 PASS, 3 PARTIAL, 2 FAIL, 1 SKIP.

**Full test results:** `docs/TEST-PLAN-v0.9.md`

The core functionality works (Plugins, Converter, Integration all pass), but there are blocking issues that need to be fixed before release.

---

## Algorithm Prompt

```
/THEALGORITHM effort STANDARD

Fix the PAI-OpenCode v0.9 blocker issues identified in testing.

## Repository
- Path: /Users/steffen/workspace/github.com/Steffen025/pai-opencode
- Current state: v0.9 testing complete, 2 blocking issues

## Blocker Issues to Fix

### Issue 1: Agent Model Format (HIGH PRIORITY)

**Problem:** Converter outputs `model: opus` but OpenCode expects `model: anthropic/claude-opus-4-5`

**Error:** `ProviderModelNotFoundError` when using @agent delegation

**Files affected:**
- `.opencode/agent/*.md` (13 agent files)
- `tools/pai-to-opencode-converter.ts` (converter logic)

**Fix approach:**
1. Add model mapping to converter:
   - `opus` → `anthropic/claude-opus-4-5`
   - `sonnet` → `anthropic/claude-sonnet-4-5`
   - `haiku` → `anthropic/claude-haiku-4-5`
2. Re-run converter OR manually fix existing agent files
3. Test with `@intern` delegation

**Acceptance criteria:**
- [ ] `@intern recherchiere X` works without ProviderModelNotFoundError
- [ ] All 13 agent files have correct model format
- [ ] Converter handles model translation for future runs

### Issue 2: CORE Path References (MEDIUM PRIORITY)

**Problem:** CORE skill searches for `settings.json` instead of `opencode.json`

**Files affected:**
- `.opencode/skill/CORE/SKILL.md`
- Possibly other files referencing Claude Code paths

**Fix approach:**
1. Search for `settings.json` references in `.opencode/skill/`
2. Replace with `opencode.json` or make configurable
3. Search for `.claude/` references and update to `.opencode/`

**Acceptance criteria:**
- [ ] CORE skill reads from `opencode.json`
- [ ] No hardcoded `.claude/` paths in `.opencode/skill/`

## Documentation Updates (After Fixes)

1. Update `docs/CONVERTER.md` with model mapping info
2. Update `CHANGELOG.md` with v0.9 fixes
3. Mark TEST-PLAN-v0.9.md as signed off

## Test Verification

After fixes, verify:
1. `@intern recherchiere was ist TypeScript` → No error, agent responds
2. Start fresh OpenCode session → CORE loads without settings.json error
3. Re-run Test 2.2, 2.3, 2.4 from TEST-PLAN-v0.9.md

## Files to Read First

1. `docs/TEST-PLAN-v0.9.md` - Full test results and details
2. `tools/pai-to-opencode-converter.ts` - Converter source
3. `.opencode/agent/intern.md` - Example agent file with wrong model
4. `.opencode/skill/CORE/SKILL.md` - CORE skill to check paths
```

---

## Quick Reference

| Issue | Severity | Fix Location | Effort |
|-------|----------|--------------|--------|
| Agent Model Format | 🔴 HIGH | Converter + Agent files | ~30 min |
| CORE Path References | 🟡 MEDIUM | CORE skill files | ~15 min |

---

## Success Criteria for v0.9 Release

After bug fixes:
- [ ] All 18 tests pass (or documented as "works differently in OpenCode")
- [ ] Agent delegation works without errors
- [ ] CORE loads correctly
- [ ] TEST-PLAN-v0.9.md signed off
- [ ] CHANGELOG.md updated
- [ ] Ready for community announcement
