# CheckForUpgrades

## Purpose

Run PAI upgrade intelligence monitoring and generate a runtime-backed report contract.

## Inputs

- Optional `days` override (`7`, `14`, or `30`) to scope provider ingestion. If you do not supply one, use the default example value `14` shown below.
- Optional `--force` flag to bypass historical state and re-scan.
- Optional provider filter intent from user (`anthropic`, `openai`, `ecosystem`, or `all`).
- Runtime config:
  - `~/.config/opencode/skills/utilities/pai-upgrade/sources.v2.json` (preferred)
  - `~/.config/opencode/skills/utilities/pai-upgrade/sources.json` (legacy fallback)
  - `~/.config/opencode/skills/utilities/pai-upgrade/youtube-channels.json` (optional monitored-source catalog extension)
  - `~/.config/opencode/skills/utilities/pai-upgrade/State/` (state and ledger outputs)
  - `~/.config/opencode/skills/utilities/pai-upgrade/State/youtube-videos.json` (runtime source state)
  - `~/.config/opencode/skills/utilities/pai-upgrade/State/transcripts/youtube/` (runtime source transcript state)

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
In this legacy fallback mode, provider filtering is intentionally constrained to `anthropic` and `all` because v1 entries do not encode provider metadata for `ecosystem` or `openai`.

2. Confirm state files exist:

```bash
cat ~/.config/opencode/skills/utilities/pai-upgrade/State/last-check.json
cat ~/.config/opencode/skills/utilities/pai-upgrade/Logs/run-history.jsonl
```

### Step 2: Check provider source feeds

Run the canonical monitor entrypoint:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/MonitorSources.ts --days 14
```

### Step 3: Check configured provider sources

- Resolve current source list from merged config.
- Monitor runtime-supported categories (`blog`, `github`, `changelog`, `docs`, `community`).
- If YouTube source catalog entries are configured, process them only through `Tools/MonitorSources.ts` runtime ingestion.
- Fetch fresh source metadata and deduplicate against persisted state.

### Step 4: Normalize and prioritize

- Merge findings into a single result set.
- Tag each item with provider, source, confidence, and recency.
- Apply learning-aware ranking with adjusted priority, score delta, and rationale.
- Keep reflection mining and synthesis internal to `Tools/MonitorSources.ts`; do not run a second public reflections stage here.
- Internal reflection signals are read from `algorithm-reflections.jsonl` when available and folded into the same ranked update list.
- Internal learnings may outrank external discoveries when reflected ranking evidence is stronger.
- Persist ranked recommendation history by default when not in `--dry-run` mode.

### Step 5: Produce upgrade check output

Produce the canonical report shape:

**Discoveries → Recommendations → Implementation Targets**

## Verify

- Tool evidence from step commands must succeed and emit non-empty output.
- The state files should include an updated `last_check`/`updated_at` marker after run.
- Confirm duplicates are removed by checking at least one source-specific identifier appears once.
- If `--force` is passed, verify run did not skip already-seen hashes.

```bash
test -s ~/.config/opencode/skills/utilities/pai-upgrade/State/last-check.json
test -s ~/.config/opencode/skills/utilities/pai-upgrade/Logs/run-history.jsonl
```

## Output

- Output is runtime-backed by `runMonitor(...).report` and follows:
  - `discoveries[]`
  - `recommendations[]`
  - `implementation_targets[]`
- Internal reflections are synthesized into the same ranked pipeline; no standalone internal reflections output section is expected.
- Markdown rendering is derived from the same report contract and ranking metadata.
