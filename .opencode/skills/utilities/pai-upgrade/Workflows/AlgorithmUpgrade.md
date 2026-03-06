# AlgorithmUpgrade

## Purpose

Map mined reflection themes to the current algorithm and propose concrete edits.

## Inputs

- Reflection themes from `MineAlgorithmReflections.ts`
- Current algorithm selector: `~/.config/opencode/skills/PAI/Components/Algorithm/LATEST`

## Steps

### Step 1: Mine reflections first

Run:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/MineAlgorithmReflections.ts --pretty
```

If no reflections exist yet, stop with a note that there is not enough internal evidence for an algorithm upgrade pass.

### Step 2: Read the current algorithm target

- Read `~/.config/opencode/skills/PAI/Components/Algorithm/LATEST`
- Resolve the current versioned algorithm file
- Read the relevant sections before proposing edits

### Step 3: Map themes to sections

Use the upstream section-mapping idea, adapted for OpenCode paths and the generated-skill flow:

- ISC quality themes → criteria and verification sections in the current algorithm file
- timing or budget themes → effort level and phase budget sections
- capability selection themes → capability selection rules
- verification gaps → verify phase rules
- PRD or workflow drift → PRD and execution-phase sections

### Step 4: Propose concrete edits

For each meaningful recurring theme:

- identify the current section text
- explain the gap between reflection evidence and current wording
- propose exact wording or structural edits
- note whether the change also requires regenerating `~/.config/opencode/skills/PAI/SKILL.md`

## Output

Produce an algorithm upgrade report with:

- reflections analyzed
- section heat map
- concrete proposed edits
- suggested follow-up actions for the generated-skill flow
