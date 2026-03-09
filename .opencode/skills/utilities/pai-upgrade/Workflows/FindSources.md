# FindSources

## Purpose

Find and evaluate new high-signal sources to expand PAI upgrade intelligence coverage while keeping provider support configurable.

## Inputs

- Search domain or domain categories (blogs, GitHub, newsletters, docs feeds).
- Optional priority constraints (`high`, `medium`, `low` risk/effort).
- Optional allowed providers list (default includes configured `anthropic` provider sources).
- Optional current source-state files for dedupe and drift checking.

## Steps

### Step 1: Define source criteria

- Set scope (`PAI`, `AI tooling`, `agent workflows`, `security`) and freshness threshold.
- Choose source classes to evaluate (channels, repos, docs, news feeds).

### Step 2: Discover candidates

- Search web for candidate sources per class.
- Capture URL, publisher, and content focus.

### Step 3: Pre-screen candidates

Discard low-quality or low-coverage candidates using:

- consistency of publishing,
- relevance to target architecture area,
- signal quality,
- duplication risk.

### Step 4: Score and rank

Score 1–5 for:

- Relevance,
- Update regularity,
- Technical depth,
- Compatibility with preferred providers,
- Alignment with stack constraints.

### Step 5: Prepare source updates

- Recommend **High/Medium/Low** additions.
- Create a monitored-source addition plan targeting `sources.v2.json` as the primary catalog.
- For YouTube source candidates, stage catalog updates in `youtube-channels.json` and keep runtime handling in `Tools/MonitorSources.ts`.
- For approved YouTube source entries, expect runtime state artifacts in `State/youtube-videos.json` and `State/transcripts/youtube/`.
- Keep updates inside the monitored-source catalog surface; do not add separate operator tracks.
- Ensure operator execution still enters via `Tools/MonitorSources.ts` after catalog changes.

## Verify

- Confirm each recommended source has valid URL and rationale.
- Verify duplicate check passes against current source catalog.
- Verify no protected local paths were edited outside this WS scope.

## Output

- Source discovery report aligned to monitor report shape:
  - **Discoveries → Recommendations → Implementation Targets**
- Exact JSON payload suggestions for source catalog updates where applicable.
- Provider notes keep Anthropic references in provider/source context only.
