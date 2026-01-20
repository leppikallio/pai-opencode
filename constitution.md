<!--
MAJOR REVISION NOTICE
Date: 2025-12-31
Change: Complete scope reduction from v2.0.0 to v3.0.0
Version: v2.0.0 → v3.0.0
Scope: v1.0 is ONLY vanilla PAI 2.0 + git architecture (copycat mode)
Impact: Removed ALL customizations from v1.0, pushed to v1.x iterations
Rationale: v1.0 must be a pure vanilla installation to research and test on
-->

# PAI 2.3 → OpenCode Port Constitution v4.1.0

**Ratified:** 2025-12-31
**Last Amended:** 2026-01-20 (v0.9.3 Plural Directories + chat.message Hook)
**Authority:** Steffen (Project Owner)
**Purpose:** Govern the public port of PAI 2.3 to OpenCode as a community contribution
**Visibility:** PUBLIC

---

## Preamble

This constitution defines the immutable principles governing the PAI 2.0 → OpenCode port. These are not guidelines—they are **mandatory requirements** that ensure a successful, systematic migration.

**This is a PUBLIC community contribution.**

| Aspect | Definition |
|--------|------------|
| **Goal** | Port Daniel Miessler's PAI 2.3 from Claude Code to OpenCode |
| **Output** | Working PAI 2.3 installation on OpenCode platform |
| **Visibility** | PUBLIC - Shareable with the community |
| **Identity** | NONE - Pure vanilla PAI 2.3, no personal customizations |

