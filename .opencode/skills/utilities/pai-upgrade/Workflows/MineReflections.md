# MineReflections

## Purpose

Mine internal reflection signals via the PAI upgrade intelligence monitoring pipeline.

## Source

- Runtime reflections sink: `~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl`

## Execution

Run the canonical operator entrypoint:

```bash
bun ~/.config/opencode/skills/utilities/pai-upgrade/Tools/MonitorSources.ts --days 14 --provider anthropic --format json
```

Reflection mining is internal to `MonitorSources.ts`; do not run a second operator-facing reflections command.

## Interpretation Guide

- **Q2** drives upgrade themes and should be treated as the main source for concrete algorithm or workflow improvements.
- **Q1** captures execution warnings and recurring mistakes that may justify guardrails or workflow changes.
- **Q3** captures aspirational insights that can inform longer-horizon architecture improvements.
- Internal learnings may outrank external discoveries when ranking evidence is stronger.

## Empty File Behavior

If the reflections file is missing or empty, report that reflections have not accumulated yet and stop without inventing themes.

## Output

Produce output aligned to the canonical contract:

- **Discoveries → Recommendations → Implementation Targets**
- Reflection-derived discoveries represented as internal-origin entries in `discoveries[]`
- Recommendations and implementation targets derived from the same ranked pipeline
