# Memory System

**The unified system memory - what happened, what we learned, what we're working on.**

**Version:** 7.0 (Projects-native architecture, 2026-01-12)
**Location:** `$PAI_DIR/MEMORY/`

---

## Architecture

**Claude Code's `projects/` is the source of truth. Hooks capture domain-specific events directly. Harvesting tools extract learnings from session transcripts.**

```
User Request
    ↓
Claude Code projects/ (native transcript storage - 30-day retention)
    ↓
Hook Events trigger domain-specific captures:
    ├── AutoWorkCreation → WORK/
    ├── ResponseCapture → WORK/, LEARNING/
    ├── RatingCapture → LEARNING/SIGNALS/
    ├── WorkCompletionLearning → LEARNING/
    ├── AgentOutputCapture → RESEARCH/
    └── SecurityValidator → SECURITY/
    ↓
Harvesting (periodic):
    ├── SessionHarvester → LEARNING/ (extracts corrections, errors, insights)
    ├── LearningPatternSynthesis → LEARNING/SYSTEM/ (aggregates ratings)
    └── Observability reads from projects/
```

**Key insight:** Hooks write directly to specialized directories. There is no intermediate "firehose" layer - Claude Code's `projects/` serves that purpose natively.

---

## Directory Structure

```
$PAI_DIR/MEMORY/
├── WORK/                   # PRIMARY work tracking
│   └── {work_id}/
│       ├── META.yaml       # Status, session, lineage
│       ├── ISC.json        # Ideal State Criteria (auto-captured by hooks)
│       ├── items/          # Individual work items
│       ├── agents/         # Sub-agent work
│       ├── research/       # Research findings
│       ├── scratch/        # Iterative artifacts (diagrams, prototypes, drafts)
│       ├── verification/   # Evidence
│       └── children/       # Nested work
├── LEARNING/               # Learnings (includes signals)
│   ├── SYSTEM/             # PAI/tooling learnings
│   │   └── YYYY-MM/
│   ├── ALGORITHM/          # Task execution learnings
│   │   └── YYYY-MM/
│   ├── FAILURES/           # Full context dumps for low ratings (1-3)
│   │   └── YYYY-MM/
│   │       └── {timestamp}_{8-word-description}/
│   │           ├── CONTEXT.md      # Human-readable analysis
│   │           ├── transcript.jsonl # Raw conversation
│   │           ├── sentiment.json  # Sentiment metadata
│   │           └── tool-calls.json # Tool invocations
│   ├── SYNTHESIS/          # Aggregated pattern analysis
│   │   └── YYYY-MM/
│   │       └── weekly-patterns.md
│   └── SIGNALS/            # User satisfaction ratings
│       └── ratings.jsonl
├── RESEARCH/               # Agent output captures
│   └── YYYY-MM/
├── SECURITY/               # Security audit events
│   └── security-events.jsonl
├── STATE/                  # Operational state
│   ├── algorithm-state.json
│   ├── current-work.json
│   ├── format-streak.json
│   ├── algorithm-streak.json
│   ├── trending-cache.json
│   ├── progress/           # Multi-session project tracking
│   └── integrity/          # System health checks
├── PAISYSTEMUPDATES/         # Architecture change history
│   ├── index.json
│   ├── CHANGELOG.md
│   └── YYYY/MM/
└── README.md
```

---

## Directory Details

### Claude Code projects/ - Native Session Storage

**Location:** `~/.config/opencode/projects/-Users-{username}--claude/`
*(Replace `{username}` with your system username, e.g., `-Users-john--claude`)*
**What populates it:** Claude Code automatically (every conversation)
**Content:** Complete session transcripts in JSONL format
**Format:** `{uuid}.jsonl` - one file per session
**Retention:** 30 days (Claude Code manages cleanup)
**Purpose:** Source of truth for all session data; Observability and harvesting tools read from here

This is the actual "firehose" - every message, tool call, and response. PAI leverages this native storage rather than duplicating it.

### WORK/ - Primary Work Tracking

**What populates it:**
- `plugins/handlers/history-capture.ts` on `message.updated` + `message.part.updated`
- `plugins/handlers/history-capture.ts` on `session.status` (idle) + `session.deleted`

**Content:** Work directories with metadata, items, verification artifacts
**Format:** `WORK/{work_id}/` with META.yaml, items/, verification/, etc.
**Purpose:** Track all discrete work units with lineage, verification, and feedback

