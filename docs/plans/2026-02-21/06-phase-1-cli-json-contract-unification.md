# Deep Research Option C — Phase 1A (CLI JSON contract unification) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make the operator CLI reliably LLM-drivable by standardizing a single JSON envelope and removing repo/runtime invocation ambiguity.

**Architecture:** Every `--json` command prints exactly one stdout JSON object with:

- `schema_version`
- `ok`
- `command`
- `contract` (run handle + stage + status + `cli_invocation`)
- `result` or `error`
- optional `halt` with **inline** `next_commands[]`

No command should require scraping stderr or reading files just to know the next step.

**Tech Stack:** cmd-ts CLI (`/.opencode/pai-tools/deep-research-cli/**`), shared JSON helpers (`cli/json-mode.ts`).

---

## Phase outputs (deliverables)

- `tick --json` includes `halt.next_commands[]` inline and includes `contract.cli_invocation`.
- `init/run/status/inspect/triage/pause/resume/... --json` share the same envelope shape.
- The CLI prints the correct invocation string for *its environment* (repo vs runtime).

## Task 1A.1: Document current JSON shapes (baseline)

**Files:**
- Create: `docs/architecture/deep-research/cli-json-contract-current.md`

**Step 1: Capture current shapes**

For each command, include a real example JSON (redact local paths only if needed):

- `init --json`
- `tick --json` (ok=true)
- `tick --json` (ok=false with halt)
- `status --json`
- `inspect --json`
- `triage --json`

**Step 2: Commit**

```bash
git add docs/architecture/deep-research/cli-json-contract-current.md
git commit -m "docs(dr-cli): capture current --json envelope shapes"
```

## Task 1A.2: Add a canonical JSON envelope builder

**Files:**
- Create: `.opencode/pai-tools/deep-research-cli/cli/json-contract.ts`
- Modify: `.opencode/pai-tools/deep-research-cli/cli/json-mode.ts`

**Step 1: Implement a helper**

Add a single function like:

```ts
export function emitJsonV1(payload: {
  ok: boolean;
  command: string;
  contract: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  halt?: Record<string, unknown> | null;
}): void {
  emitJson({ schema_version: "dr.cli.v1", ...payload });
}
```

**Step 2: Add a tiny unit/regression test**

- Ensure stdout is parseable JSON and contains `schema_version`.

**Step 3: Commit**

```bash
git add .opencode/pai-tools/deep-research-cli/cli/json-contract.ts .opencode/pai-tools/deep-research-cli/cli/json-mode.ts
git commit -m "feat(dr-cli): introduce canonical JSON envelope helper"
```

## Task 1A.3: Unify CLI invocation string in one place

**Files:**
- Create: `.opencode/pai-tools/deep-research-cli/utils/cli-invocation.ts`
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/tick.ts` (replace `nextStepCliInvocation()`)
- Modify: `.opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts` (use unified invocation)

**Step 1: Implement resolver**

Rules:
- If `.opencode/pai-tools/deep-research-cli.ts` exists relative to `process.cwd()`, use:
  - `bun ".opencode/pai-tools/deep-research-cli.ts"`
- Else default to runtime:
  - `bun "pai-tools/deep-research-cli.ts"`

**Step 2: Commit**

```bash
git add .opencode/pai-tools/deep-research-cli/utils/cli-invocation.ts .opencode/pai-tools/deep-research-cli/handlers/tick.ts .opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts
git commit -m "fix(dr-cli): unify repo/runtime cli_invocation"
```

## Task 1A.4: Migrate each handler to the canonical envelope

**Files (likely):**
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/{init,tick,run,status,inspect,triage,pause,resume,cancel,agent-result}.ts`

**Step 1: Update one command at a time**

For each command:

1) Replace direct `emitJson({ ... })` calls with `emitJsonV1({ contract: ..., result: ... })`
2) Ensure `contract` always includes:
   - `run_id`, `run_root`, `manifest_path`, `gates_path`, `stage_current`, `status`, `cli_invocation`

**Step 2: Add regression tests**

Create: `.opencode/tests/regression/deep_research_cli_json_envelope_regression.test.ts`

Test strategy:
- Spawn the CLI with `bun .opencode/pai-tools/deep-research-cli.ts <cmd> --json ...`.
- Parse stdout and assert required keys exist.

**Step 3: Commit per command**

Keep commits small (one handler + test adjustments).

## Phase 1A Gate (must PASS before Phase 1B)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL** against the Architect checklist.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with the raw test output.

### Architect Gate — PASS checklist

- [ ] `--json` envelope is consistent across commands.
- [ ] `contract.cli_invocation` is correct for repo and runtime.
- [ ] `halt.next_commands[]` is present inline when halting.

### QA Gate — PASS checklist

```bash
bun test .opencode/tests/regression/deep_research_cli_json_envelope_regression.test.ts
bun test .opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts
```

Expected: all PASS.
