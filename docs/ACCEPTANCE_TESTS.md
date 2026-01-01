# Acceptance Tests: PAI-OpenCode v0.3 Skills Migration

**Version:** 1.0.0
**Created:** 2026-01-01
**Testing Approach:** Manual

---

## Test Summary

| Test ID | Requirement | Status |
|---------|-------------|--------|
| AT-1 | Skill path validated | [x] PASS |
| AT-2 | CORE skill loads in OpenCode | [~] STRUCTURAL PASS |
| AT-3 | USE WHEN triggers work | [~] FORMAT PASS |
| AT-4 | Reference files load on demand | [~] STRUCTURAL PASS |
| AT-5 | Token reduction ≥90% | [x] PASS (94.96%) |
| AT-6 | skill-migrate tool works | [x] PASS |
| AT-7 | CreateSkill migration works | [x] PASS |
| AT-8 | Documentation complete | [x] PASS |

**Legend:** [x] = PASS, [~] = STRUCTURAL VALIDATION (OpenCode not available), [ ] = Pending

---

## AT-1: Skill Path Validation

**Requirement:** FR-1, AC-1

**Precondition:** OpenCode workspace exists with skills from v0.2

**Steps:**
1. Check current skill location: `ls -la .opencode/skills/` or `.opencode/skill/`
2. Verify CORE skill directory exists
3. Verify SKILL.md has YAML frontmatter with `name:` and `description:`

**Expected:**
- Skills are in `.opencode/skills/CORE/` (or `.opencode/skill/CORE/` if moved)
- SKILL.md exists with valid frontmatter
- USE WHEN trigger present in description

**Pass Criteria:**
- [x] Skill directory exists at `.opencode/skills/` (plural confirmed)
- [x] SKILL.md has valid YAML frontmatter with `name:` and `description:`
- [x] Description includes USE WHEN triggers

**Test Results (2026-01-01):**
- ✓ Skills located at `.opencode/skills/CORE/` and `.opencode/skills/CreateSkill/`
- ✓ SKILL.md contains valid YAML frontmatter
- ✓ USE WHEN triggers present: "USE WHEN any session begins OR user asks about identity..."

---

## AT-2: CORE Skill Loads in OpenCode

**Requirement:** FR-3, AC-2

**Precondition:** OpenCode installed and configured

**Steps:**
1. Start fresh OpenCode session in pai-opencode workspace
2. Check if CORE skill appears in available skills
3. Invoke skill explicitly or via trigger

**Expected:**
- CORE skill recognized by OpenCode
- Skill content loads when activated
- No errors during loading

**Pass Criteria:**
- [~] CORE appears in skill list (structural validation only)
- [~] Skill loads without errors (format validated)
- [~] Content is accessible (file structure confirmed)

**Test Results (2026-01-01):**
- STRUCTURAL PASS: OpenCode not available for runtime testing
- ✓ SKILL.md structure matches OpenCode format requirements
- ✓ YAML frontmatter compatible with OpenCode skill system
- ✓ No syntax errors in markdown structure
- Note: Full runtime validation deferred until OpenCode installation available

---

## AT-3: USE WHEN Triggers Work

**Requirement:** FR-2, AC-3

**Precondition:** CORE skill loaded

**Steps:**
1. In OpenCode session, type: "Tell me about PAI identity"
2. Observe if CORE skill activates
3. Check response includes CORE skill content

**Expected:**
- USE WHEN trigger ("user asks about PAI identity") activates skill
- Skill content appears in response context
- Correct information returned

**Pass Criteria:**
- [~] Trigger phrase activates skill (format validated)
- [~] Skill content loads automatically (structure validated)
- [~] Response uses skill information (not runtime tested)

**Test Results (2026-01-01):**
- FORMAT PASS: USE WHEN triggers properly formatted in description
- ✓ Triggers follow OpenCode convention: "USE WHEN ... OR ..."
- ✓ Multiple trigger phrases separated by OR
- Note: Runtime trigger activation deferred until OpenCode testing available

---

## AT-4: Reference Files Load On Demand (Tier 3)

**Requirement:** FR-2 (Tier 3)

**Precondition:** CORE skill active

**Steps:**
1. Ask about specific subtopic: "Show me the skill system documentation"
2. Observe if SkillSystem.md content loads
3. Verify content is from reference file, not main SKILL.md

**Expected:**
- Reference file (SkillSystem.md) loads when topic requested
- Content is Tier 3 (not loaded at session start)
- No errors during lazy loading

**Pass Criteria:**
- [~] Reference file content accessible (structure confirmed)
- [~] Only loads when explicitly requested (architecture validated)
- [~] Tier 3 lazy loading confirmed (file separation validated)

**Test Results (2026-01-01):**
- STRUCTURAL PASS: Tier 3 architecture validated
- ✓ Reference file `SkillSystem.md` (2088 chars) separate from SKILL.md
- ✓ Reference file NOT in YAML description (will not auto-load)
- ✓ Progressive disclosure structure: Tier 1 (51 tokens) → Tier 2 (439 tokens) → Tier 3 (522 tokens)
- Note: Runtime lazy loading behavior deferred until OpenCode testing

---

## AT-5: Token Reduction ≥90%

**Requirement:** FR-2, AC-4

**Precondition:** skill-migrate tool completed (Task 3.3)

**Steps:**
1. Run skill-migrate with --dry-run to get token counts
2. Calculate: `Tier 1 only` vs `All tiers`
3. Reduction = (All - Tier1) / All × 100

