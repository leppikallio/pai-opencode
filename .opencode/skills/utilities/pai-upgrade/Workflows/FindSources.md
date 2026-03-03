# FindSources

## Purpose

Find and evaluate new high-signal sources to expand monitoring coverage while keeping provider support configurable.

## Inputs

- Search domain or domain categories (YouTube, blogs, GitHub, newsletters, docs feeds).
- Optional priority constraints (`high`, `medium`, `low` risk/effort).
- Optional allowed providers list (default includes Anthropic/Claude sources).
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
- For YouTube, propose user-layer customization updates only.
- For other sources, create a monitored-source addition plan targeting `sources.v2.json` as the primary catalog.

## Verify

- Confirm each recommended source has valid URL and rationale.
- Verify duplicate check passes against current source catalog.
- Verify no protected local paths were edited outside this WS scope.

## Output

- Source discovery report with prioritized buckets:
  - `HIGH` add now,
  - `MEDIUM` evaluate,
  - `LOW` keep for future review.
- Exact JSON payload suggestions for user customization where applicable.
- Short execution plan for onboarding top recommendations.