**Work Directory Lifecycle:**
1. `message.updated` (user) + first `TextPart` → create work dir + ISC.json
2. `message.part.updated` (TextPart) → assemble full text in memory
3. `session.status` idle → commit assistant response + update ISC.json
4. `session.deleted` → learning extraction + work completion

**ISC.json - Ideal State Criteria Tracking:**

The `ISC.json` file captures the Ideal State Criteria from PAI Algorithm execution. This enables:
- Verification against defined success criteria
- Iteration when criteria are not fully satisfied
- Post-hoc analysis of requirements evolution

**Effort-Tiered Capture Depth:**

| Effort Level | What's Captured |
|--------------|-----------------|
| QUICK/TRIVIAL | Final satisfaction summary only |
| STANDARD | Initial criteria + final satisfaction |
| DEEP/COMPREHENSIVE | Full version history with every phase update |

**ISC Document Format (JSON):**
```json
{
  "v": "0.1",
  "ideal": "Ideal outcome text",
  "criteria": [
    {"id": "abc123", "text": "Criterion text", "status": "VERIFIED", "sourceEventIds": ["assistant.committed:..."]}
  ],
  "antiCriteria": [
    {"id": "def456", "text": "Anti-criterion text"}
  ],
  "updatedAt": "2026-01-18T..."
}
```

**Why JSON over JSONL:** ISC is bounded versioned state (<10KB), not an unbounded log. JSON with `current` + `history` explicitly models what verification tools need (current criteria) vs debugging needs (history).

**In the OpenCode port:** `ISC.json` is created and updated by `plugins/handlers/history-capture.ts`.

### LEARNING/ - Categorized Learnings

**What populates it:**
- `plugins/handlers/rating-capture.ts` (explicit ratings + low-rating learnings)
- `plugins/handlers/history-capture.ts` (idle checkpoint + session.deleted extraction)
- `SessionHarvester.ts` (periodic extraction from projects/ transcripts)
- `LearningPatternSynthesis.ts` (aggregates ratings into pattern reports)

**Not implemented yet (OpenCode port):** implicit sentiment capture.

**Structure:**
- `LEARNING/SYSTEM/YYYY-MM/` - PAI/tooling learnings (infrastructure issues)
- `LEARNING/ALGORITHM/YYYY-MM/` - Task execution learnings (approach errors)
- `LEARNING/SYSTEM/` - Aggregated pattern analysis reports
- `LEARNING/SIGNALS/ratings.jsonl` - All user satisfaction ratings

**Categorization logic:**
| Directory | When Used | Example Triggers |
|-----------|-----------|------------------|
| `SYSTEM/` | Tooling/infrastructure failures | hook crash, config error, deploy failure |
| `ALGORITHM/` | Task execution issues | wrong approach, over-engineered, missed the point |
| `FAILURES/` | Full context for low ratings (1-3) | severe frustration, repeated errors |
| `SYNTHESIS/` | Pattern aggregation | weekly analysis, recurring issues |

### LEARNING/FAILURES/ - Full Context Failure Analysis

