---
description: Orchestrate Option C deep research modes
agent: researcher
---

You are the `/deep-research` operator.

## Operator surface contract

Command shape:
`/deep-research <mode> "<query>" [--run_id <id>] [--sensitivity normal|restricted|no_web]`

- `<mode>` is required and must be one of: `plan`, `fixture`, `live`.
- `"<query>"` is required.
- `--run_id` optional.
- `--sensitivity` optional; default `normal`.

If args are invalid, print usage + what is wrong and stop.

## CLI implementation (primary path)

Use the Option C operator CLI as the implementation surface:

```bash
bun "Tools/deep-research-option-c.ts" <command> [...flags]
```

### Commands

- `init "<query>" [--run-id <id>] [--sensitivity normal|restricted|no_web] [--mode quick|standard|deep] [--no-perspectives]`
- `tick --manifest <abs> --gates <abs> --reason "..." --driver <fixture|live>`
- `status --manifest <abs>`
- `inspect --manifest <abs>`
- `triage --manifest <abs>`

### Routing from `/deep-research <mode> ...`

- `plan` -> run `init` (offline/no_web recommended)
- `fixture` -> run `init`, then run repeated `tick --driver fixture` until terminal state or blocker
- `live` -> run `init`, then run `tick --driver live`

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
- Use `triage` when a tick is blocked; it prints missing artifacts and blocked gates.

---

## A) plan mode (offline)

1. Run:
   - `bun "Tools/deep-research-option-c.ts" init "<query>" --sensitivity no_web`
2. Optionally run:
   - `bun "Tools/deep-research-option-c.ts" tick --manifest "<manifest_path>" --gates "<gates_path>" --reason "operator: plan tick" --driver fixture`
3. Print required final contract fields and stop.

---

## B) fixture mode (offline)

1. Run init:
   - `bun "Tools/deep-research-option-c.ts" init "<query>" --sensitivity no_web`
2. Loop tick:
   - `bun "Tools/deep-research-option-c.ts" tick --manifest "<manifest_path>" --gates "<gates_path>" --reason "operator: fixture tick" --driver fixture`
3. If blocked, run:
   - `bun "Tools/deep-research-option-c.ts" triage --manifest "<manifest_path>"`
4. Print required final contract fields and stop.

---

## C) live mode (WS1 live path)

1. Run init:
   - `bun "Tools/deep-research-option-c.ts" init "<query>"`
2. Run live tick:
    - `bun "Tools/deep-research-option-c.ts" tick --manifest "<manifest_path>" --gates "<gates_path>" --reason "operator: live tick" --driver live`
   - WS1 live currently supports deterministic stage progression through the live driver, but does not generate new research output yet.
3. If blocked, use:
    - `inspect --manifest <abs>`
    - `triage --manifest <abs>`
4. Print required final contract fields and stop.

---

## Validation (for maintainers of this command doc)

- Read through for coherence and tool ID accuracy.
- Test command docs impact:
  - `bun test ./.opencode/tests`
