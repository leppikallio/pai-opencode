# ResearchUpgrade

## Purpose

Validate upgrade opportunities from monitor findings, map implementation impact, and produce runtime-aligned recommendations.

## Inputs

- Feature/topic name(s) from `CheckForUpgrades` / `Tools/MonitorSources.ts` or user prompt.
- Optional content snippets (release item text, changelog line, commit message).
- Optional user constraints:
  - target component (`skills`, `agent`, `workflows`, `tooling`)
  - risk tolerance (`low`, `medium`, `high`)
  - effort limit (days/weeks)
- Source scope (default: configured `anthropic` provider sources plus user-added sources).
- Optional monitor artifact fields: `adjusted_priority`, `adjusted_score`, `ranking_rationale`, and `learning_context` summary.

## Steps

### Step 1: Define the research target

- Capture the exact feature name and expected outcome.
- Record supporting context links and owner for traceability.

### Step 2: Parallel evidence collection

Research each feature across monitored provider and community sources:

1. GitHub source references (docs, commits, issues, discussions)
2. `anthropic` provider product/blog sources
3. Official MCP and API docs where relevant
4. Community implementation examples

Use multiple sub-searches so each evidence stream is independently attributable.

### Step 3: Consolidate and score evidence

For each feature, collect:

- What is this feature and why it exists
- Official statement/source
- Implementation details
- Constraints/limitations
- Risks and compatibility concerns

### Step 4: Map to PAI architecture

Map each item against:

- Skill behaviors and workflows
- Agent orchestration
- Tooling or config assumptions
- Testing or validation surfaces

### Step 5: Draft recommendations

Apply priority framework:

- **High**: immediate value, low-to-medium risk (or monitor ranking elevated priority)
- **Medium**: moderate value, defined follow-up
- **Aspirational**: useful but uncertain without additional validation
- Preserve canonical output contract ordering:
  - **Discoveries → Recommendations → Implementation Targets**
- Internal learnings may outrank external discoveries when ranking evidence is stronger.

## Verify

- Each recommendation must include at least one source link.
- Confidence score and effort estimate present for every item.
- For each feature, include explicit evidence that matches the conclusion.
- If source coverage is weak, mark as `Needs additional validation` rather than recommending blindly.

## Output

Create a research memo that stays aligned with runtime output:

- Executive summary
- Per-feature findings with evidence table
- Architecture mapping notes
- `discoveries[]`, `recommendations[]`, `implementation_targets[]`
- Concrete next actions scoped to implementation targets
