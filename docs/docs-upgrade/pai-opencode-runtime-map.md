# PAI runtime map (OpenCode plugins + MEMORY)

Source explored:
- `/Users/zuul/.config/opencode`

## Plugin system (WHAT + WHY)

### Why plugins (vs external hook scripts)
- OpenCode provides an event bus; durable automation must attach to those events.
- Plugins can:
  - inject context into system prompt
  - intercept tool calls
  - enforce response format constraints
  - capture history/work/learning continuously

Primary docs:
- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md`

### Unified plugin entrypoint
- `/Users/zuul/.config/opencode/plugins/pai-unified.ts`

## History capture (RAW firehose)
- Writer: `/Users/zuul/.config/opencode/plugins/handlers/history-capture.ts`
- Append-only JSONL per session:
  - `~/.config/opencode/MEMORY/RAW/YYYY-MM/ses_<id>.jsonl`

## Work projection (WORK)
- Work manager: `/Users/zuul/.config/opencode/plugins/handlers/work-tracker.ts`
- Current work pointer map:
  - `~/.config/opencode/MEMORY/STATE/current-work.json`
- Per-session work directory:
  - `~/.config/opencode/MEMORY/WORK/YYYY-MM/ses_<id>/`
  - `META.yaml`, `THREAD.md`, `ISC.json`, `PROMPT_HINTS.jsonl` (and optionally `isc.snapshots.jsonl`, `FORMAT_HINTS.jsonl`, …)

## ISC capture (how it actually persists)
- Spec says “todowrite/todoread”. Runtime persistence is now **dual-path**:
  1) **Tool-state path (preferred):** `todowrite` tool calls are persisted into `ISC.json` on `tool.after`.
     - `/Users/zuul/.config/opencode/plugins/handlers/history-capture.ts`
     - `/Users/zuul/.config/opencode/plugins/handlers/work-tracker.ts`
  2) **Text-parse path (fallback):** assistant responses are parsed for ISC tables/markers.
     - Parser: `/Users/zuul/.config/opencode/plugins/handlers/isc-parser.ts`
     - State + snapshots: `/Users/zuul/.config/opencode/plugins/handlers/work-tracker.ts`

## Learning capture (LEARNING)
- Extractor: `/Users/zuul/.config/opencode/plugins/handlers/learning-capture.ts`
- Output:
  - `~/.config/opencode/MEMORY/LEARNING/<CATEGORY>/YYYY-MM/<timestamp>_work_<slug>.md`

## Ratings + sentiment
- Ratings: `/Users/zuul/.config/opencode/plugins/handlers/rating-capture.ts`
  - `~/.config/opencode/MEMORY/LEARNING/SIGNALS/ratings.jsonl`
- Sentiment: `/Users/zuul/.config/opencode/plugins/handlers/sentiment-capture.ts`

## Subagent output (RESEARCH)
- `/Users/zuul/.config/opencode/plugins/handlers/agent-capture.ts`
  - `~/.config/opencode/MEMORY/RESEARCH/YYYY-MM/AGENT-<type>_<timestamp>_<slug>.md`

## Relationship memory
- Writer: `/Users/zuul/.config/opencode/plugins/handlers/relationship-memory.ts`
- Output:
  - `~/.config/opencode/MEMORY/RELATIONSHIP/YYYY-MM/YYYY-MM-DD.md`
