# PAI Graphviz Sidecar

This directory contains Graphviz sidecar artifacts that describe PAI behavior without replacing `SKILL.md`.

## Purpose

- Make complex process logic easier to reason about for humans and LLMs.
- Keep source-of-truth text intact while adding visual execution maps.
- Detect ambiguity early before broader rewrites.

## Modified Graphviz Conventions (PAI)

We use standard DOT plus a small semantic styling layer:

- **Node classes**
  - `process` (box): executable step
  - `decision` (diamond): branch condition
  - `gate` (octagon): hard quality/security checkpoint
  - `artifact` (note): produced/consumed document or state

- **Edge classes**
  - `MUST` (solid red): mandatory contract path
  - `SHOULD` (solid orange): recommended path
  - `MAY` (dashed gray): optional behavior

- **Authority flags**
  - `authoritative` cluster border: dark green
  - `legacy/compat` cluster border: gray dashed

- **Conflict marker**
  - If two edges contradict each other, add an edge label: `CONFLICT:<id>`

## Initial Artifacts

- `algorithm-flow.dot` — core Algorithm execution path (FULL / ITERATION / MINIMAL, overview)
- `algorithm-observe.dot` — deep breakdown of phase 1 (reverse engineering + ISC validation)
- `algorithm-think.dot` — deep breakdown of phase 2 (thinking-tool assessment + capability selection)
- `authority-map.dot` — documentation authority ownership and conflict/deprecation edges
- `authority-map-notes.md` — rewrite-tracker references and authority-map maintenance notes

## Decomposition Strategy

Use a two-tier graph model:

1. **Overview graph** (`algorithm-flow.dot`) for quick orientation and branching behavior.
2. **Phase detail graphs** (`algorithm-<phase>.dot`) for high-complexity phases.

Rule of thumb: if a phase exceeds ~10 nodes or mixes multiple abstraction levels (rules + routing + gates), split it into its own phase graph.

## Experiment Plan (A/B)

Before broad migration, compare baseline text-only vs graph-assisted interpretation:

1. Choose 8–12 representative prompts (design, implementation, analysis, ambiguous requests).
2. Run baseline responses using current textual guidance only.
3. Run graph-assisted responses using sidecar graph references.
4. Score on:
   - routing correctness
   - contract compliance
   - verification quality
   - ambiguity/conflict incidents
5. Proceed only if graph-assisted mode shows meaningful reduction in ambiguity and contract violations.

## Next Session Priority

Before broad graph expansion, sync sidecar and text contract to:

- `<../Components/Algorithm/v0.2.34.md>` (localized for OpenCode runtime semantics)

Then re-run A/B on the updated contract.

## Rendering

```bash
dot -Tsvg .opencode/skills/PAI/Graphviz/algorithm-flow.dot -o /tmp/pai-algorithm-flow.svg
```
