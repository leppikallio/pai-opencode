# Deep Research Option C — Phase 0c (CLI contracts + JSON envelope) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make the operator CLI *LLM-proof* by standardizing JSON envelopes, fixing repo-vs-runtime invocation strings, and making endpoint/config contracts explicit.

**Architecture:** Add one shared JSON envelope helper and use it across all CLI commands when `--json` is enabled. Compute `contract.cli_invocation` dynamically.

**Tech Stack:** Bun + TypeScript; CLI under `.opencode/pai-tools/deep-research-cli/**`; bun:test entity tests.

---

## Phase outputs (deliverables)

- Every CLI command supports a consistent JSON envelope shape (`dr.cli.v1`) when `--json` is enabled.
- JSON output includes a `contract` block with:
  - `cli_invocation`
  - `run_id`, `run_root`, `manifest_path`, `gates_path`
  - `stage_current`, `status`
- `halt.next_commands[]` is included inline (not only in a halt file).
- `init` exposes explicit flags for citation endpoints and persists them into `run-config.json`.

## Task 0c.1: Create Phase 0c worktree

**Files:**
- (none)

**Step 1: Create a worktree**

```bash
git worktree add /tmp/pai-dr-phase0c -b dr-phase0c-cli-contracts
```

**Step 2: Verify clean state**

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 0c.2: Add failing entity test for CLI invocation detection (should FAIL initially)

**Files:**
- Create: `.opencode/tests/entities/deep_research_cli_invocation_contract.test.ts`
- Modify later: `.opencode/pai-tools/deep-research-cli/handlers/tick.ts`

**Step 1: Write failing test**

This test assumes it runs from repo root (where `.opencode/pai-tools/deep-research-cli.ts` exists).

```ts
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// Import a new helper you will create in Task 0c.3.
import { detectCliInvocation } from "../../pai-tools/deep-research-cli/utils/cli-invocation";

describe("deep-research-cli invocation contract (entity)", () => {
  test("detectCliInvocation returns repo invocation when repo entrypoint exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), ".opencode/pai-tools/deep-research-cli.ts"))).toBe(true);
    expect(detectCliInvocation()).toBe('bun ".opencode/pai-tools/deep-research-cli.ts"');
  });
});
```

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/entities/deep_research_cli_invocation_contract.test.ts
```

Expected: FAIL (helper doesn’t exist yet, and tick handler currently hardcodes runtime invocation).

---

## Task 0c.3: Implement detectCliInvocation helper (make test PASS)

**Files:**
- Create: `.opencode/pai-tools/deep-research-cli/utils/cli-invocation.ts`

**Step 1: Implement helper**

```ts
import * as fs from "node:fs";
import * as path from "node:path";

export function detectCliInvocation(): string {
  const repoEntrypoint = path.join(process.cwd(), ".opencode/pai-tools/deep-research-cli.ts");
  if (fs.existsSync(repoEntrypoint)) return 'bun ".opencode/pai-tools/deep-research-cli.ts"';
  return 'bun "pai-tools/deep-research-cli.ts"';
}
```

**Step 2: Re-run test + commit**

```bash
bun test .opencode/tests/entities/deep_research_cli_invocation_contract.test.ts
git add .opencode/pai-tools/deep-research-cli/utils/cli-invocation.ts .opencode/tests/entities/deep_research_cli_invocation_contract.test.ts
git commit -m "feat(dr-cli): detect repo vs runtime invocation"
```

---

## Task 0c.4: Add failing entity test for JSON envelope shape (should FAIL initially)

**Files:**
- Create: `.opencode/tests/entities/deep_research_cli_json_envelope_entity.test.ts`
- Modify later: CLI handlers (tick + init at minimum)

**Step 1: Write failing test**

Spawn the CLI with `--json`, parse stdout, and assert the envelope shape.

```ts
import { describe, expect, test } from "bun:test";

