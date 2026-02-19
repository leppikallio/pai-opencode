# E5 Config precedence rules (post-init)

## Authoritative surfaces after init

1. `manifest.query.constraints.deep_research_flags`
   - Stable run-time policy snapshot emitted by `run_init`.
   - Citation endpoint policy keys:
     - `PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT`
     - `PAI_DR_CITATIONS_APIFY_ENDPOINT`
2. `run-config.json`
   - Effective operator config emitted by CLI init.
   - `effective.citations.mode` resolves from `manifest.query.sensitivity`.
   - `effective.citations.endpoints` persists endpoint values needed for online ladder runs.
   - `effective.citations.source` records audit source (`manifest`, `settings`, or `run-config`).

## Resolution order for citations runtime config

For endpoint values (`brightdata`, `apify`):

1. Manifest flags (`manifest.query.constraints.deep_research_flags`)
2. `run-config.json` (`effective.citations.endpoints`)
   - Includes values materialized at init from settings-backed defaults/caps.

For mode:

1. Manifest sensitivity (`no_web -> offline`, `restricted -> dry_run`, `normal -> online`)
2. `run-config.json` fallback only if manifest sensitivity is absent

## Env field usage policy

- Env var names may appear only as historical field names in settings/artifact snapshots.
- Post-init resolution must read run artifacts (manifest + run-config), not process environment.

## Citations endpoint resolution in practice

- `citations_validate` resolves effective mode/endpoints with source metadata.
- Online fixture metadata stores the effective config used for each run.
- `citations/online-fixtures.latest.json` points to the latest timestamped online fixture artifact.
