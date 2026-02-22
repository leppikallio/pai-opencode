# Workflow: LLMDriverLoop

Run the `deep-research` CLI in **task-driver** mode while an external LLM/agent writes the required artifacts.

This is the canonical operator loop:

> `tick --driver task --json` → (if halted) run agent → `agent-result --json` → repeat `tick --driver task --json`

## CLI command forms (copy/paste)

```bash
# Repo checkout (this repository)
bun ".opencode/pai-tools/deep-research-cli.ts" <command> [flags]
```

```bash
# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" <command> [flags]
```

### Recommendation

- When an LLM is driving the loop, **always add `--json`**.
  - The CLI emits a single-line JSON envelope: `schema_version="dr.cli.v1"`.
  - When a command halts, `halt.next_commands` is included **inline** in that JSON.

## Init (always set `--run-id`, default to LLM drafting seam)

Pick a stable run id so you can reproduce failures deterministically later.

```bash
# Example run id: dr_<YYYY-MM-DD>_<short-slug>
bun ".opencode/pai-tools/deep-research-cli.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --run-id "<run_id>" \
  --json

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --run-id "<run_id>" \
  --json
```

`init` is seam-first by default. Use `--with-perspectives` only when you intentionally want the legacy fast path (`init -> wave1` directly).

The `--json` envelope includes (at minimum) absolute contract paths:

- `contract.manifest_path`
- `contract.gates_path`

Use those values as `<manifest_abs>` and `<gates_abs>` in subsequent commands.

After init, enter perspectives drafting before normal task-driver ticking:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting" \
  --json

bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task \
  --json
```

## The driver loop (tick → agent-result → tick)

### Step 1: Tick once (prompt-out)

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" tick \
  --manifest "<manifest_abs>" \
  --reason "operator tick" \
  --driver task \
  --json

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" tick \
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
3) Write the agent output to the format required by that stage.

Typical task-driver stages use markdown:

```text
<run_root>/operator/outputs/<stage>/<perspective>.md
```

Perspectives drafting uses JSON outputs instead:

```text
<run_root>/operator/outputs/perspectives/<perspective_id>.raw.json
```

Notes:

- The required **stage** and **perspective id** are the authoritative identifiers.
- Prefer to use the CLI-provided `halt.next_commands` to avoid guessing stage/perspective.

### Step 3: Ingest each output with `agent-result`

Either:

- Copy/paste the `agent-result ...` skeleton(s) from `halt.next_commands`, then fill in `--input` and `--agent-run-id`, **or**
- Run it manually:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage "<stage>" \
  --perspective "<perspective>" \
  --input "<output_path_for_stage_and_perspective>" \
  --agent-run-id "<agent_run_id>" \
  --reason "ingest <stage> <perspective>" \
  --json

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage "<stage>" \
  --perspective "<perspective>" \
  --input "<output_path_for_stage_and_perspective>" \
  --agent-run-id "<agent_run_id>" \
  --reason "ingest <stage> <perspective>" \
  --json
```

For perspectives ensemble halts, execute **multiple** `agent-result` calls (one per required perspective in `halt.next_commands[]`) before resuming.

### Step 4: Tick again

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" tick \
  --manifest "<manifest_abs>" \
  --reason "resume after ingest" \
  --driver task \
  --json

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" tick \
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
