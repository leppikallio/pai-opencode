# Workflow: LLMDriverLoop

Run the `deep-research` CLI in **task-driver** mode while an external LLM/agent writes the required artifacts.

This is the canonical operator loop:

> `tick --driver task --json` → (if halted) run agent → `agent-result` → repeat `tick`

## Choose CLI invocation

```bash
# Repo checkout (this repository)
CLI='bun .opencode/pai-tools/deep-research-cli.ts'
# Runtime install (~/.config/opencode)
# CLI='bun pai-tools/deep-research-cli.ts'
```

### Recommendation

- When an LLM is driving the loop, **always add `--json`**.
  - The CLI emits a single-line JSON envelope: `schema_version="dr.cli.v1"`.
  - When a command halts, `halt.next_commands` is included **inline** in that JSON.

## Init (always set `--run-id`)

Pick a stable run id so you can reproduce failures deterministically later.

```bash
# Example run id: dr_<YYYY-MM-DD>_<short-slug>
$CLI init "<query>" \
  --mode standard \
  --sensitivity normal \
  --run-id "<run_id>" \
  --json
```

The `--json` envelope includes (at minimum) the absolute `contract.manifest_path`.

## The driver loop (tick → agent-result → tick)

### Step 1: Tick once (prompt-out)

```bash
$CLI tick \
  --manifest "<manifest_abs>" \
  --reason "operator tick" \
  --driver task \
  --json
```

Interpret the JSON:

- If `ok=true`: the CLI progressed deterministically. Continue ticking until it halts or finishes.
- If `ok=false` and `halt` is present:
  - Read `halt.next_commands[]` **from stdout** (preferred), or from `<run_root>/operator/halt/latest.json`.
  - If `error.code == "RUN_AGENT_REQUIRED"`, you must produce one or more agent outputs, then ingest them.

### Step 2: On `RUN_AGENT_REQUIRED`, write the required outputs

When `tick` halts, the CLI writes prompt files under the run root, for example:

- `<run_root>/operator/prompts/<stage>/<perspective>.md`

For each required prompt:

1) Read the prompt markdown.
2) Run your external LLM/agent on that prompt.
3) Write the agent’s markdown output to:

```text
<run_root>/operator/outputs/<stage>/<perspective>.md
```

Notes:

- The required **stage** and **perspective id** are the authoritative identifiers.
- Prefer to use the CLI-provided `halt.next_commands` to avoid guessing stage/perspective.

### Step 3: Ingest each output with `agent-result`

Either:

- Copy/paste the `agent-result ...` skeleton(s) from `halt.next_commands`, then fill in `--input` and `--agent-run-id`, **or**
- Run it manually:

```bash
$CLI agent-result \
  --manifest "<manifest_abs>" \
  --stage "<stage>" \
  --perspective "<perspective>" \
  --input "<run_root>/operator/outputs/<stage>/<perspective>.md" \
  --agent-run-id "<agent_run_id>" \
  --reason "ingest <stage> <perspective>" \
  --json
```

### Step 4: Tick again

```bash
$CLI tick \
  --manifest "<manifest_abs>" \
  --reason "resume after ingest" \
  --driver task \
  --json
```

Repeat until the run reaches a terminal stage/status.

## Using `halt.next_commands` (recommended)

When present, `halt.next_commands[]` is the **authoritative** next-step list.

- It is included inline in the `dr.cli.v1` JSON envelope when you pass `--json`.
- It may be present even when the command fails for other reasons (example: `INVALID_STATE`).

Operational rule:

> If `halt.next_commands` exists, execute those commands (after filling in any placeholders) before doing anything else.
