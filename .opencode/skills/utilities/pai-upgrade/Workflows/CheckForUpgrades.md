# CheckForUpgrades

## Purpose

Collect and consolidate new upgrade signals from configured sources, then produce a prioritized review list.

## Inputs

- Optional `days` override (`7`, `14`, or `30`) to scope Anthropic/Claude ingestion. If you do not supply one, use the default example value `14` shown below.
- Optional `--force` flag to bypass historical state and re-scan.
- Optional source filter intent from user (Anthropic, YouTube, provider, or both).
- Runtime config:
  - `~/.config/opencode/skills/utilities/pai-upgrade/sources.v2.json` (preferred)
  - `~/.config/opencode/skills/utilities/pai-upgrade/sources.json` (legacy fallback)
  - `~/.config/opencode/skills/utilities/pai-upgrade/youtube-channels.json`
  - `~/.config/opencode/skills/utilities/pai-upgrade/State/` (state and ledger outputs)

## Steps

### Step 1: Load configuration and state

1. Run:

```bash
bun ~/.config/opencode/skills/PAI/Tools/LoadSkillConfig.ts ~/.config/opencode/skills/utilities/pai-upgrade sources.v2.json
```

Prefer `sources.v2.json` when present.

If `sources.v2.json` is missing or empty during a manual workflow run, fall back explicitly to:

```bash
bun ~/.config/opencode/skills/PAI/Tools/LoadSkillConfig.ts ~/.config/opencode/skills/utilities/pai-upgrade sources.json
```

The underlying monitoring toolchain also falls back from `sources.v2.json` to `sources.json` when the v2 catalog is unavailable or empty.

2. Confirm state files exist:

```bash
cat ~/.config/opencode/skills/utilities/pai-upgrade/State/last-check.json
cat ~/.config/opencode/skills/utilities/pai-upgrade/State/youtube-videos.json
```

### Step 2: Check Anthropic/Claude source feeds

Run Anthropic/Claude updater:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/Anthropic.ts --days 14
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

### Step 5: Mine bounded internal reflections

This CheckForUpgrades workflow is the OpenCode equivalent of the upstream main upgrade flow for this reflections slice.

Use the reflections sink after source normalization and before final recommendations:

```bash
REFLECTIONS_FILE=~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl
if test -s "$REFLECTIONS_FILE"; then
  bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/MineAlgorithmReflections.ts --pretty
else
  printf "Reflections have not accumulated yet.\n"
fi
```

If the reflections file is missing or empty, include a short note in the report that internal reflections are not yet available.

### Step 6: Produce upgrade check output

Create a review draft with three priority bands: **High**, **Medium**, **Low**.

### Step 7: Capture explicit recommendation outcomes (optional but recommended)

When you (the operator) decide outcomes for top recommendations, record them to improve future ranking quality:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/RecordRecommendationFeedback.ts \
  --recommendation-id <ranking_id> \
  --decision accepted \
  --helpfulness helpful \
  --confidence 0.9
```

Supported values:

- `--decision`: `accepted` | `ignored` | `deferred`
- `--helpfulness`: `helpful` | `neutral` | `harmful`

## Verify

- Tool evidence from step commands must succeed and emit non-empty output.
- The state files should include an updated `last_check`/`updated_at` marker after run.
- Confirm duplicates are removed by checking at least one source-specific identifier appears once.
- If `--force` is passed, verify run did not skip already-seen hashes.

```bash
test -s ~/.config/opencode/skills/utilities/pai-upgrade/State/last-check.json
test -s ~/.config/opencode/skills/utilities/pai-upgrade/State/youtube-videos.json
```

## Output

- A markdown report containing:
  - `## High Priority` items with rationale
  - `## Medium Priority` items
  - `## Low Priority` items
  - `## Internal Reflections` (themes from `algorithm-reflections.jsonl`, or a short not-yet-available note)
  - `## New Videos` (if applicable)
- Clear note on what to review next and why it matters.
