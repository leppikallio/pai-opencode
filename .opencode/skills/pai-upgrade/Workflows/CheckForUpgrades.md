# CheckForUpgrades

## Purpose

Collect and consolidate new upgrade signals from configured sources, then produce a prioritized review list.

## Inputs

- Optional `days` argument (`7`, `14`, or `30`) to scope Anthropic/Claude ingestion.
- Optional `--force` flag to bypass historical state and re-scan.
- Optional source filter intent from user (Anthropic, YouTube, provider, or both).
- Runtime config:
  - `/Users/zuul/.config/opencode/skills/pai-upgrade/sources.v2.json` (preferred)
  - `/Users/zuul/.config/opencode/skills/pai-upgrade/sources.json` (legacy fallback)
  - `/Users/zuul/.config/opencode/skills/pai-upgrade/youtube-channels.json`
  - `/Users/zuul/.config/opencode/skills/pai-upgrade/State/` (state and ledger outputs)

## Steps

### Step 1: Load configuration and state

1. Run:

```bash
bun ~/.config/opencode/skills/PAI/Tools/LoadSkillConfig.ts /Users/zuul/.config/opencode/skills/pai-upgrade sources.v2.json
```

Prefer `sources.v2.json` when present.

2. Confirm state files exist:

```bash
cat ~/.config/opencode/skills/pai-upgrade/State/last-check.json
cat ~/.config/opencode/skills/pai-upgrade/State/youtube-videos.json
```

### Step 2: Check Anthropic/Claude source feeds

Run Anthropic/Claude updater:

```bash
bun ~/.config/opencode/skills/pai-upgrade/Tools/Anthropic.ts 14
```

### Step 3: Check YouTube and other optional provider sources

- Resolve current channel/source list from merged config.
- For each source, fetch fresh metadata and deduplicate against state.
- Pull transcript/summary only for newly discovered high-signal items.

### Step 4: Normalize and prioritize

- Merge findings into a single result set.
- Tag each item with provider, source, confidence, and recency.
- Apply learning-aware ranking with adjusted priority, score delta, and rationale.
- Persist ranked recommendation history by default when not in `--dry-run` mode.

### Step 5: Produce upgrade check output

Create a review draft with three priority bands: **High**, **Medium**, **Low**.

## Verify

- Tool evidence from step commands must succeed and emit non-empty output.
- The state files should include an updated `last_check`/`updated_at` marker after run.
- Confirm duplicates are removed by checking at least one source-specific identifier appears once.
- If `--force` is passed, verify run did not skip already-seen hashes.

```bash
test -s ~/.config/opencode/skills/pai-upgrade/State/last-check.json
test -s ~/.config/opencode/skills/pai-upgrade/State/youtube-videos.json
```

## Output

- A markdown report containing:
  - `## High Priority` items with rationale
  - `## Medium Priority` items
  - `## Low Priority` items
  - `## New Videos` (if applicable)
- Clear note on what to review next and why it matters.
