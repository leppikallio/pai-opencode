# Memory System

**The unified system memory - what happened, what we learned, what we're working on.**

**Version:** 8.0 (OpenCode events-native architecture, 2026-01-31)
**Location:** `~/.config/opencode/MEMORY/`

---

## Architecture

**Source of truth differs by platform:**
- Upstream Claude Code PAI used `projects/` transcripts as the firehose.
- OpenCode PAI uses `MEMORY/RAW/` as the append-only firehose.

```
User Request
    ↓
OpenCode bus events (message.*, session.*, tool.*, permission.*)
    ↓
Plugins capture an append-only firehose:
    └── RAW/ (per-session JSONL)
    ↓
Plugins maintain projections:
    ├── WORK/ (THREAD.md + ISC.json + snapshots)
    ├── LEARNING/ (ratings + learnings)
    ├── RESEARCH/ (Task tool outputs)
    └── SECURITY/ (security.jsonl)
```

**Key insight:** OpenCode requires an explicit firehose. `RAW/` is the source of truth; everything else is a projection.

---

## Directory Structure

```
~/.config/opencode/MEMORY/
├── RAW/                         # Append-only event firehose (JSONL)
├── WORK/                        # Work sessions (thread + ISC)
├── LEARNING/                    # Learnings + ratings signals
├── RESEARCH/                    # Subagent captures (Task tool)
├── SECURITY/                    # Security audit log events
├── STATE/                       # Runtime state (current-work pointer, caches)
└── PAISYSTEMUPDATES/            # System upgrade documentation
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

Legacy note:
- Upstream Claude Code PAI used harvesting tools to scan `projects/` transcripts.
- OpenCode PAI uses `MEMORY/RAW/` as the firehose and does not require harvesting.

**Not implemented yet (OpenCode port):** implicit sentiment capture.

**Structure:**
- `LEARNING/SYSTEM/YYYY-MM/` - PAI/tooling learnings (infrastructure issues)
- `LEARNING/ALGORITHM/YYYY-MM/` - Task execution learnings (approach errors)
- `LEARNING/SYSTEM/` - Aggregated pattern analysis reports
- `MEMORY/LEARNING/SIGNALS/ratings.jsonl` - All user satisfaction ratings

**Categorization logic:**
| Directory | When Used | Example Triggers |
|-----------|-----------|------------------|
| `LEARNING/SYSTEM/` | Tooling/infrastructure failures | hook crash, config error, deploy failure |
| `LEARNING/ALGORITHM/` | Task execution issues | wrong approach, over-engineered, missed the point |
| `LEARNING/FAILURES/` | Full context for low ratings (1-3) | severe frustration, repeated errors |
| `LEARNING/SYNTHESIS/` | Pattern aggregation | weekly analysis, recurring issues |

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
| `plugins/handlers/rating-capture.ts` | user message commit | MEMORY/LEARNING/SIGNALS/ratings.jsonl (+ low-rating learnings) |
| `plugins/handlers/learning-capture.ts` | idle checkpoint, session.deleted | LEARNING/ |
| `plugins/handlers/agent-capture.ts` | `tool.execute.after` (Task) | RESEARCH/ |
| `plugins/handlers/security-validator.ts` | `tool.execute.before` | `~/.config/opencode/MEMORY/SECURITY/YYYY-MM/security.jsonl` |

## Harvesting Tools

Upstream Claude Code PAI included "harvesting" tools that scanned transcript storage.

In OpenCode PAI:
- `MEMORY/RAW/` is the firehose.
- Projections (WORK/LEARNING/RESEARCH/SECURITY) are updated directly from events.
- Harvesting tools are not required.

---

## Data Flow

```
User Request
    ↓
OpenCode events (message.updated / message.part.updated)
    ↓
History Capture → WORK/{id}/ + RAW/{session}.jsonl + STATE/current-work.json
    ↓
session.status (idle)
    ↓
assistant.committed → THREAD.md + ISC.json + isc.snapshots.jsonl
    ↓
SecurityValidator → MEMORY/SECURITY/YYYY-MM/security.jsonl
    ↓
session.deleted
    ↓
Learning extraction → LEARNING/ (checkpoint + finalize)
```

---

## Quick Reference

### Check current work
```bash
cat ~/.config/opencode/MEMORY/STATE/current-work.json
ls ~/.config/opencode/MEMORY/WORK/ | tail -5
```

### Check ratings
```bash
tail ~/.config/opencode/MEMORY/LEARNING/SIGNALS/ratings.jsonl
```

### View RAW events
```bash
# List recent RAW event logs
ls -lt ~/.config/opencode/MEMORY/RAW/$(date +%Y-%m)/ | head -5
```

### Check learnings
```bash
ls ~/.config/opencode/MEMORY/LEARNING/SYSTEM/
ls ~/.config/opencode/MEMORY/LEARNING/ALGORITHM/
ls ~/.config/opencode/MEMORY/LEARNING/SYSTEM/
```

### Check failures
```bash
# List recent failure captures
ls -lt ~/.config/opencode/MEMORY/LEARNING/FAILURES/$(date +%Y-%m)/ 2>/dev/null | head -10

# View a specific failure
cat ~/.config/opencode/MEMORY/LEARNING/FAILURES/2026-01/*/CONTEXT.md | head -100
```

### Failure capture tooling

Automated failure-capture tooling is not implemented yet. Low-rating signals are captured to:

- `~/.config/opencode/MEMORY/LEARNING/SIGNALS/ratings.jsonl`

### Check multi-session progress
```bash
ls ~/.config/opencode/MEMORY/STATE/progress/
```

### Harvesting tools

Not used in the OpenCode port.

---

## Migration History

**2026-01-17:** v7.1 - Full Context Failure Analysis
- Added LEARNING/FAILURES/ directory for comprehensive failure captures
- OpenCode port note: automated failure-capture tooling is not implemented yet
- Each failure gets its own directory with transcript, sentiment, tool-calls, and context
- Directory names use 8-word descriptions generated by fast inference
- Failure capture remains manual (no migration tool)

**2026-01-12:** v7.0 - Projects-native architecture
- Legacy upstream (Claude Code): projects-native architecture (not applicable to OpenCode)

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
 - Current: `~/.config/opencode/MEMORY/`
- Files migrated: 8,415+

---

## Related Documentation

 - **Plugin System:** `THEPLUGINSYSTEM.md` (legacy: `THEHOOKSYSTEM.md`)
- **Architecture:** `PAISYSTEMARCHITECTURE.md`