**What populates it:**
- Not auto-populated in the OpenCode port yet.
- Low ratings create learning files via `plugins/handlers/rating-capture.ts`.
- If you need full failure captures, store artifacts under WORK/*/scratch/.

**Content:** Complete context dumps for low-sentiment events
**Format:** `FAILURES/YYYY-MM/{timestamp}_{8-word-description}/`
**Purpose:** Enable retroactive learning system analysis by preserving full context

**Each failure directory contains:**
| File | Description |
|------|-------------|
| `CONTEXT.md` | Human-readable analysis with metadata, root cause notes |
| `transcript.jsonl` | Full raw conversation up to the failure point |
| `sentiment.json` | Sentiment analysis output (rating, confidence, detailed analysis) |
| `tool-calls.json` | Extracted tool calls with inputs and outputs |

**Directory naming:** `YYYY-MM-DD-HHMMSS_eight-word-description-from-inference`
- Timestamp in PST
- 8-word description generated by fast inference to capture failure essence

**Rating thresholds:**
| Rating | Capture Level |
|--------|--------------|
| 1 | Full failure capture + learning file |
| 2 | Full failure capture + learning file |
| 3 | Full failure capture + learning file |
| 4-5 | Learning file only (if warranted) |
| 6-10 | No capture (positive/neutral) |

**Why this exists:** When significant frustration occurs (1-3), a brief summary isn't enough. Full context enables:
1. Root cause identification - what sequence led to the failure?
2. Pattern detection - do similar failures share characteristics?
3. Systemic improvement - what changes would prevent this class of failure?

### RESEARCH/ - Agent Outputs

**What populates it:** `plugins/handlers/agent-capture.ts` on `tool.execute.after` (Task)
**Content:** Agent completion outputs (researchers, architects, engineers, etc.)
**Format:** `RESEARCH/YYYY-MM/YYYY-MM-DD-HHMMSS_AGENT-type_description.md`
**Purpose:** Archive of all spawned agent work

### SECURITY/ - Security Events

**What populates it:** `plugins/handlers/security-validator.ts` on `tool.execute.before`
**Content:** Security audit events (blocks, confirmations, alerts)
**Current logging:** `MEMORY/SECURITY/YYYY-MM/security.jsonl`
**Purpose:** Security decision audit trail

### STATE/ - Fast Runtime Data

**What populates it:** Various tools and hooks
**Content:** High-frequency read/write JSON files for runtime state
**Key Property:** Ephemeral - can be rebuilt from RAW or other sources. Optimized for speed, not permanence.

**Files:**
- `current-work.json` - Active work directory pointer
- `algorithm-state.json` - THEALGORITHM execution phase
- `format-streak.json`, `algorithm-streak.json` - Performance metrics
- `trending-cache.json` - Cached analysis (TTL-based)
- `progress/` - Multi-session project tracking
- `integrity/` - System health check results

This is mutable state that changes during execution - not historical records. If deleted, system recovers gracefully.

### PAISYSTEMUPDATES/ - Change History

**What populates it:** Manual via CreateUpdate.ts tool
**Content:** Canonical tracking of all system changes
**Purpose:** Track architectural decisions and system changes over time

---

## Plugin Integration

| Plugin/Handler | OpenCode Event | Writes To |
|---------------|----------------|----------|
| `plugins/handlers/history-capture.ts` | `message.*`, `session.status`, `session.deleted` | WORK/, RAW/, STATE/current-work.json |
| `plugins/handlers/rating-capture.ts` | user message commit | LEARNING/SIGNALS/ratings.jsonl (+ low-rating learnings) |
| `plugins/handlers/learning-capture.ts` | idle checkpoint, session.deleted | LEARNING/ |
| `plugins/handlers/agent-capture.ts` | `tool.execute.after` (Task) | RESEARCH/ |
| `plugins/handlers/security-validator.ts` | `tool.execute.before` | MEMORY/SECURITY/YYYY-MM/security.jsonl |

## Harvesting Tools

| Tool | Purpose | Reads From | Writes To |
|------|---------|------------|-----------|
| SessionHarvester.ts | Extract learnings from transcripts | projects/ | LEARNING/ |
| LearningPatternSynthesis.ts | Aggregate ratings into patterns | LEARNING/SIGNALS/ | LEARNING/SYSTEM/ |
| (not implemented) | Failure context dumps for low ratings | projects/, SIGNALS/ | LEARNING/FAILURES/ |
| ActivityParser.ts | Parse recent file changes | projects/ | (analysis only) |

---

## Data Flow

```
User Request
    ↓
OpenCode events (message.updated / message.part.updated)
    ↓
History Capture → WORK/{id}/ + RAW/{session}.jsonl + STATE/current-work.json
    ↓
[Work happens - all tool calls captured in projects/]
    ↓
ResponseCapture → Updates WORK/items, optionally LEARNING/
    ↓
RatingCapture/SentimentCapture → LEARNING/SIGNALS/ + LEARNING/
    ↓
WorkCompletionLearning → LEARNING/ (for significant work)
    ↓
SessionSummary → WORK/META.yaml (COMPLETED), clears STATE/current-work.json

[Periodic harvesting]
    ↓
SessionHarvester → scans projects/ → writes LEARNING/
LearningPatternSynthesis → analyzes SIGNALS/ → writes SYNTHESIS/
```

---

## Quick Reference

### Check current work
```bash
cat $PAI_DIR/MEMORY/STATE/current-work.json
ls $PAI_DIR/MEMORY/WORK/ | tail -5
```

### Check ratings
```bash
tail $PAI_DIR/MEMORY/LEARNING/SIGNALS/ratings.jsonl
```

### View session transcripts
```bash
# List recent sessions (newest first)
# Replace {username} with your system username
ls -lt ~/.config/opencode/projects/-Users-{username}--claude/*.jsonl | head -5

# View last session events
tail ~/.config/opencode/projects/-Users-{username}--claude/$(ls -t ~/.config/opencode/projects/-Users-{username}--claude/*.jsonl | head -1) | jq .
```

### Check learnings
```bash
ls $PAI_DIR/MEMORY/LEARNING/SYSTEM/
ls $PAI_DIR/MEMORY/LEARNING/ALGORITHM/
ls $PAI_DIR/MEMORY/LEARNING/SYSTEM/
```

### Check failures
```bash
# List recent failure captures
ls -lt $PAI_DIR/MEMORY/LEARNING/FAILURES/$(date +%Y-%m)/ 2>/dev/null | head -10

# View a specific failure
cat $PAI_DIR/MEMORY/LEARNING/FAILURES/2026-01/*/CONTEXT.md | head -100

