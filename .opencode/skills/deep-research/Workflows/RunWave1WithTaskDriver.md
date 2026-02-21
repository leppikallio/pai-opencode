# Workflow: RunWave1WithTaskDriver

Run Wave 1 with the non-manual task driver loop (`tick --driver task` + `agent-result`).

## Preconditions

- Task driver mode is enabled (`--driver task`).
- `manifest.json`, `gates.json`, and the Wave 1 plan artifact exist under the run root.

## Staleness guard (common failure)

If `tick --driver task` fails fast with `WAVE1_PLAN_STALE`, your Wave 1 plan no longer matches `perspectives.json`.

- Fix: regenerate the Wave 1 plan by re-running the perspectives drafting + promotion flow.
- Reference: DraftPerspectivesFromQuery.md

## Inputs

- `manifest_path` (absolute)
- `reason`

## Steps

1. Start from a valid run initialized for live execution.

2. Execute one prompt-out tick:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" tick --manifest "<manifest_abs>" --reason "wave1 task tick" --driver task
```

3. On halt (`RUN_AGENT_REQUIRED`), read prompts from:
   - `operator/prompts/wave1/<perspective_id>.md`

4. For each missing perspective, ingest markdown via CLI:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage wave1 \
  --perspective "<id>" \
  --input "<abs_markdown_file>" \
  --agent-run-id "<agent_run_id>" \
  --reason "wave1 ingest <id>" \
  [--started-at "<iso>"] [--finished-at "<iso>"] [--model "<model>"]
```

5. Verify canonical artifacts after each ingest:
   - `wave-1/<id>.md`
   - `wave-1/<id>.meta.json` (`schema_version=wave-output-meta.v1`)

6. Re-run tick until Wave 1 clears:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" tick --manifest "<manifest_abs>" --reason "wave1 resume" --driver task
```

7. When all missing perspectives are ingested, deterministic review/Gate B flow proceeds and stage advances to `pivot`.

## Retry directive interpretation

- Retry directives are stored in the run-root `retry-directives.json` artifact.
- `RETRY_REQUIRED` means Wave 1 must rerun affected perspectives before pivot.
- `RETRY_CAP_EXHAUSTED` means escalation is required; do not force pivot.

## Validation contract

- [ ] `tick --driver task` writes `operator/prompts/wave1/<id>.md` and halts with `RUN_AGENT_REQUIRED`.
- [ ] `operator/halt/latest.json.error.code == RUN_AGENT_REQUIRED` and `next_commands[]` has one `agent-result` skeleton per missing perspective.
- [ ] `agent-result` writes `wave-1/<id>.md` and `wave-1/<id>.meta.json`.
- [ ] `wave-1/<id>.meta.json.prompt_digest` matches sha256 digest derived from the run-root Wave 1 plan artifact prompt_md.
- [ ] Subsequent `tick --driver task` can continue deterministic Wave 1 progression toward `pivot`.
