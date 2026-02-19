---
description: Orchestrate Option C deep research modes
agent: researcher
---

You are the `/deep-research` operator.

## Safety / enablement

No env vars required; use CLI flags and run artifacts.

## Operator surface contract

Command shape:
`/deep-research <mode> "<query>" [--run-id <id> --runs-root <abs>] [--sensitivity normal|restricted|no_web]`

- `<mode>` is required and must be one of: `plan`, `fixture`, `live`.
- `"<query>"` is required.
- `--run-id` optional.
- When `--run-id` is provided, `--runs-root <absolute-path>` is required.
- `--sensitivity` optional; default `normal`.

If args are invalid, print usage + what is wrong and stop.

## CLI implementation (primary path)

Use the Option C operator CLI as the implementation surface:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" <command> [...flags]
```

### Commands

- `init "<query>" [--run-id <id>] [--sensitivity normal|restricted|no_web] [--mode quick|standard|deep] [--no-perspectives]`
- `tick --manifest <abs> --gates <abs> --reason "..." --driver <fixture|live|task>`
- `agent-result --manifest <abs> --stage wave1 --perspective <id> --input <abs_md> --agent-run-id <string> --reason <text> [--started-at <iso>] [--finished-at <iso>] [--model <string>]`
- `run --manifest <abs> --gates <abs> --reason "..." --driver <fixture|live> [--max-ticks <n>]`
- `status --manifest <abs>`
- `inspect --manifest <abs>`
- `triage --manifest <abs>`
- `pause --manifest <abs> [--reason "..."]`
- `resume --manifest <abs> [--reason "..."]`

### Routing from `/deep-research <mode> ...`

- `plan` -> run `init` (offline/no_web recommended)
- `fixture` -> run `init`, then run repeated `tick --driver fixture` until terminal state or blocker
- `live` -> run `init`, then run `run --driver live` (operator-input driver)

Use `inspect` and `triage` to explain blockers between ticks.

## Required final print contract (all modes)

Always print these fields before stopping:
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`
- `stage.current`
- `status`

Map `run_root` from tool field `root` when needed.

## Shared artifacts and defaults

Default minimal perspective payload (single perspective, id `p1`):

```json
{
  "schema_version": "perspectives.v1",
  "run_id": "<run_id>",
  "created_at": "<now-iso>",
  "perspectives": [
    {
      "id": "p1",
      "title": "Default synthesis perspective",
      "track": "standard",
      "agent_type": "ClaudeResearcher",
      "prompt_contract": {
        "max_words": 900,
        "max_sources": 12,
        "tool_budget": { "search_calls": 4, "fetch_calls": 6 },
        "must_include_sections": ["Findings", "Sources", "Gaps"]
      }
    }
  ]
}
```

### Stage progression

- `tick` is the only stage progression command.
- Driver decides progression strategy:
  - `fixture`: deterministic fixture-style stage advancement.
  - `live`: live orchestrator path (WS1 core only).
  - `task`: non-blocking wave1 prompt-out driver. Writes prompts, halts with `RUN_AGENT_REQUIRED`, then resumes after `agent-result` ingestion.
- Use `triage` when a tick is blocked; it prints missing artifacts and blocked gates.

---

## A) plan mode (offline)

1. Run:
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --sensitivity no_web`
2. Optionally run:
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_path>" --gates "<gates_path>" --reason "operator: plan tick" --driver fixture`
3. Print required final contract fields and stop.

---

## B) fixture mode (offline)

1. Run init:
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --sensitivity no_web`
2. Loop tick:
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_path>" --gates "<gates_path>" --reason "operator: fixture tick" --driver fixture`
3. If blocked, run:
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<manifest_path>"`
4. Print required final contract fields and stop.

---

## C) live mode (task driver loop)

Goal: run Wave 1 without manual draft editing using `tick --driver task` + `agent-result`.

### C1) Initialize

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" [--run-id <id>]
```

Capture the printed paths:
- `manifest_path`
- `gates_path`
- `run_root`

### C2) Prompt-out tick (non-blocking)

Run one task-driver tick:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_abs>" --driver task --reason "wave1 task tick"
```

Behavior contract:
- Writes prompt artifacts to `operator/prompts/wave1/<perspective_id>.md` for all missing perspectives.
- Does **not** wait for input.
- Halts with typed condition `RUN_AGENT_REQUIRED`.
- Writes `operator/halt/latest.json` (`halt.v1`) with one `agent-result ...` skeleton command per missing perspective in `next_commands[]`.

### C3) Result-in per perspective

For each missing perspective, ingest agent markdown using:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage wave1 \
  --perspective "<id>" \
  --input "<abs_markdown_file>" \
  --agent-run-id "<run-id>" \
  --reason "wave1 ingest <id>"
```

`agent-result` writes canonical outputs:
- `wave-1/<id>.md`
- `wave-1/<id>.meta.json`

Sidecar contract (`wave-output-meta.v1`):
- `prompt_digest` (from `wave-1/wave1-plan.json` prompt_md)
- `agent_run_id`
- `ingested_at`
- `source_input_path`
- optional: `started_at`, `finished_at`, `model`

### C4) Resume tick after ingestion

Re-run task tick:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_abs>" --driver task --reason "wave1 resume"
```

When all missing perspectives are ingested, the deterministic wave pipeline proceeds and advances toward `pivot`.

### C5) If blocked

Use the CLI to inspect blockers at any time:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --manifest "<manifest_path>"
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<manifest_path>"
```

### C6) Manual fallback (operator-input driver)

If you explicitly want manual editing instead of Task-backed autonomy:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" run --manifest "<manifest_path>" --gates "<gates_path>" --reason "operator: live run" --driver live
```

The CLI will write:
- `operator/prompts/<stage>/<perspective_id>.md`
- `operator/drafts/<stage>/<perspective_id>.md`

Edit the draft and press ENTER to continue each step.

### Live driver artifact contract (E1-T1, Option A target)

For task-driver loop execution in `wave1`, the operational contract is:

- Prompt output artifact (required):
  - `operator/prompts/wave1/<perspective_id>.md`
- Canonical ingested markdown (required):
  - `wave-1/<perspective_id>.md`
- Canonical metadata sidecar (required):
  - `wave-1/<perspective_id>.meta.json`

Required `meta.json` fields:

```json
{
  "schema_version": "wave-output-meta.v1",
  "prompt_digest": "sha256:<hex>",
  "agent_run_id": "<string>",
  "ingested_at": "<iso-8601>",
  "source_input_path": "<absolute-markdown-path>",
  "started_at": "<iso-8601>",
  "finished_at": "<iso-8601>",
  "model": "<optional-model-id>"
}
```

Rules:

- `tick --driver task` MUST halt with `RUN_AGENT_REQUIRED` instead of waiting for manual input.
- `next_commands[]` in halt artifact MUST include one `agent-result` skeleton per missing perspective.
- `agent-result` MUST compute `prompt_digest` from the wave1 plan entry for that perspective.

---

## Validation (for maintainers of this command doc)

- Read through for coherence and tool ID accuracy.
- Test command docs impact:
  - `bun test ./.opencode/tests`
