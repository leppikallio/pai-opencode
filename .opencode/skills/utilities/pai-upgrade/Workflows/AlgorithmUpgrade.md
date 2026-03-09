# AlgorithmUpgrade

## Purpose

Map ranked monitor findings (including internal reflections) to the current algorithm and propose concrete edits.

## Inputs

- Reflection and external findings from `Tools/MonitorSources.ts`
- Current algorithm selector: `~/.config/opencode/skills/PAI/Components/Algorithm/LATEST`

## Steps

### Step 1: Mine reflections first

Run:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/MonitorSources.ts --days 14 --provider anthropic --format json
```

If no reflections exist yet, continue with external discoveries only.

### Step 2: Read the current algorithm target

- Read `~/.config/opencode/skills/PAI/Components/Algorithm/LATEST`
- Resolve the current versioned algorithm file
- Read the relevant sections before proposing edits

### Step 3: Map themes to sections

Use ranked findings, adapted for OpenCode paths and the generated-skill flow:

- ISC quality themes → criteria and verification sections in the current algorithm file
- timing or budget themes → effort level and phase budget sections
- capability selection themes → capability selection rules
- verification gaps → verify phase rules
- PRD or workflow drift → PRD and execution-phase sections
- Internal learnings may outrank external discoveries when ranking evidence is stronger.

### Step 4: Propose concrete edits

For each meaningful recurring theme:

- identify the current section text
- explain the gap between reflection evidence and current wording
- propose exact wording or structural edits
- note whether the change also requires regenerating `~/.config/opencode/skills/PAI/SKILL.md`

## Output

Produce an algorithm upgrade report with:

- discoveries analyzed (internal + external)
- section heat map
- concrete proposed edits
- canonical contract linkage: **Discoveries → Recommendations → Implementation Targets**
- suggested follow-up actions for the generated-skill flow