describe("deep-research-cli JSON envelope (entity)", () => {
  test("init --json emits dr.cli.v1 envelope", async () => {
    const proc = Bun.spawn([
      "bun",
      ".opencode/pai-tools/deep-research-cli.ts",
      "init",
      "regression: json envelope",
      "--mode",
      "quick",
      "--sensitivity",
      "no_web",
      "--json",
    ], { stdout: "pipe", stderr: "pipe" });

    const out = await new Response(proc.stdout).text();
    const obj = JSON.parse(out) as any;
    expect(obj.schema_version).toBe("dr.cli.v1");
    expect(typeof obj.ok).toBe("boolean");
    expect(obj.command).toBe("init");
    expect(obj.contract && typeof obj.contract.cli_invocation).toBe("string");
  });
});
```

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/entities/deep_research_cli_json_envelope_entity.test.ts
```

Expected: FAIL until the envelope exists.

---

## Task 0c.5: Implement shared JSON envelope helper and apply to init + tick

**Files:**
- Create: `.opencode/pai-tools/deep-research-cli/cli/envelope.ts`
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/init.ts`
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/tick.ts`

**Step 1: Add envelope types + emit helper**

In `cli/envelope.ts`, implement:

```ts
export type CliEnvelopeV1 = {
  schema_version: "dr.cli.v1";
  ok: boolean;
  command: string;
  contract: {
    cli_invocation: string;
    run_id: string | null;
    run_root: string | null;
    manifest_path: string | null;
    gates_path: string | null;
    stage_current: string | null;
    status: string | null;
  };
  result: unknown | null;
  halt: unknown | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
};
```

and a function:

```ts
export function buildEnvelope(args: Omit<CliEnvelopeV1, "schema_version">): CliEnvelopeV1 {
  return { schema_version: "dr.cli.v1", ...args };
}
```

**Step 2: Compute `contract.cli_invocation` using detectCliInvocation**

Use the helper from Task 0c.3.

**Step 3: Apply to init + tick when `--json`**

- Wrap the existing handler outputs into `result`.
- Ensure `halt` includes `next_commands` inline for tick (Phase 0 already planned this; this phase standardizes the wrapper).

**Step 4: Make entity test PASS + commit**

```bash
bun test .opencode/tests/entities/deep_research_cli_json_envelope_entity.test.ts
git add \
  .opencode/pai-tools/deep-research-cli/cli/envelope.ts \
  .opencode/pai-tools/deep-research-cli/handlers/init.ts \
  .opencode/pai-tools/deep-research-cli/handlers/tick.ts
git commit -m "feat(dr-cli): standardize --json envelope (init, tick)"
```

---

## Task 0c.6: Add explicit init flags for citation endpoints and persist them

**Files:**
- Modify: `.opencode/pai-tools/deep-research-cli/cmd/init.ts`
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/init.ts`
- Create: `.opencode/tests/entities/deep_research_cli_init_endpoints_flags.test.ts`

**Step 1: Add failing entity test**

Spawn:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" init "x" --mode quick --sensitivity normal \
  --citations-brightdata-endpoint "http://example" \
  --citations-apify-endpoint "http://example2" \
  --json
```

Then in test, locate `run_root` from JSON output and assert `run-config.json` includes those endpoints under `effective.citations.endpoints`.

**Step 2: Implement flags**

- Add options:
  - `--citations-brightdata-endpoint <url>`
  - `--citations-apify-endpoint <url>`
- In `writeRunConfig()`, prefer CLI args over manifest/settings and record `source.endpoints.* = "cli"`.

**Step 3: Run test + commit**

```bash
bun test .opencode/tests/entities/deep_research_cli_init_endpoints_flags.test.ts
git add .opencode/pai-tools/deep-research-cli/cmd/init.ts \
  .opencode/pai-tools/deep-research-cli/handlers/init.ts \
  .opencode/tests/entities/deep_research_cli_init_endpoints_flags.test.ts
git commit -m "feat(dr-cli): add init flags for citation endpoints"
```

---

## Phase 0c Gate (completion)

Run:

```bash
bun test .opencode/tests/entities/deep_research_cli_invocation_contract.test.ts
bun test .opencode/tests/entities/deep_research_cli_json_envelope_entity.test.ts
bun test .opencode/tests/entities/deep_research_cli_init_endpoints_flags.test.ts
```

Expected: all PASS.
