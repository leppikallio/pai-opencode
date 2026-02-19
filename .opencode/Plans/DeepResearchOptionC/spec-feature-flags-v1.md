# spec-feature-flags-v1 (P01-06)

## Purpose
Define the feature flags (config surface) for Option C in the **integration layer**.

## Constraints
- No OpenCode core changes.
- Flags must be readable by tools/plugins/commands.

## Proposed config sources (priority order)
1. PAI/OpenCode settings.json in the integration layer (deployed into runtime)

Environment variables are **not** a supported configuration surface for Option C flags.

Evidence that settings.json exists in integration layer:
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/settings.json`

## Flag namespace
Prefix: `PAI_DR_` (Deep Research)

## Flags (v1)
| Flag | Type | Default | Purpose |
|---|---|---:|---|
| `PAI_DR_OPTION_C_ENABLED` | bool | true | master enable/disable |
| `PAI_DR_MODE_DEFAULT` | enum | standard | `quick|standard|deep` |
| `PAI_DR_MAX_WAVE1_AGENTS` | int | 6 | fan-out cap |
| `PAI_DR_MAX_WAVE2_AGENTS` | int | 6 | fan-out cap |
| `PAI_DR_MAX_SUMMARY_KB` | int | 5 | per-summary cap |
| `PAI_DR_MAX_TOTAL_SUMMARY_KB` | int | 60 | summary-pack cap |
| `PAI_DR_MAX_REVIEW_ITERATIONS` | int | 4 | synthesis reviewer loop cap |
| `PAI_DR_CITATION_VALIDATION_TIER` | enum | standard | `basic|standard|thorough` |
| `PAI_DR_NO_WEB` | bool | false | force offline/no-web mode |
| `PAI_DR_RUNS_ROOT` | string | `~/.config/opencode/research-runs` | base directory for long-lived run roots |

## Rules
1. Flags must be recorded into `manifest.json` at run start (for reproducibility).
2. Changing flags mid-run must not invalidate resume; the manifest’s stored values win.
3. `PAI_DR_RUNS_ROOT` controls the default `artifacts.root` used by `deep_research_run_init` when `root_override` is not provided.
4. `source.env` must remain empty in normal operation (no env reads).

## Acceptance criteria
- Flags can disable the whole subsystem safely.
- Caps prevent runaway parallelization.
- Flags are visible in manifest for audit.

## Evidence
This file defines concrete flag names, defaults, and rules.
