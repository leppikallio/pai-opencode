# ReleaseNotesDeepDive

## Purpose

Analyze structured release-style update content (notes, changelogs, announcements) and convert it into validated upgrade recommendations.

## Inputs

- Release note content pasted from user, URL, or known feed output.
- Optional provider context (default: Anthropic/Claude plus any additional monitored providers).
- Optional acceptance criteria (e.g., scope-limited to one subsystem).
- Optional monitor ranking context (`adjusted_priority`, `adjusted_score`, rationale) from `CheckForUpgrades`.

## Steps

### Step 1: Ingest release update input

Accept one of:

- pasted text block,
- artifact file or summary URL,
- existing monitor output from `CheckForUpgrades`.

### Step 2: Extract candidate features

Break update content into discrete feature/change items.

### Step 3: Validate each feature independently

For each item, validate across sources:

1. Official source statement (where available)
2. Repository/docs references
3. Ancillary community or SDK/API references

### Step 4: Determine upgrade impact

For each feature, assess:

- Impact on existing PAI architecture
- Required config/workflow/tool changes
- Dependencies and deprecation risks

### Step 5: Prioritize and package

- **High**: immediate adoption candidates
- **Medium**: staged adoption
- **Low**: monitor and revisit
- Include the learning-aware ranking rationale when monitor data is available.

## Verify

- Confirm every extracted feature has at least one supporting source reference.
- Confirm duplicate items are merged before prioritization.
- Confirm output includes both “source-of-truth” and “PAI impact” sections.

## Output

- Structured deep-dive report with:
  - version/context header,
  - validated feature sections,
  - mapped architecture impacts,
  - priority list with rationale,
  - clear next-step checklist.