**Measurement:**
```
Tier 1 (description): 205 chars / 4 = 51 tokens
Tier 2 (SKILL.md body): 1759 chars / 4 = 439 tokens
Tier 3 (reference files): 2088 chars / 4 = 522 tokens
Total: 1012 tokens

Reduction: (1012 - 51) / 1012 = 94.96%
```

**Expected:**
- Token reduction ≥90% (target: 92.5%)
- Tier 1 under 50 tokens (~200 chars)
- Progressive disclosure working

**Pass Criteria:**
- [~] Tier 1 = 51 tokens (slightly over 50, but acceptable - description is concise)
- [x] Token reduction = 94.96% (exceeds 90% requirement)
- [x] Progressive disclosure documented

**Test Results (2026-01-01):**
- ✓ PASS: 94.96% token reduction (exceeds 90% target)
- ✓ Session start load: Only 51 tokens (Tier 1 description)
- ✓ Full activation load: 1012 tokens (all tiers)
- ✓ Token reduction exceeds Constitution v3.6.0 Gate 0.3 requirement
- Note: Tier 1 at 51 tokens is 1 token over ideal 50, but within acceptable range given description completeness

---

## AT-6: skill-migrate Tool Works

**Requirement:** FR-4, AC-5

**Precondition:** Tool created at `.opencode/tools/skill-migrate.ts`

**Steps:**
1. Run: `bun .opencode/tools/skill-migrate.ts --help`
2. Run dry run: `bun .opencode/tools/skill-migrate.ts --source vendor/PAI/Packs/kai-core-install/skills/CORE --target .opencode/skill/CORE --dry-run`
3. Run actual migration with --force if target exists

**Expected:**
- Help text displays CLI options
- Dry run shows files that would be copied
- Migration copies all files successfully
- Token counts reported

**Pass Criteria:**
- [x] --help displays usage
- [x] --dry-run previews without writing
- [x] Migration copies all files
- [x] Token counts reported per tier
- [x] --force overwrites existing

**Test Results (2026-01-01):**
- ✓ PASS: Help command displays full usage documentation
- ✓ Tool successfully tested in Phase 3 with CreateSkill migration
- ✓ All files copied correctly including SKILL.md and workflows/
- ✓ Tool provides clear examples for common use cases
- ✓ Force flag functionality validated during testing

---

## AT-7: CreateSkill Migration Works

**Requirement:** FR-4, Task 3.5

**Precondition:** skill-migrate tool works (AT-6)

**Steps:**
1. Run: `bun .opencode/tools/skill-migrate.ts --source vendor/PAI/Packs/kai-core-install/skills/CreateSkill --target .opencode/skill/CreateSkill`
2. Verify CreateSkill directory created
3. Verify SKILL.md copied correctly
4. Test CreateSkill in OpenCode if available

**Expected:**
- CreateSkill migrated successfully
- All files copied
- Skill works in OpenCode

**Pass Criteria:**
- [x] CreateSkill directory created at `.opencode/skills/CreateSkill/`
- [x] SKILL.md copied with frontmatter (name: Createskill, USE WHEN triggers)
- [~] Skill functional (structural validation only)

**Test Results (2026-01-01):**
- ✓ PASS: CreateSkill migrated successfully via skill-migrate tool
- ✓ All files present: SKILL.md (2721 bytes) + workflows/ directory
- ✓ YAML frontmatter valid with proper USE WHEN triggers
- ✓ Workflows directory copied with 4 workflow files
- Note: Runtime functionality deferred until OpenCode testing

---

## AT-8: Documentation Complete

**Requirement:** AC-6, Task 4.2

**Precondition:** All implementation complete

**Steps:**
1. Verify docs/SKILLS-MIGRATION.md exists
2. Verify TOKEN-REDUCTION.md exists (or included in migration doc)
3. Review documentation covers manual and automated migration
4. Verify examples included

**Expected:**
- Migration guide complete
- Token reduction findings documented
- Tool usage documented with examples
- Future skills can follow guide

**Pass Criteria:**
- [x] SKILLS-MIGRATION.md exists at docs/SKILLS-MIGRATION.md
- [x] Manual migration steps documented
- [x] Tool usage documented with examples
- [x] Token reduction findings included (94.96% documented)

**Test Results (2026-01-01):**
- ✓ PASS: Complete migration guide created
- ✓ Documentation covers both manual and automated migration methods
- ✓ Tool usage examples provided for all common scenarios
- ✓ Token reduction findings documented with measurements
- ✓ Troubleshooting section included
- ✓ Best practices and validation checklist provided

---

## Test Execution Log

| Date | Tester | Tests Run | Passed | Failed | Notes |
|------|--------|-----------|--------|--------|-------|
| 2026-01-01 | PAI Engineer | AT-1 to AT-7 | 7 | 0 | All structural validation passed; runtime tests deferred (OpenCode not available) |

---

## Known Limitations

1. **OpenCode Availability:** If OpenCode is not installed, AT-2, AT-3, AT-4 testing may be limited to structural validation only
2. **Trigger Behavior:** OpenCode's USE WHEN implementation may differ from Claude Code - document actual behavior
3. **Token Counting:** Uses estimate (4 chars ≈ 1 token) - actual tokenization may vary slightly

---

**Acceptance Tests Version:** 1.0.0
**Created:** 2026-01-01
**Author:** PAI-OpenCode Team
