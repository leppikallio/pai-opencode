# PAI Tools — AGENTS.md

This file exists to keep the **operator CLIs** in `pai-tools/` easy for an LLM to maintain and extend.

It focuses on two themes:

1) **Contract unification** — one predictable, test-backed CLI contract across commands.
2) **Drift elimination** — cross-cutting logic/types live in one place, not copy/pasted into many handlers.

---

## Canonical entrypoints

- Canonical Option C operator CLI (source):
  - `.opencode/pai-tools/deep-research-cli.ts`
  - Installed runtime path: `pai-tools/deep-research-cli.ts`
- Repo shim (keep it):
  - `Tools/deep-research-cli.ts` (imports the canonical file)

---

## Directory layout and responsibility

`deep-research-cli/`

- `cmd/` — **cmd-ts parsing only**
  - Defines flags/args, then calls a handler (`deps.runX`).
  - No filesystem writes, no tool calls, no business logic.

- `handlers/` — **command behavior**
  - Implements `runX(args): Promise<void>`.
  - Orchestrates feature modules + shared helpers.

- `cli/` — **cross-cutting CLI policy**
  - `json-mode.ts` (stdout/stderr contract + `emitJson`)
  - `contract-json.ts` (shared contract payloads)
  - `errors.ts` (CLI error helpers)

- `utils/` — **pure-ish utilities** (paths, json IO, run-handle resolution, etc.)

- `tooling/` — **tool invocation adapters** (envelope parsing, `callTool`, tool context)

- `drivers/` — driver implementations (fixture/live/task), not embedded inside handlers.

- `perspectives/`, `triage/`, `observability/` — feature modules

### Dependency direction (keep it boring)

Prefer:

`cmd/*` → `handlers/*` → (`perspectives/*`, `triage/*`, `observability/*`, `drivers/*`, `utils/*`, `tooling/*`, `cli/*`)

Avoid:

- feature modules importing `cli/*` (domain/schema logic should be CLI-agnostic)
- ad-hoc direct imports of `../../../tools/deep_research_cli.ts` from many files (wrap in `tooling/*` helpers)

---

## Contract unification (what it entails)

### 1) JSON mode is a hard operator/LLM contract

- If `--json` is present:
  - **stdout is reserved for exactly one JSON object**.
  - Any incidental logging must go to **stderr**.
  - Use `emitJson(payload)` for the one stdout object.

Implementation note: `cli/json-mode.ts` currently enforces this by redirecting `console.log` → `console.error` when JSON mode is enabled.

### 2) Unify the JSON envelope shape (target contract)

When you add/modify commands, treat this as the north star:

```json
{
  "ok": true,
  "command": "tick",
  "run_id": "...",
  "run_root": "...",
  "manifest_path": "...",
  "gates_path": "...",
  "stage_current": "...",
  "status": "...",
  "result": { }
}
```

On failure:

```json
{
  "ok": false,
  "command": "tick",
  "error": { "code": "SOME_CODE", "message": "...", "details": {} }
}
```

### 3) Exit code rule (target contract)

- Exit code **0 iff** top-level `ok === true`.
- Exit code **1** otherwise.

This prevents “ok:false but exit 0” ambiguity for automation.

---

## Drift elimination (what it entails)

### Single-source cross-cutting helpers

If you find yourself copy/pasting any of these, extract them:

- Option C enabled guard (`ensureOptionCEnabledForCli` / `requireOptionCEnabled`)
- “next step” CLI invocation builder (`nextStepCliInvocation`)
- run-handle argument types (`RunHandleCliArgs`) and selector rules
- wave plan entry parsing + prompt digest validation

Rule of thumb: **if it appears in 2+ handlers, it must become a shared helper**.

### Prevent type drift

- Define shared arg types and enums once (e.g., run stage unions).
- `cmd/*` and `handlers/*` must import the shared types, not redefine them.

### Keep handlers manageable (LLM-friendly)

- Prefer handlers to be orchestrators, not “god files”.
- If a handler grows beyond ~250 LOC, split by concern:
  - input validation
  - orchestration core
  - output formatting (text vs json)
  - feature-specific helpers (task driver, wave plan parsing, etc.)

### Layering rule: domain/schema must not depend on CLI

Example anti-pattern to avoid repeating: `perspectives/schema.ts` importing from `cli/errors.ts`.
Instead, move coded errors to a neutral module or return structured errors.

---

## How to add a new command (current workflow)

1) Add handler:
   - `deep-research-cli/handlers/<command>.ts`
   - Export: `run<Command>(args): Promise<void>`

2) Add cmd-ts command:
   - `deep-research-cli/cmd/<command>.ts`
   - Export: `create<Command>Cmd({ AbsolutePath, run<Command> })`
   - Include:
     - run-handle selectors when applicable (`--manifest|--run-root|--run-id` + `--runs-root`)
     - `--reason` for any state-changing action
     - `--json` when machine output exists

3) Wire it in the entrypoint:
   - `.opencode/pai-tools/deep-research-cli.ts`
   - Import the cmd factory and handler, then add it to `subcommands({ cmds: { ... } })`.

4) Add/adjust tests:
   - `.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts`
   - Add a focused test any time you change JSON envelope shape, exit codes, or run-handle flags.

---

## Verification commands (run locally before claiming “done”)

The canonical list lives in:
- `.opencode/Plans/DeepResearchOptionC/2026-02-20/01-cli-refactor-plan-llm-manageable.md`

Common quick set:

```bash
# Tier 0
bun .opencode/pai-tools/deep-research-cli.ts --help
bun .opencode/pai-tools/deep-research-cli.ts status --help

# Tier 1 (CLI behavior)
bun test ./.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts
bun test ./.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts
bun test ./.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts
```