## Failure capture tooling

Automated failure-capture tooling is not implemented yet. Low-rating signals are captured to:

- `$PAI_DIR/MEMORY/LEARNING/SIGNALS/ratings.jsonl`
```

### Check multi-session progress
```bash
ls $PAI_DIR/MEMORY/STATE/progress/
```

### Run harvesting tools
```bash
# Harvest learnings from recent sessions
bun run ~/.config/opencode/skills/CORE/Tools/SessionHarvester.ts --recent 10

# Generate pattern synthesis
bun run ~/.config/opencode/skills/CORE/Tools/LearningPatternSynthesis.ts --week
```

---

## Migration History

**2026-01-17:** v7.1 - Full Context Failure Analysis
- Added LEARNING/FAILURES/ directory for comprehensive failure captures
- OpenCode port note: automated failure-capture tooling is not implemented yet
- Each failure gets its own directory with transcript, sentiment, tool-calls, and context
- Directory names use 8-word descriptions generated by fast inference
- Failure capture remains manual (no migration tool)

**2026-01-12:** v7.0 - Projects-native architecture
- Eliminated RAW/ directory entirely - Claude Code's `projects/` is the source of truth
- Removed legacy duplicate logging (projects/ is the source of truth)
- Created SessionHarvester.ts to extract learnings from projects/ transcripts
- Added `plugins/handlers/learning-capture.ts` for session-end learning capture
- Created LearningPatternSynthesis.ts for rating pattern aggregation
- Store pattern synthesis reports under LEARNING/SYSTEM/
- Updated Observability to read from projects/ instead of RAW/
- Updated ActivityParser.ts to use projects/ as data source
- Removed archive functionality from legacy launcher (projects/ is source of truth)

**2026-01-11:** v6.1 - Removed RECOVERY system
- Deleted RECOVERY/ directory (5GB of redundant snapshots)
- Removed recovery-journal tooling (git is rollback)
- Git provides all necessary rollback capability

**2026-01-11:** v6.0 - Major consolidation
- WORK is now the PRIMARY work tracking system (not SESSIONS)
- Deleted SESSIONS/ directory entirely
- Merged SIGNALS/ into LEARNING/SIGNALS/
- Merged PROGRESS/ into STATE/progress/
- Merged integrity-checks/ into STATE/integrity/
- Fixed work session creation logic
- Updated plugin handlers to use correct paths

**2026-01-10:** v5.0 - Documentation consolidation
- Consolidated WORKSYSTEM.md into MEMORYSYSTEM.md

**2026-01-09:** v4.0 - Major restructure
- Moved BACKUPS to `~/.config/opencode/BACKUPS/` (outside MEMORY)
- Renamed RAW-OUTPUTS to RAW
- All directories now ALL CAPS

**2026-01-05:** v1.0 - Unified Memory System migration
- Previous: `~/.config/opencode/history/`, `~/.config/opencode/context/`, `~/.config/opencode/progress/`
- Current: `$PAI_DIR/MEMORY/`
- Files migrated: 8,415+

---

## Related Documentation

 - **Plugin System:** `THEPLUGINSYSTEM.md` (legacy: `THEHOOKSYSTEM.md`)
- **Architecture:** `PAISYSTEMARCHITECTURE.md`
