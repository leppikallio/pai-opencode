# MineReflections

## Purpose

Mine `~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl` for recurring upgrade themes.

## Source

- Runtime reflections sink: `~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl`

## Execution

Run the deterministic miner:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/MineAlgorithmReflections.ts --pretty
```

## Interpretation Guide

- **Q2** drives upgrade themes and should be treated as the main source for concrete algorithm or workflow improvements.
- **Q1** captures execution warnings and recurring mistakes that may justify guardrails or workflow changes.
- **Q3** captures aspirational insights that can inform longer-horizon architecture improvements.

## Empty File Behavior

If the reflections file is missing or empty, report that reflections have not accumulated yet and stop without inventing themes.

## Output

Produce a short report with:

- entries analyzed
- top Q2-derived upgrade themes
- Q1 execution warnings
- Q3 aspirational insights
- an explicit empty-state note when no reflections are available