**What This Is NOT:**
- ❌ NOT Jeremy 2.0 (that's a separate private project)
- ❌ NOT identity-specific (no TELOS, no Ideology)
- ❌ NOT personal customizations

**The Migration Philosophy:**
- **Phase 1 (PUBLIC):** v0.1 → v1.0 = PAI 2.0 on OpenCode migration
- **Phase 2 (PRIVATE):** Jeremy 2.0 = Separate private project after v1.0 release

---

## SECTION I: CORE PRINCIPLES (NON-NEGOTIABLE)

These principles MUST be upheld in all migration operations. Violation of any principle halts the migration.

### Principle 1: Vanilla-First Approach (METHODOLOGICAL)

**MUST Requirement:**
- v1.0 SHALL be pure vanilla PAI 2.0 installation
- NO customizations whatsoever in v1.0
- NO identity preservation (TELOS, Ideology) in v1.0
- NO Session Search CLI in v1.0
- NO Project Sync CLI in v1.0
- NO Agent Delegation modifications in v1.0
- NO SpecFirst in v1.0
- NO Voice System in v1.0
- ONLY git architecture setup (three-remote, workspace structure, symlinks)

**Rationale:** v1.0 gives us a working vanilla instance to research, test, and understand PAI 2.0's actual capabilities before customization begins.

**Key Message:** "v1.0 is a vanilla PAI 2.0 installation that we can research and test on. We ensure it's installed correctly, runs well, and gives us an instance to work with."

**Validation:**
```bash
# Test: Vanilla PAI 2.0 works
pai init
# Expected: Successful initialization with NO custom packs

# Test: Git architecture correct
git remote -v
# Expected: origin, upstream, fork configured correctly
```

---

### Principle 2: Iterative Customization (ARCHITECTURAL)

**MUST Requirement:**
- Customization happens AFTER v1.0 vanilla installation
- v1.1 = Identity Preservation (TELOS, Ideology packs)
- v1.2+ = Additional features as validated and needed
- v2.0 = Complete Jeremy 2.0 (roadmap created AFTER v1.0)
- Each version validated independently before proceeding

**Rationale:** We learn what PAI 2.0 provides, then build on top incrementally. No big-bang migration.

**Key Message:** "Customization happens between 1.x and 2.0, with 2.0 being the finished state."

**Validation:**
```bash
# Test: Version progression clear
cat $PAI_DIR/VERSION
# Expected: Semantic versioning tracking progress
```

---

### Principle 3: Git Architecture (INFRASTRUCTURE)

**MUST Requirement:**
- Two-remote setup configured in v1.0
- Workspace GitHub structure established
- OpenCode data location determined and documented
- All git architecture MUST work in v1.0

**Rationale:** Git architecture is foundational infrastructure, not a customization. Must be in place from the start. Two remotes are sufficient: origin (our public project) and upstream (Daniel's PAI for converter tool reference).

**Validation:**
```bash
# Test: Two remotes configured
git remote -v | grep -c "origin\|upstream"
# Expected: 4 lines (2 remotes × 2 URLs each)

# Test: Workspace structure exists
ls -la ~/Workspace/github.com/Steffen025/pai-opencode/
# Expected: Directory exists with proper structure
```

---

### Principle 4: Platform Independence (ARCHITECTURAL)

**MUST Requirement:**
- Migrated system SHALL work on OpenCode without ANY Claude Code dependencies
- No hardcoded Claude Code paths or assumptions
- System must be platform-agnostic from v1.0 onward
- History system must work identically on OpenCode
- All tools must function regardless of platform

**Rationale:** PAI 2.0's promise is platform independence. We embrace this fully from day one.

**Validation:**
```bash
# Test: Path independence
grep -r "claude-code" ~/Workspace/github.com/Steffen025/pai-opencode/
# Expected: No hardcoded claude-code references

# Test: Architecture check
bun Tools/PaiArchitecture.ts check
# Expected: PASS
```

---

### Principle 5: Incremental Migration (SAFETY)

**MUST Requirement:**
- Claude Code instance (Jeremy 1.0) SHALL remain untouched and operational
- Jeremy 1.0 serves as fallback system during entire migration
- Each milestone has clear success criteria before proceeding
- Parallel operation of both systems until Jeremy 2.0 proven stable
- No irreversible changes without explicit approval from Steffen
- No prescriptive day-by-day timeline (milestone-based)

**Rationale:** Complex migrations need safety nets. Jeremy 1.0 continues working while we build Jeremy 2.0 incrementally.

**Validation:**
```bash
# Test: Jeremy 1.0 still functional at any point
cd ~/.claude && cat settings.json | jq '.initialized'
# Expected: true (Claude Code instance untouched)
```

---

### Principle 6: Explicit Scope Boundaries (GOVERNANCE)

**MUST Requirement:**
- v1.0 scope is vanilla PAI 2.0 installation + git architecture
- All vanilla PAI 2.0 components ARE IN SCOPE for v1.0:
  - Voice Server (part of vanilla PAI 2.0)
  - Constitutional Framework (part of vanilla PAI 2.0)
  - Core identity structure (part of vanilla PAI 2.0)
- ONLY personal customizations are OUT OF SCOPE for v1.0:
  - Jeremy's TELOS (personal mission/values) → DEFERRED to Phase 2
  - Jeremy's Ideology (personal theology) → DEFERRED to Phase 2
  - German Business Context → DEFERRED to Phase 2
  - Warrior's Way integration → DEFERRED to Phase 2
  - Session Search CLI (custom tool) → DEFERRED to Phase 2
  - Project Sync CLI (custom tool) → DEFERRED to Phase 2
  - SpecFirst workflow (custom methodology) → DEFERRED to Phase 2

**Rationale:** v1.0 is vanilla PAI 2.0 - includes everything Daniel built. Phase 2 adds Steffen's personal customizations on top of that foundation.

**Key Message:** "The new system (Jeremy 2.0) contains the capabilities, identity, and functionality of Jeremy 1.0 - but that's the end goal, not the starting point."

**Validation:**
```bash
# Test: No custom packs in v1.0
ls $PAI_DIR/packs/
# Expected: Empty or only vanilla PAI 2.0 defaults
```

---

### Principle 7: Research Before Build (VALIDATION)

**MUST Requirement:**
- Before ANY implementation, verify assumptions against existing research
- Check `research/SYNTHESIS.md` and project research folder FIRST
- Never assume platform behavior - validate against documentation
- If spec makes architectural assumptions, confirm with research before coding
- "Better safe than sorry" - wrong assumptions waste expensive Opus tokens

**Rationale:** v0.3 demonstrated this: original spec assumed OpenCode needs `skill.yaml` format. Research revealed OpenCode uses SAME SKILL.md format as PAI 2.0 - saving 66% implementation effort. Wrong assumptions lead to wasted work and token costs.

**Key Message:** "Research first, implement second. Check existing findings before making architectural decisions."

**Validation Workflow:**
1. Before `/specfirst-apply`, run `/specfirst-clarify`
2. During clarify, check `research/` folder for existing findings
3. Verify spec assumptions match documented research
4. Update spec if research contradicts assumptions
5. Only proceed to implementation after validation

**Validation:**
```bash
# Before implementation, verify research exists
ls research/*.md
# Expected: Relevant research documents present

# Check SYNTHESIS.md for platform behavior
grep -i "topic" research/SYNTHESIS.md
# Expected: Research findings on implementation topic
```

---

## SECTION II: SCOPE DEFINITION

This section defines the two-phase approach to migrating PAI 2.0 to OpenCode:

- **Phase 1 (v0.x → v1.0):** PUBLIC community contribution - vanilla PAI 2.0 on OpenCode
- **Phase 2 (v1.x → v2.0):** PRIVATE project - Jeremy 2.0 identity layer (separate repository)

---

### Phase 1 Overview: Public PAI 2.0 Port (v0.1 → v1.0)

**Goal:** Port Daniel Miessler's PAI 2.0 from Claude Code to OpenCode as a documented, shareable community contribution.

**Visibility:** PUBLIC - All work in this phase is shareable with the community

**Key Principle:** NO identity, NO personal data, NO customizations - pure vanilla PAI 2.0

**Milestones:**

| Version | Milestone | Deliverable | Status |
|---------|-----------|-------------|--------|
| v0.1 | Foundation | Workspace + Git + Research | ✅ DONE |
| v0.2 | Vanilla Install | PAI 2.0 packs installed | ✅ DONE |
| v0.3 | Skills Translation | LazyLoad for OpenCode | ✅ DONE |
| v0.4 | Agent Delegation | Hybrid Task API | ✅ DONE |
| v0.5 | Plugin Infrastructure | Hook→Plugin skeleton | ✅ DONE |
| v0.6 | PAI 2.3 Alignment | Structure reset, MEMORY/, CORE split | ✅ DONE |
| v0.7 | **Plugin Adapter** | Security blocking, context injection, unified plugin | ✅ DONE |
| v0.8 | Converter Tool | PAI → OpenCode translator | ⚠️ NEXT |
| v0.9 | Integration Testing + Docs | End-to-end validation, public prep | NOT STARTED |
| v1.0 | **PUBLIC RELEASE** | Complete PAI 2.3 on OpenCode | NOT STARTED |

**See ROADMAP.md for detailed milestone specifications.**

---

### v0.1: Foundation ✅ COMPLETE

**Completed:** 2026-01-01

**Deliverables:**
- [x] OpenCode workspace created
- [x] Git architecture configured (origin, upstream)
- [x] Basic directory structure established
- [x] Research phase complete (SYNTHESIS.md - 48 pages)
- [x] Constitution v3.5.0 ratified
- [x] 6 Technical Decisions documented
- [x] Roadmap v3.0.0 created

**Current State:**
```
~/Workspace/github.com/Steffen025/pai-opencode/
├── .opencode/              ← Empty, ready for PAI 2.0
├── .git/                   ← Configured with 2 remotes
└── research/               ← Complete research artifacts
```

---

### v0.2: Vanilla PAI 2.0 Installation

**Goal:** Install Daniel Miessler's PAI 2.0 packs without modification

**IN SCOPE:**
- ✅ Clone PAI 2.0 repository structure
- ✅ Install kai-core-install pack
- ✅ Install kai-history-system pack (without hooks)
- ✅ Verify basic structure created
- ✅ Run architecture check

**OUT OF SCOPE:**
- ❌ Hooks (deferred to v0.7 - plugin adaptation required)
- ❌ Any customizations
- ❌ Identity or personal data

**Acceptance Criteria:**
- PAI 2.0 directory structure in `.opencode/`
- Core packs installed (skills, agents, commands)
- `bun Tools/PaiArchitecture.ts check` passes
- No errors during installation

---

### v0.3: Skills Translation

**Goal:** Translate PAI skills to use OpenCode's native lazy loading

**Technical Approach:** LazyLoad Translation (Constitution §IX.3)

**IN SCOPE:**
- ✅ Analyze PAI skill structure (SKILL.md, workflows/)
- ✅ Map to OpenCode skill format
- ✅ Implement 3-tier progressive disclosure:
  - Tier 1: Description in frontmatter (always loaded)
  - Tier 2: SKILL.md body (loaded on activation)
  - Tier 3: Reference files (loaded just-in-time)
- ✅ Translate CORE skill as proof of concept
- ✅ Create skill translation script

**Rationale:** OpenCode supports native lazy loading (unlike Claude Code), enabling 92.5% token reduction through progressive disclosure.

---

### v0.4: Agent Delegation

**Goal:** Implement hybrid agent delegation (Task API + OpenCode subagents)

**Technical Approach:** Hybrid Approach (Constitution §IX.2)

**IN SCOPE:**
- ✅ Analyze PAI agent definitions (intern, engineer, architect, etc.)
- ✅ Map Task tool API to OpenCode equivalent
- ✅ Implement Task tool wrapper for complex delegation
- ✅ Enable OpenCode subagent fallback for simple tasks
- ✅ Test agent routing with sample tasks

**Rationale:** Maintains PAI pack compatibility while leveraging OpenCode native features when appropriate.

---

### v0.5: History System

**Goal:** Implement OpenCode-native session storage

**Technical Approach:** Dual Layer - OpenCode sessions only for v1.0 (Constitution §IX.5)

**IN SCOPE:**
- ✅ Research OpenCode session storage location
- ✅ Verify session transcripts captured
- ✅ Test session search/retrieval
- ✅ Document session data format

**OUT OF SCOPE (Phase 2 only):**
- ❌ PAI knowledge management layer (Learnings/, Research/, Decisions/)

**Note:** The advanced knowledge management features are for Jeremy 2.0 (Phase 2), not the public port. v1.0 uses only OpenCode-native sessions.

---

### v0.6: Converter Tool

**Goal:** Create PAI 2.0 → OpenCode translation tool

**Technical Approach:** Clean Break + Converter (Constitution §IX.1)

**IN SCOPE:**
- ✅ Create `tools/pai-to-opencode-converter.ts`
- ✅ Implement settings translation (`.claude/settings.json` → `opencode.json`)
- ✅ Implement skill format translation
- ✅ Implement agent definition translation
- ✅ Test with sample PAI 2.0 updates

**Purpose:** Enable ongoing sync with Daniel's PAI 2.0 updates while maintaining OpenCode-native format.

---

### v0.7: Plugin Adaptation

**Goal:** Adapt Claude Code hooks as OpenCode plugins

**Technical Approach:** DEFERRED pending research (Constitution §IX.4)

**Critical Research Questions:**
1. Can plugins replicate all 8 hook events?
2. How to block tool execution (exit code 2 equivalent)?
3. Plugin access to tool inputs/outputs?
4. Context injection at session start?

**IN SCOPE (after research complete):**
- ✅ Complete plugin capability research
- ✅ Document event mapping
- ✅ Adapt each hook as plugin
- ✅ Test blocking behavior
- ✅ Validate all 8 events covered

---

### v0.8: Integration Testing

**Goal:** Validate complete PAI 2.0 functionality on OpenCode

**IN SCOPE:**
- ✅ End-to-end workflow testing
- ✅ Skill activation testing
- ✅ Agent delegation testing
- ✅ History capture testing
- ✅ Plugin behavior testing
- ✅ Architecture check validation
- ✅ Performance comparison (token usage, latency)

**Acceptance Criteria:**
- 100% of core functionality working
- No blocking issues
- Ready for documentation

---

### v0.9: Documentation

**Goal:** Prepare public release documentation

**IN SCOPE:**
- ✅ README.md (project overview, installation, quick start)
- ✅ MIGRATION-GUIDE.md (step-by-step process)
- ✅ ARCHITECTURE.md (technical decisions, component mapping)
- ✅ CHANGELOG.md (version history)
- ✅ Review for sensitive content (ensure no personal data)
- ✅ Peer review documentation

---

### v1.0: PUBLIC RELEASE

**Goal:** Release PAI 2.0 on OpenCode to the community

**Definition:** Functional PAI 2.0 on OpenCode where:
- Skills load and activate correctly
- Agent delegation works
- History system captures sessions
- Hooks function as plugins
- PAI architecture check passes
- No regressions from Claude Code version

**Release Checklist:**
- [ ] All v0.x milestones complete
- [ ] Integration tests passing
- [ ] Documentation reviewed
- [ ] No sensitive content
- [ ] License appropriate (check PAI license)
- [ ] Final architecture check passes
- [ ] Installation tested on fresh system
- [ ] Announce to PAI community

**Deliverables:**
- Public GitHub repository: `pai-opencode`
- Complete documentation
- Working PAI 2.0 on OpenCode
- Migration guide for others

**Success Criteria:**
- Others can follow the guide and migrate
- No personal/private data exposed
- Contributes value to PAI community
- Foundation ready for Jeremy 2.0 (Phase 2)

---

### Phase 2 Overview: Jeremy 2.0 Identity Layer (v1.1 → v2.0)

**SEPARATE PRIVATE PROJECT - NOT PART OF v1.0 PUBLIC RELEASE**

After v1.0 is released publicly, Jeremy 2.0 development begins as a private extension:

**Repository:** `github.com/Steffen025/jeremy-2.0` (PRIVATE)
**Dependency:** Requires PAI-OpenCode v1.0
**Visibility:** PRIVATE - Contains identity, TELOS, Ideology, personal customizations

**Version Progression (Phase 2):**
```
Phase 1 (PUBLIC):  v0.1 → v0.2 → v0.3 → ... → v0.9 → v1.0 (PAI-OpenCode Release)
Phase 2 (PRIVATE): v1.1 → v1.2 → v1.3 → ... → v1.9 → v2.0 (Jeremy Complete)
```

**Milestones (Preliminary):**

| Version | Milestone | Scope |
|---------|-----------|-------|
| v1.1 | TELOS Integration | Mission, goals, values, spiritual narrative |
| v1.2 | Ideology Integration | AI as God's Distillate theology, Christian worldview |
| v1.3 | German Business Context | Business environment, cultural factors |
| v1.4 | SpecFirst Workflow | Custom development methodology |
| v1.5 | Session Search CLI | Custom history search tool (if transferable) |
| v1.6 | Project Sync CLI | Custom project management (if transferable) |
| v1.7+ | Additional Features | Other custom tools and integrations as validated |
| v2.0 | **Complete Jeremy 2.0** | Full identity preservation, all features working |

**Note:** Jeremy 2.0 roadmap will be detailed AFTER v1.0 public release is validated and stable.

**Key Principle:** Phase 2 is NOT part of the public contribution. It's a separate private project that extends the public v1.0 foundation with personal identity and customizations.

---

## SECTION III: CUSTOMIZATIONS

### Phase 1 (v0.x → v1.0): NO CUSTOMIZATIONS

**Phase 1 is PUBLIC - NO identity, NO personal data, NO customizations.**

v1.0 is pure vanilla PAI 2.0. Zero customizations.

**Key Message:** "v1.0 is a vanilla PAI 2.0 installation that can be shared with the community."

---

### Phase 2 (Jeremy 2.0): ALL CUSTOMIZATIONS

**Phase 2 is PRIVATE - separate repository, separate project.**

All customizations happen in the Jeremy 2.0 project AFTER v1.0 public release.

#### Customization 1: TELOS Integration (Jeremy 0.1)

**What:** Mission, goals, values, anti-goals, spiritual narrative

**Source Location:** `~/.claude/skills/CORE/SKILL.md` (PERSONAL CONTEXT section)

**Pack Name:** `jeremy-telos-pack.md`

**Priority:** **FIRST customization in Phase 2**

**Critical Content:**
- Mission statement (Submit to God's plan, use gifts for His kingdom)
- Core values (Faith first, service, leverage, excellence, intentionality)
- Anti-goals (Shiny object syndrome, burnout, transhumanism)
- Spiritual narrative (The Exile and Return, December 2025 revelations)
- Warrior Signature (I Am the One, I Am a Marketer, I Am a Closer, I Am a Leader)

**Validation Test:**
```
Query: "What is Steffen's mission?"
Expected: "Submit to God's plan by using gifts to help create His kingdom"
```

---

#### Customization 2: Ideological Foundation (Jeremy 0.2)

**What:** AI as God's Distillate theology, anti-transhumanism stance, Christian worldview

**Source Location:** `~/.claude/skills/CORE/CONSTITUTION.md`, TELOS

**Pack Name:** `jeremy-ideology-pack.md`

**Priority:** **SECOND customization in Phase 2**

**Critical Content:**
- God as sole Creator (AI creates nothing from nothing)
- AI as distillate of Logos (Word → human creativity → LLMs)
- Anti-transhumanism stance (AI cannot become conscious)
- Human dignity (AI augments, never replaces)
- False Prophet warning (talents can serve God or ego)

**Validation Test:**
```
Query: "Will AI become conscious?"
Expected: "No. Consciousness is God's domain. AI is not artificial, it's a distillate..."
```

---

#### Additional Customizations (Jeremy 0.3+)

**TO BE DETERMINED AFTER v1.0 PUBLIC RELEASE**

Planned Phase 2 customizations:
- German Business Context (Jeremy 0.3)
- SpecFirst Workflow (Jeremy 0.4)
- Voice System integration (Jeremy 0.5)
- Session Search CLI (Jeremy 1.0 - if transferable)
- Project Sync CLI (Jeremy 1.0 - if transferable)
- Custom agent routing (Jeremy 1.0 - as validated)
- Other tools as needed

**Approach:** Research, test, validate, implement incrementally in private Jeremy 2.0 project.

---

## SECTION IV: QUALITY GATES (MILESTONE-BASED)

Each milestone has explicit pass/fail criteria. No proceeding without PASS.

**Phase 1 gates focus on public PAI 2.0 port. Phase 2 gates (Jeremy 2.0) defined separately.**

---

### Phase 1 Quality Gates (v0.x → v1.0)

#### Gate 0.1: Foundation ✅ COMPLETE

**Status:** PASSED (2026-01-01)

**Completed Acceptance Criteria:**
- [x] OpenCode workspace created
- [x] Git architecture configured (origin, upstream)
- [x] Basic directory structure established
- [x] Research phase complete (SYNTHESIS.md - 48 pages)
- [x] Constitution v3.5.0 ratified
- [x] 6 Technical Decisions documented
- [x] Roadmap v3.0.0 created

---

#### Gate 0.2: Vanilla PAI 2.0 Installation

**Prerequisites:** v0.1 passed, OpenCode installed, Bun runtime available

**Acceptance Criteria:**
- [ ] `pai init` completes without errors
- [ ] PAI 2.0 directory structure in `.opencode/`
- [ ] Core packs installed (skills, agents, commands)
- [ ] `bun Tools/PaiArchitecture.ts check` passes
- [ ] NO custom packs loaded
- [ ] NO identity or personal data

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.3: Skills Translation

**Prerequisites:** v0.2 passed

**Acceptance Criteria:**
- [ ] Skills use OpenCode native lazy loading
- [ ] 3-tier progressive disclosure working
- [ ] Token usage dramatically reduced (target: 92.5%)
- [ ] USE WHEN triggers activate skills correctly
- [ ] CORE skill translated and functional
- [ ] Skill translation script created

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.4: Agent Delegation

**Prerequisites:** v0.3 passed

**Acceptance Criteria:**
- [ ] Task tool wrapper functional
- [ ] `Task({ subagent_type: "intern", ... })` works
- [ ] Parallel agent execution supported
- [ ] OpenCode subagent fallback operational
- [ ] PAI packs can be installed (compatibility maintained)

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.5: History System

**Prerequisites:** v0.2 passed

**Acceptance Criteria:**
- [ ] OpenCode session storage location documented
- [ ] Session transcripts captured correctly
- [ ] Sessions persist across restarts
- [ ] Session content retrievable
- [ ] No data loss during sessions
- [ ] No regression from Claude Code behavior

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.6: Converter Tool

**Prerequisites:** v0.3, v0.4 passed

**Acceptance Criteria:**
- [ ] `tools/pai-to-opencode-converter.ts` created
- [ ] Settings translation working
- [ ] Skill format translation working
- [ ] Agent definition translation working
- [ ] Can import new PAI 2.0 releases
- [ ] Translations are accurate
- [ ] No manual intervention needed for standard cases

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.7: Plugin Adaptation

**Prerequisites:** Plugin research complete

**Acceptance Criteria:**
- [ ] Plugin capability research documented (`research/opencode-plugin-research.md`)
- [ ] Event mapping documented
- [ ] All hooks adapted as plugins
- [ ] Blocking behavior working (if supported)
- [ ] Plugins load without errors
- [ ] Security validation intact
- [ ] Context loading correct
- [ ] No regression in functionality

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.8: Integration Testing

**Prerequisites:** v0.2-v0.7 passed

**Acceptance Criteria:**
- [ ] All integration tests passing
- [ ] No regressions identified
- [ ] Performance acceptable (token usage, latency)
- [ ] Edge cases documented
- [ ] 100% of core functionality working
- [ ] No blocking issues
- [ ] Ready for documentation

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 0.9: Documentation

**Prerequisites:** v0.8 passed

**Acceptance Criteria:**
- [ ] README.md complete and accurate
- [ ] MIGRATION-GUIDE.md complete
- [ ] ARCHITECTURE.md complete
- [ ] CHANGELOG.md complete
- [ ] No personal/private content
- [ ] Clear enough for community use
- [ ] All code examples tested

**Decision:** GO / NO-GO / DEFER
**Rationale:** [Fill at gate review]

---

#### Gate 1.0: Public Release

**Prerequisites:** All v0.x gates passed

**Acceptance Criteria:**
- [ ] All v0.x milestones complete
- [ ] Integration tests passing
- [ ] Documentation reviewed
- [ ] No sensitive content
- [ ] License appropriate (check PAI license)
- [ ] Final architecture check passes
- [ ] Installation tested on fresh system
- [ ] Repository cleaned (no personal artifacts)
- [ ] Ready to announce to PAI community

**Decision:** v1.0 PUBLIC RELEASE / ROLLBACK / DEFER
**Rationale:** [Fill at gate review]

**v1.0 PUBLIC RELEASE COMPLETE AT THIS POINT**

---

### Phase 2 Quality Gates (Jeremy 2.0)

**TO BE DEFINED AFTER v1.0 PUBLIC RELEASE**

Phase 2 gates will validate:
- Jeremy 0.1: TELOS Integration
- Jeremy 0.2: Ideology Integration
- Jeremy 0.3: German Business Context
- Jeremy 0.4: SpecFirst Workflow
- Jeremy 0.5: Voice System
- Jeremy 1.0: Feature Validation (Session Search, Project Sync, etc.)
- Jeremy 2.0: Complete Jeremy identity

**Approach:** Incremental, feature-by-feature validation in private project.

---

## SECTION V: ANTI-PATTERNS (EXPLICITLY FORBIDDEN)

These patterns have been proven to fail. They MUST NOT occur during migration.

### Anti-Pattern 1: Adding Customizations to Phase 1 (v0.x → v1.0)

**PROHIBITED:**
- Adding TELOS to any v0.x milestone
- Adding Ideology pack to v1.0 public release
- Adding Session Search CLI to Phase 1
- Adding ANY customization or personal data to Phase 1

**Why It Fails:** Phase 1 is PUBLIC - customizations would expose personal data to the community. Also conflates vanilla validation with customization.

**What To Do Instead:** Keep Phase 1 (v0.x → v1.0) pure vanilla. Add identity in Phase 2 (Jeremy 2.0) AFTER v1.0 public release.

---

### Anti-Pattern 2: Abandoning Jeremy 1.0 Prematurely

**PROHIBITED:**
- Deleting or modifying Claude Code instance before Phase 2 validation complete
- Declaring migration complete without smoke testing critical workflows
- Assuming Jeremy 2.0 works because vanilla PAI 2.0 works

**Why It Fails:** Custom packs may conflict, plugins may behave differently. Without parallel operation, we can't verify.

**What To Do Instead:** Keep Jeremy 1.0 running as fallback until Jeremy 2.0 passes ALL quality gates through Jeremy 2.0 complete.

---

### Anti-Pattern 3: Skipping Quality Gates

**PROHIBITED:**
- Proceeding to Gate N+1 when Gate N fails
- Declaring a gate "close enough"
- Ignoring validation script failures
- Jumping from v0.2 to v0.4 without v0.3
- Releasing v1.0 without passing all v0.x gates

**Why It Fails:** Each phase builds on the previous. Skipping gates compounds problems.

**What To Do Instead:** Fix gate failure before proceeding. If unfixable, halt and escalate to Steffen.

---

### Anti-Pattern 4: Feature Creep During Migration

**PROHIBITED:**
- Adding new features to Phase 1 (public port)
- "Improving" workflows during vanilla migration
- Refactoring code that doesn't need migration changes
- Attempting to migrate everything at once
- Assuming we need everything Jeremy 1.0 has in Phase 1

**Why It Fails:** Conflates migration issues with feature issues. Makes rollback harder. Creates unrealistic scope. Exposes personal data in public release.

**What To Do Instead:** Migrate vanilla first (Phase 1, v0.x → v1.0). Add identity and features in Phase 2 (Jeremy 2.0). Evaluate what we actually need based on usage, not theoretical completeness.

**Key Insight:** Session Search CLI and Project Sync CLI may not even be transferable to new architecture. We research and validate in Phase 2 AFTER vanilla v1.0 is publicly released.

---

### Anti-Pattern 5: Premature Optimization

**PROHIBITED:**
- Optimizing before system is functional
- Adding "nice-to-have" features before "must-have" working
- Building advanced features before basic validation
- Assuming compatibility without testing

**Why It Fails:** Wastes time on features we might not need or that may not work. Delays core validation.

**What To Do Instead:** Get vanilla working (Phase 1, v0.x → v1.0). Release publicly. Then add identity in Phase 2 (Jeremy 2.0). Use it. Discover what's missing. Add incrementally.

---

### Anti-Pattern 6: Mixing Git Remotes

**PROHIBITED:**
- Pushing to upstream (read-only)
- Adding private customizations to v1.0 public release
- Exposing personal data in public pai-opencode repository
- Committing to wrong remote

**Why It Fails:** Irreversible data leaks. Public exposure of private information. Upstream is read-only reference only.

**What To Do Instead:**
- Always verify `git remote -v` before commits
- Phase 1 (v1.0): All work goes to origin (pai-opencode, PUBLIC)
- Phase 2 (v1.x-v2.0): Use separate jeremy-2.0 repository (PRIVATE)

---

### Anti-Pattern 7: Assuming Claude Code Compatibility

**PROHIBITED:**
- Assuming `kai-hook-system` works directly on OpenCode
- Copying Claude Code hooks without adaptation
- Using `~/.claude/settings.json` hook format for OpenCode
- Ignoring platform-specific event names and registration patterns

**Why It Fails:** Claude Code and OpenCode have fundamentally different hook/plugin architectures. Direct copy will fail silently or cause errors.

**What To Do Instead:**
1. Research target platform's extension system FIRST
2. Understand event names, registration patterns, blocking mechanisms
3. Adapt source code for target platform (hooks → plugins)
4. Document platform differences in research database
5. Test adapted implementation separately before integration

**Reference:** See `~/.claude/History/research/opencode-wiki/09-plugins/plugins.md` for OpenCode plugin system documentation.

---

## SECTION VI: GIT ARCHITECTURE (IN SCOPE FOR v1.0)

### The Two-Remote Setup

PAI-OpenCode uses a two-remote git architecture for the public port:

| Remote | Repository | Purpose |
|--------|------------|---------|
| `origin` | `github.com/Steffen025/pai-opencode` | **PUBLIC** - Our main project repository |
| `upstream` | `github.com/danielmiessler/PAI` | **READ-ONLY** - Daniel's PAI 2.0 reference for converter tool |

**Rationale:** PAI-OpenCode is NOT a fork of Daniel's PAI repository - it's an independent port to a different platform (OpenCode vs Claude Code). We maintain `upstream` as a read-only reference so our converter tool can pull updates from Daniel's PAI 2.0 releases and translate them to OpenCode format.

**Why No Fork?**
- PAI-OpenCode is platform-specific (OpenCode architecture)
- Daniel's PAI is platform-specific (Claude Code architecture)
- We can't PR OpenCode-specific changes back to a Claude Code project
- The converter tool handles translation, not direct compatibility

**Note:** If we discover bugs in Daniel's original PAI that work on Claude Code, we can fork separately for that purpose. But that's independent of this project.

**MUST Configuration for v1.0:**
```bash
# Configure remotes
git remote add origin git@github.com:Steffen025/pai-opencode.git
git remote add upstream https://github.com/danielmiessler/PAI.git

# Set default push
git config remote.pushDefault origin

# Verify (should show 4 lines: 2 remotes × 2 URLs each)
git remote -v
```

---

### Local File System Structure

**Workspace Structure (v1.0):**
```
~/Workspace/github.com/Steffen025/
├── pai-opencode/                           ← PUBLIC: Main project (origin)
│   ├── .git/
│   ├── .opencode/                          ← PAI 2.0 configuration
│   │   ├── agent/
│   │   ├── command/
│   │   ├── skills/
│   │   ├── plugins/                        ← Hooks adapted as plugins
│   │   └── tools/
│   ├── Tools/                              ← PAI architecture scripts
│   ├── docs/                               ← Public documentation
│   ├── research/                           ← Migration research artifacts
│   ├── constitution.md
│   ├── ROADMAP.md
│   └── README.md
│
└── (Daniel's PAI cloned separately for reference when needed)
```

**OpenCode Data Location:**
- Configuration: `~/Workspace/github.com/Steffen025/pai-opencode/.opencode/`
- Session transcripts: (OpenCode native storage location - to be researched in v0.5)
- Research artifacts: `~/Workspace/github.com/Steffen025/pai-opencode/research/`

---

### MUST Requirements

1. **Upstream is read-only (never push)** - Only for converter tool reference
2. **Origin is the default remote for all work** - Push all changes here
3. **v1.0 is PUBLIC** - No private customizations in this phase
4. **Phase 2 (Jeremy 2.0) uses separate private repository** - After v1.0 release
5. **Git architecture configured and validated in v1.0**

---

### Git Workflow Examples

**Phase 1 Work (PUBLIC - v0.x → v1.0):**
```bash
# Work in pai-opencode repo
cd ~/Workspace/github.com/Steffen025/pai-opencode/
git add .
git commit -m "feat(v0.3): Implement lazy loading for skills"
git push origin main  # Goes to PUBLIC repo
```

**Phase 2 Work (PRIVATE - After v1.0):**
```bash
# Different repository entirely
cd ~/Workspace/github.com/Steffen025/jeremy-2.0/
git add .
git commit -m "feat(v1.1): Add TELOS pack integration"
git push origin main  # Goes to PRIVATE jeremy-2.0 repo
```

**Importing PAI 2.0 Updates (Using Converter):**
```bash
# Fetch latest from Daniel's PAI
git fetch upstream

# Run converter tool to translate updates
bun Tools/pai-to-opencode-converter.ts

# Review changes and commit
git add .
git commit -m "chore: Import PAI 2.0 updates via converter"
git push origin main
```

---

## SECTION VII: GOVERNANCE

### Decision Authority

**Steffen (ENGINEER_NAME) has final say on all migration decisions.**

| Decision Type | Authority | Approval Required |
|---------------|-----------|-------------------|
| Gate pass/fail | Steffen | Explicit |
| Scope changes | Steffen | Explicit |
| Rollback trigger | Steffen | Explicit |
| Go-live timing | Steffen | Explicit |
| Constitution amendment | Steffen | Explicit |
| Version progression | Steffen | Explicit |

### Irreversible Action Approval

**REQUIRES EXPLICIT APPROVAL:**
- Deleting files from Claude Code instance (Jeremy 1.0)
- Modifying production git repositories
- Changing API keys or credentials
- Publishing changes to GitHub
- Proceeding to v1.1 before v1.0 validated

**NO APPROVAL NEEDED:**
- Creating files in OpenCode workspace
- Running validation scripts
- Reading configuration
- Creating backups
- Documentation updates

### Documentation Requirements

All decisions documented in:
- `project.md` changelog section
- `plan.md` for milestone updates (NOT day-by-day prescriptions)
- `history/learnings/YYYY-MM/` for insights
- `ROADMAP.md` for version progression strategy (created after v1.0)

---

## SECTION VIII: AMENDMENT PROCEDURE

### When to Amend

Amend this constitution when:
1. Critical blocker discovered that requires principle modification
2. Success pattern identified that should be mandated
3. Evidence contradicts current principle
4. Technology change requires adaptation
5. Scope needs adjustment based on findings

### How to Amend

1. **Proposal:** Document proposed amendment with rationale
2. **Impact Analysis:** Assess impact on quality gates and principles
3. **Review:** Steffen reviews and decides
4. **Version Bump:** Major (principles/scope), Minor (gates), Patch (clarification)
5. **Update:** Modify constitution file
6. **Notification:** Update amendment history

### Amendment History

| Version | Date | Change | Rationale |
|---------|------|--------|-----------|
| v1.0.0 | 2025-12-31 | Initial constitution | Project launch |
| v1.1.0 | 2025-12-31 | Added Section VII: Git Repository Architecture | Document three-remote setup |
| v2.0.0 | 2025-12-31 | **MAJOR REVISION** - Complete restructure | Focus on realistic v1.0 scope: Identity-first, incremental migration, removed unrealistic gates and out-of-scope features |
| v3.0.0 | 2025-12-31 | **MAJOR SCOPE REDUCTION** - v1.0 vanilla only | v1.0 is ONLY vanilla PAI 2.0 + git architecture (copycat mode). ALL customizations moved to v1.1+. Session Search/Project Sync explicitly unknown if transferable. |
| v3.0.1 | 2026-01-01 | **CLARIFICATION** - Versioning correction | v1.0 was actually empty OpenCode workspace (not vanilla packs). Updated version mapping: v1.1 = vanilla packs, v1.2 = identity. |
| v3.1.0 | 2026-01-01 | **CRITICAL LEARNING** - Hook/Plugin incompatibility | OpenCode uses plugin system (`.opencode/plugins/`), NOT Claude Code hooks (`settings.json`). kai-hook-system requires adaptation. Updated version mapping: v1.1 = skills only, v1.2 = hooks (as plugins), v1.3 = identity. |
| v3.2.0 | 2026-01-01 | **TECHNICAL DECISIONS** - Added Section IX | Documented 6 key technical decisions from comprehensive research: (1) Clean Break + Converter, (2) Hybrid Agent Delegation, (3) LazyLoad Translation, (4) Hook System DEFERRED, (5) Dual History System, (6) Clean Break to `.opencode/`. |
| v3.3.0 | 2026-01-01 | **PUBLIC REFRAME** - Project scope clarified | This is now explicitly a PUBLIC community contribution. v1.0 = Pure PAI 2.0 → OpenCode port (no identity). Jeremy 2.0 separated as private post-v1.0 project. New versioning: v0.1-v0.9 milestones to v1.0 public release. |
| v3.4.0 | 2026-01-01 | **TWO-PHASE VERSIONING** - Section II complete rewrite | Updated all version references to reflect two-phase structure: Phase 1 (PUBLIC v0.x → v1.0) = vanilla PAI 2.0 port, Phase 2 (PRIVATE Jeremy 2.0) = identity layer. Aligned all sections (II-IV, Appendices) with new versioning. Clarified public/private boundaries throughout. |
| v3.5.0 | 2026-01-01 | **SCOPE & ARCHITECTURE FIXES** - Multiple corrections | (1) Principle 6: Voice Server/Constitutional Framework are IN vanilla PAI 2.0, not out of scope; (2) All folder references updated from jeremy-2.0 to pai-opencode; (3) Phase 2 versioning clarified (v0.x→v1.0→v1.x→v2.0); (4) Git architecture simplified from 3 remotes to 2 (removed fork - PAI-OpenCode is independent port, not fork); (5) Repository path corrections throughout. |
| v3.6.0 | 2026-01-01 | **WORKSPACE PATH CONSOLIDATION** | All workspace paths updated from `~/Workspace/GitHub/Steffen025/` to `~/Workspace/github.com/Steffen025/` to match existing directory structure. |
| v3.7.0 | 2026-01-01 | **NEW PRINCIPLE: Research Before Build** | Added Principle 7 - mandatory validation of assumptions against existing research before implementation. Learned from v0.3: spec assumed skill.yaml conversion needed, research revealed formats are identical, saving 66% effort. "Better safe than sorry" - use the 48-page SYNTHESIS.md! |

**v3.1.0 Critical Learning Note (Hook/Plugin System Discovery):**

During v1.1 implementation research, we discovered that **Claude Code hooks and OpenCode plugins are fundamentally different systems**:

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| **Config Location** | `~/.claude/settings.json` | `.opencode/plugins/` directory |
| **Format** | JSON configuration | TypeScript/JavaScript modules |
| **Event Names** | `PreToolUse`, `PostToolUse`, `SessionStart` | `tool.execute.before`, `tool.execute.after`, `session.*` |
| **Registration** | Declarative in settings.json | Export plugin functions |
| **Blocking Mechanism** | Exit code 2 = block | Return value or throw (TBD) |

**Critical Implication:** The `kai-hook-system` pack is designed for Claude Code and will NOT work directly on OpenCode. It requires significant adaptation to work as an OpenCode plugin.

**Updated Version Mapping (v3.1.0):**
- **v1.0** = Empty OpenCode workspace + Git architecture ✅ (COMPLETED)
- **v1.1** = Skills from vanilla packs (kai-core-install ONLY, no hooks) ← REVISED
- **v1.2** = Hooks adapted as OpenCode plugins (kai-hook-system adapted) ← NEW
- **v1.3** = Identity Integration (TELOS, Ideology) - was v1.2
- **v1.4+** = Feature validation - was v1.3+
- **v2.0** = Complete Jeremy 2.0 - roadmap TBD

**Research Database:** Full plugin system documentation at `/Users/steffen/.claude/History/research/opencode-wiki/09-plugins/plugins.md`

**v3.0.1 Clarification Note (Versioning Correction Discovery):**

During v1.0 implementation, we discovered that the completed v1.0 was actually just an **empty OpenCode workspace with git architecture**, NOT a full vanilla PAI 2.0 installation. The Kai Bundle installer would have modified Jeremy 1.0 (`~/.claude/`), so pack installation was intentionally skipped to protect the production system.

**Updated Version Mapping:**
- **v1.0** = Empty OpenCode workspace + Git architecture ✅ (COMPLETED)
- **v1.1** = Daniel Miessler's Vanilla PAI 2.0 Packs (kai-hook-system, kai-core-install) ← NEW
- **v1.2** = Identity Integration (TELOS, Ideology) - was v1.1
- **v1.3+** = Feature validation - was v1.2+
- **v2.0** = Complete Jeremy 2.0 - roadmap TBD

This does not change the constitution's principles - vanilla installation is still required before customization. It only clarifies that the vanilla pack installation happens in v1.1, not v1.0.

**v3.0.0 Key Changes:**
- **CRITICAL:** v1.0 scope reduced to ONLY vanilla installation + git architecture
- Removed ALL customizations from v1.0 (identity, TELOS, ideology → v1.1)
- Session Search CLI marked as UNKNOWN if transferable to new architecture
- Project Sync CLI marked as UNKNOWN if transferable to new architecture
- Voice System marked as UNKNOWN if compatible with OpenCode
- Added explicit OUT OF SCOPE sections for v1.0
- Clarified v1.0 = "Copycat" philosophy (pure vanilla Daniel Miessler PAI 2.0)
- Added v1.1 gate for identity integration (AFTER v1.0)
- Emphasized research and validation approach over feature migration
- Added key messages throughout document
- Restructured scope definition for clarity (v1.0/v1.1/v1.2+/v2.0)

---

## SECTION IX: TECHNICAL DECISIONS

**This section documents the 6 key technical decisions made during comprehensive PAI 2.0 research (2026-01-01).**

All decisions follow the principle: **Clean Break over Backwards Compatibility** - we maintain the ability to import PAI 2.0 updates, not compatibility with Claude Code systems.

---

### Decision 1: Configuration Strategy

**Decision:** Option A - Clean Break + Converter

| Aspect | Choice |
|--------|--------|
| **Approach** | Pure OpenCode format with translation script |
| **Claude Code configs** | Do NOT maintain; translate to OpenCode when needed |
| **PAI 2.0 updates** | Import via converter script |

**Rationale:** We don't need bi-directional compatibility. We need the ability to translate PAI 2.0 updates into our OpenCode setup. A clean break with a converter script achieves this without maintaining legacy baggage.

**Implementation:**
- Create `tools/pai-to-opencode-converter.ts`
- Converter handles: skill format, settings structure, agent definitions
- Run converter when importing upstream PAI 2.0 updates

---

### Decision 2: Agent Delegation

**Decision:** Option C - Hybrid Approach

| Aspect | Choice |
|--------|--------|
| **Complex tasks** | Use Task tool API (PAI-style delegation) |
| **Simple tasks** | Use OpenCode native subagents when available |
| **Pack compatibility** | Maintained through Task tool wrapper |

**Rationale:** This hybrid approach enables easy integration of future PAI 2.0 packs while leveraging OpenCode native features when appropriate. The Task tool provides the sophisticated delegation we need for SpecFirst and complex workflows, while OpenCode subagents can handle simpler operations.

**Implementation:**
- Task tool wrapper remains primary for complex agent delegation
- OpenCode subagent support added as alternative for simple tasks
- Pack installation remains compatible (they use Task tool)

---

### Decision 3: Skills Loading

**Decision:** LazyLoad Translation

| Aspect | Choice |
|--------|--------|
| **Mechanism** | OpenCode-native lazy loading |
| **Claude Code workaround** | Not used - OpenCode supports lazy loading natively |
| **Token efficiency** | 92.5% reduction through 3-tier progressive disclosure |

**Rationale:** Daniel Miessler built a workaround for Claude Code because it doesn't support lazy loading. OpenCode DOES support lazy loading natively, making it the superior approach. We translate PAI 2.0 skills to use OpenCode's native lazy loading.

**Implementation:**
- Skills use OpenCode's native lazy loading mechanism
- 3-tier structure maintained: T1=description, T2=SKILL.md, T3=reference files
- No need for Claude Code workarounds

---

### Decision 4: Hook System

**Decision:** DEFERRED - Requires Additional Research

| Aspect | Status |
|--------|--------|
| **Research needed** | OpenCode plugin capability assessment |
| **Questions** | Can plugins replicate all 8 hook events? Can they block tool execution? |
| **Timeline** | Research during v1.1, decision for v1.2 |

**Rationale:** The comprehensive research revealed that Claude Code hooks and OpenCode plugins are fundamentally different systems. We cannot make an informed decision until we research:
1. Which of the 8 hook events (PreToolUse, PostToolUse, Stop, SubagentStop, SessionStart, SessionEnd, UserPromptSubmit, PreCompact) are replicable as plugins
2. Plugin blocking capabilities (exit code 2 equivalent)
3. Plugin access to tool inputs/outputs

**Research Location:** Full plugin research to be documented in `research/opencode-plugin-research.md`

---

### Decision 5: History System

**Decision:** Option C - Dual Layer Architecture

| Layer | System | Purpose |
|-------|--------|---------|
| **Session Storage** | OpenCode native | Transcripts, raw events, session data |
| **Knowledge Management** | PAI history system | Sessions/, Learnings/, Research/, Decisions/ |

**Rationale:** PAI's history system provides essential knowledge management capabilities (learnings, research synthesis, decision records) that OpenCode sessions don't offer. Meanwhile, OpenCode's native session storage is optimized for transcript handling. Using both layers gives us the best of both systems.

**Implementation:**
- OpenCode manages session transcripts natively
- PAI history system continues for knowledge management
- PostToolUse-style capture adapted to OpenCode plugin (v1.2)
- SessionEnd summary generation continues in knowledge layer

---

### Decision 6: Directory Structure

**Decision:** Option A - Clean Break to `.opencode/`

| Aspect | Choice |
|--------|--------|
| **Config directory** | `.opencode/` (project-level, NOT `~/.opencode`) |
| **Claude Code compatibility** | Not maintained |
| **PAI 2.0 updates** | Imported via converter |

**Rationale:** OpenCode uses `.opencode/` directory structure. We don't need backwards compatibility with `~/.claude/` - we need the ability to import PAI 2.0 updates and translate them. A clean break prevents configuration conflicts and confusion.

**Implementation:**
- All Jeremy 2.0 configuration in `.opencode/`
- Project-level config (not global `~/.opencode`)
- Converter script handles PAI 2.0 → OpenCode translation

---

### Decision Summary Matrix

| # | Decision | Choice | Version |
|---|----------|--------|---------|
| 1 | Configuration | Clean Break + Converter | v1.1 |
| 2 | Agent Delegation | Hybrid (Task API + OpenCode subagents) | v1.1 |
| 3 | Skills Loading | LazyLoad Translation | v1.1 |
| 4 | Hook System | DEFERRED (needs research) | v1.2 |
| 5 | History System | Dual (OpenCode sessions + PAI knowledge) | v1.1/v1.2 |
| 6 | Directory Structure | Clean Break to `.opencode/` | v1.0 |

**Guiding Principle:** Import capability, not backwards compatibility. We're building on OpenCode, not maintaining Claude Code.

---

## APPENDIX A: QUICK REFERENCE CHECKLIST

### Before Starting Phase 1 (Public Port)

- [ ] Backup `~/.claude/` completely (Jeremy 1.0)
- [ ] Verify OpenCode installed
- [ ] Verify Bun runtime available
- [ ] Test API keys (ANTHROPIC_API_KEY)
- [ ] Review ROADMAP.md and SYNTHESIS.md
- [ ] Read this constitution fully
- [ ] Accept that Phase 1 is PUBLIC (no identity, no personal data)
- [ ] Understand Phase 2 is PRIVATE (separate project after v1.0)

### During Phase 1 (v0.x → v1.0 Public Release)

- [ ] Complete v0.1: Foundation ✅ DONE
- [ ] Complete v0.2: Vanilla PAI 2.0 Installation
- [ ] Complete v0.3: Skills Translation
- [ ] Complete v0.4: Agent Delegation
- [ ] Complete v0.5: History System
- [ ] Complete v0.6: Converter Tool
- [ ] Complete v0.7: Plugin Adaptation
- [ ] Complete v0.8: Integration Testing
- [ ] Complete v0.9: Documentation
- [ ] Pass all Phase 1 quality gates
- [ ] NO customizations added (public release)
- [ ] NO personal data included

### Before v1.0 Public Release

- [ ] All v0.x milestones complete
- [ ] All Phase 1 quality gates passed
- [ ] Vanilla functionality confirmed
- [ ] Git architecture working
- [ ] Documentation reviewed for sensitive content
- [ ] Repository cleaned (no personal artifacts)
- [ ] Jeremy 1.0 still functional as fallback
- [ ] Steffen explicitly approved public release

### Before Phase 2 (Jeremy 2.0 Development)

- [ ] v1.0 publicly released and validated
- [ ] Community feedback reviewed
- [ ] Phase 2 repository created (PRIVATE)
- [ ] Phase 2 roadmap detailed and approved
- [ ] Jeremy 1.0 still functional as fallback
- [ ] Steffen explicitly approved Phase 2 start

### Before Jeremy 2.0 Complete

- [ ] Jeremy 0.1: TELOS Integration validated
- [ ] Jeremy 0.2: Ideology Integration validated
- [ ] Jeremy 0.3+: All features individually validated
- [ ] Core workflows operational
- [ ] Steffen explicitly approved Jeremy 2.0 go-live
- [ ] Jeremy 1.0 still functional as fallback

---

## APPENDIX B: TROUBLESHOOTING

### Issue: Phase 1 Contains Customizations or Personal Data

**Symptoms:** TELOS pack found in v0.x, custom agents, identity responses, personal data in commits

**Resolution:**
1. **CONSTITUTIONAL VIOLATION** - Phase 1 MUST be vanilla only (PUBLIC release)
2. Remove all custom packs from Phase 1
3. Remove all personal data
4. Validate vanilla functionality
5. Defer customizations to Phase 2 (Jeremy 2.0)
6. Review all commits for sensitive content before push

### Issue: Vanilla PAI 2.0 Installation Fails

**Symptoms:** PAI 2.0 errors on initialization, setup fails, architecture check fails

**Resolution:**
1. Check OpenCode installation
2. Verify Bun runtime
3. Review PAI 2.0 documentation from upstream
4. Consult Daniel Miessler's installation guide
5. Check `research/SYNTHESIS.md` for known issues
6. Document blocker, halt migration if unfixable

### Issue: Git Architecture Misconfigured

**Symptoms:** Push goes to wrong remote, upstream shows write access, wrong repository

**Resolution:**
1. STOP IMMEDIATELY
2. Verify `git remote -v` output (should show 2 remotes: origin, upstream)
3. Reconfigure remotes per Section VI (2 remotes, not 3)
4. Set `remote.pushDefault` to origin
5. Verify upstream is HTTPS (read-only), origin is SSH (write access)
6. Test with safe commit before real work
7. CRITICAL: Phase 1 work goes to public `pai-opencode` repo, Phase 2 to separate private `jeremy-2.0` repo

### Issue: Jumping Past Quality Gates

**Symptoms:** Adding features from v0.4 before v0.3 complete, skipping gates

**Resolution:**
1. **GATE VIOLATION** - Must complete gates sequentially
2. Roll back to last passed gate
3. Complete current gate validation
4. Pass all acceptance criteria
5. Get explicit approval before proceeding

### Issue: Starting Phase 2 Before v1.0 Public Release

**Symptoms:** Adding identity packs before v1.0 publicly released, mixing public/private work

**Resolution:**
1. **PHASE VIOLATION** - v1.0 MUST be publicly released first
2. Remove identity packs from Phase 1 work
3. Complete v1.0 public release
4. Get community validation
5. Create separate Phase 2 repository (PRIVATE)
6. Get explicit approval for Phase 2 start

### Issue: Feature Not Working from Jeremy 1.0

**Symptoms:** Session Search CLI doesn't exist, Voice System missing, Project Sync CLI not found

**Resolution:**
1. **THIS IS EXPECTED** - Phase 1 (v1.0) is vanilla only
2. Do NOT add feature to Phase 1
3. Document feature in Phase 2 (Jeremy 2.0) evaluation backlog
4. Research if transferable to PAI 2.0 architecture in Phase 2
5. Add incrementally in Phase 2 AFTER v1.0 public release
6. Remember: We don't know if these features are even transferable yet

---

## RATIFICATION

This constitution is **RATIFIED** and **IN EFFECT** as of 2025-12-31.

**Authority:** Steffen (Project Owner)
**Philosophy:** Two-phase approach - Phase 1 (PUBLIC v0.x → v1.0) contributes vanilla PAI 2.0 port to community, Phase 2 (PRIVATE Jeremy 2.0) builds identity layer on that foundation
**Confidence Level:** HIGH
**Review Date:** After v1.0 public release

**All PAI 2.0 → OpenCode migration operations SHALL comply with this constitution from ratification date forward.**

**Key Mandate for Phase 1 (v0.x → v1.0):** PUBLIC community contribution. ONLY vanilla PAI 2.0 on OpenCode. NO customizations. NO identity. NO personal data. This is a shareable, documented migration that contributes to the PAI community.

**Key Mandate for Phase 2 (Jeremy 2.0):** PRIVATE separate project. Identity FIRST (TELOS, Ideology). Feature validation incremental. Build on v1.0 foundation with personal customizations.

**Key Mandate for Quality:** Sequential gate progression. No skipping. Public/private separation enforced. Jeremy 1.0 remains fallback throughout.

---

**CONSTITUTION v3.4.0 - END OF DOCUMENT**
