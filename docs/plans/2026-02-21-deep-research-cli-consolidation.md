# Deep Research CLI Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate to **one skill** (`deep-research`) and a single canonical **CLI surface** (`deep-research-cli`), while also renaming the underlying tool namespace and manifest/schema keys (no backward compatibility).

**Architecture:** Treat this as a strict rename + schema evolution. We will:
1) rename the CLI entrypoint + package folder,
2) rename the tool group from `deep_research` → `deep_research_cli` (changing tool IDs),
3) rename manifest constraint keys + settings keys and update all tests/fixtures,
4) remove alias skills (`deep-research-option-c`, `deep-research-production`) so only `deep-research` remains.

**Tech Stack:** Bun, TypeScript, cmd-ts, OpenCode plugin tools under `.opencode/tools/*`, skill system under `.opencode/skills/*`.

---

## Non-goals

- Preserve backward compatibility with old skill IDs, old CLI entrypoint, old tool names, or old manifest keys.
- Preserve ability to resume old runs created with old schema keys.
- Update historical archives under `.opencode/Plans/**` (treated as historical unless referenced by active runtime).

## Target end state (canonical contract)

### User-facing

- Skill ID: `deep-research` (only deep research skill installed/selected)
- CLI: `bun ".opencode/pai-tools/deep-research-cli.ts" <command> [...flags]`
- Runtime CLI: `bun "pai-tools/deep-research-cli.ts" <command> [...flags]`

### Internal namespaces

- Tool group/module namespace: `deep_research_cli` (replacing `deep_research`)
- Tool IDs exposed to OpenCode: `deep_research_cli_*` (replacing `deep_research_*`)

### Schema keys

Rename these schema surfaces everywhere (code + fixtures + tests):

- `manifest.query.constraints.option_c.enabled`
  → `manifest.query.constraints.deep_research_cli.enabled`

- `manifest.query.constraints.deep_research_flags`
  → `manifest.query.constraints.deep_research_cli_flags`

- `PAI_DR_OPTION_C_ENABLED` and related `PAI_DR_*` keys
  → `PAI_DR_CLI_ENABLED` and related `PAI_DR_CLI_*` keys (see mapping below)

---

## Rename mapping (file system)

> Use `git mv` for renames. Deleting alias skills is allowed because functionality remains in canonical skill.

### CLI surface (pai-tools)

- Rename: `.opencode/pai-tools/deep-research-option-c.ts`
  → `.opencode/pai-tools/deep-research-cli.ts`

- Rename directory: `.opencode/pai-tools/deep-research-option-c/`
  → `.opencode/pai-tools/deep-research-cli/`
  (this includes: `cli/`, `cmd/`, `drivers/`, `handlers/`, `observability/`, `perspectives/`, `tooling/`, `triage/`, `utils/`)

### Tool group (OpenCode tools)

- Rename file: `.opencode/tools/deep_research.ts`
  → `.opencode/tools/deep_research_cli.ts`

- Rename directory: `.opencode/tools/deep_research/`
  → `.opencode/tools/deep_research_cli/`
  (all tool modules move as a unit)

### Tool docs/wrappers (repo Tools/)

- Rename: `Tools/deep-research-option-c.ts`
  → `Tools/deep-research-cli.ts`

- Rename: `Tools/deep-research-option-c-fixture-run.ts`
  → `Tools/deep-research-cli-fixture-run.ts`

- Rename: `Tools/deep-research-option-c-stage-advance.ts`
  → `Tools/deep-research-cli-stage-advance.ts`

### Skills

- Remove (delete from repo): `.opencode/skills/deep-research-option-c/`
- Remove (delete from repo): `.opencode/skills/deep-research-production/`

- Modify canonical skill:
  - `.opencode/skills/deep-research/SKILL.md`
  - `.opencode/skills/deep-research/Workflows/*.md`

### Tests

- Rename all deep research entity tests to new prefix:
  - `.opencode/tests/entities/deep_research_*.test.ts`
    → `.opencode/tests/entities/deep_research_cli_*.test.ts`
  - `.opencode/tests/smoke/deep_research_*.test.ts`
    → `.opencode/tests/smoke/deep_research_cli_*.test.ts`

### Fixtures

- Update all fixtures under:
  - `.opencode/tests/fixtures/**/manifest.json`
  - `.opencode/tests/fixtures/**/gates.json` (if present)

---

## Rename mapping (schema + settings)

### Constraint + flag object renames

- `constraints.deep_research_flags` → `constraints.deep_research_cli_flags`
- `constraints.option_c` → `constraints.deep_research_cli`

### Flag key renames

| Old key | New key |
|---|---|
| `PAI_DR_OPTION_C_ENABLED` | `PAI_DR_CLI_ENABLED` |
| `PAI_DR_MODE_DEFAULT` | `PAI_DR_CLI_MODE_DEFAULT` |
| `PAI_DR_MAX_WAVE1_AGENTS` | `PAI_DR_CLI_MAX_WAVE1_AGENTS` |
| `PAI_DR_MAX_WAVE2_AGENTS` | `PAI_DR_CLI_MAX_WAVE2_AGENTS` |
| `PAI_DR_MAX_SUMMARY_KB` | `PAI_DR_CLI_MAX_SUMMARY_KB` |
| `PAI_DR_MAX_TOTAL_SUMMARY_KB` | `PAI_DR_CLI_MAX_TOTAL_SUMMARY_KB` |
| `PAI_DR_MAX_REVIEW_ITERATIONS` | `PAI_DR_CLI_MAX_REVIEW_ITERATIONS` |
| `PAI_DR_CITATION_VALIDATION_TIER` | `PAI_DR_CLI_CITATION_VALIDATION_TIER` |
| `PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT` | `PAI_DR_CLI_CITATIONS_BRIGHT_DATA_ENDPOINT` |
| `PAI_DR_CITATIONS_APIFY_ENDPOINT` | `PAI_DR_CLI_CITATIONS_APIFY_ENDPOINT` |
| `PAI_DR_NO_WEB` | `PAI_DR_CLI_NO_WEB` |
| `PAI_DR_RUNS_ROOT` | `PAI_DR_CLI_RUNS_ROOT` |

### Settings path

Rename the integration-layer settings surface:

- From: `deepResearch.flags.*`
- To: `deepResearchCli.flags.*`

Example desired settings snippet:

```json
{
  "deepResearchCli": {
    "flags": {
      "PAI_DR_CLI_ENABLED": true,
      "PAI_DR_CLI_MODE_DEFAULT": "standard",
      "PAI_DR_CLI_NO_WEB": false
    }
  }
}
```

---

## Implementation tasks (bite-sized, 2–10 minutes each)

### Task 0: Create a dedicated worktree branch

**Goal:** isolate the rename work.

Run:

```bash
git status -sb
git worktree add /tmp/wt-deep-research-cli-consolidation -b deep-research-cli-consolidation
```

Then perform all work from `/tmp/wt-deep-research-cli-consolidation`.

### Task 1: Baseline verification (pre-rename)

**Run:**

```bash
bun test ./.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts
bun test ./.opencode/tests/entities/deep_research_run_init.test.ts
```

**Expected:** PASS. If not, stop and fix baseline first.

### Task 2: Rename CLI entrypoint and package folder

**Files:**
- Rename: `.opencode/pai-tools/deep-research-option-c.ts` → `.opencode/pai-tools/deep-research-cli.ts`
- Rename dir: `.opencode/pai-tools/deep-research-option-c/` → `.opencode/pai-tools/deep-research-cli/`

**Steps:**

```bash
git mv .opencode/pai-tools/deep-research-option-c.ts .opencode/pai-tools/deep-research-cli.ts
git mv .opencode/pai-tools/deep-research-option-c .opencode/pai-tools/deep-research-cli
```

**Update:** inside `.opencode/pai-tools/deep-research-cli.ts`

- Change `name: "deep-research-option-c"` → `name: "deep-research-cli"`.
- Update all import paths from `./deep-research-option-c/...` → `./deep-research-cli/...`.

**Validation:**

```bash
bun .opencode/pai-tools/deep-research-cli.ts --help
```

Expected: command list prints, no import errors.

### Task 3: Rename tool namespace entrypoint + directory

**Files:**
- Rename: `.opencode/tools/deep_research.ts` → `.opencode/tools/deep_research_cli.ts`
- Rename: `.opencode/tools/deep_research/` → `.opencode/tools/deep_research_cli/`

**Steps:**

```bash
git mv .opencode/tools/deep_research.ts .opencode/tools/deep_research_cli.ts
git mv .opencode/tools/deep_research .opencode/tools/deep_research_cli
```

**Then update:**

- `.opencode/tools/deep_research_cli.ts` should be:

```ts
export * from "./deep_research_cli/index";
```

**Update all imports** (example):

- From: `"../../../tools/deep_research.ts"`
- To: `"../../../tools/deep_research_cli.ts"`

**Validation:**

```bash
rg -n "tools/deep_research\.ts" .opencode/pai-tools .opencode/tests .opencode/skills
```

Expected: 0 matches.

### Task 4: Rename tool IDs (deep_research_* → deep_research_cli_*)

**Goal:** ensure OpenCode tool registry exposes `deep_research_cli_*` only.

**Approach:** rename the exported tool constants where necessary so the registered tool names change.

**Files (directory):** `.opencode/tools/deep_research_cli/*.ts`

**Steps:**
- For each exported tool constant, rename:
  - `export const run_init = tool(...)` → `export const deep_research_cli_run_init = tool(...)`
  - etc.

**Notes:** the exact registration naming convention depends on the OpenCode plugin loader. Verify tool IDs by running a minimal import or existing tests.

**Validation:**

```bash
bun test ./.opencode/tests/entities/deep_research_operator_cli_stage_preconditions.test.ts
```

Expected: PASS after updating tests to new tool IDs where referenced.

### Task 5: Rename schema keys + settings keys

**Files:**
- `.opencode/tools/deep_research_cli/run_init.ts`
- `.opencode/tools/deep_research_cli/stage_advance.ts`
- `.opencode/tools/deep_research_cli/flags_v1.ts`
- `.opencode/tools/deep_research_cli/lifecycle_lib.ts`
- `.opencode/tools/deep_research_cli/citations_validate_lib.ts`
- plus any other modules that reference:
  - `constraints.option_c`
  - `constraints.deep_research_flags`
  - `PAI_DR_*` keys

**Concrete edits:**

1) In `run_init.ts` manifest writer, change:

```ts
constraints: {
  scope_path: SCOPE_PATH_RELATIVE,
  option_c: { enabled: true },
  deep_research_flags: { PAI_DR_OPTION_C_ENABLED: ..., ... }
}
```

to:

```ts
constraints: {
  scope_path: SCOPE_PATH_RELATIVE,
  deep_research_cli: { enabled: true },
  deep_research_cli_flags: {
    PAI_DR_CLI_ENABLED: flags.cliEnabled,
    PAI_DR_CLI_MODE_DEFAULT: flags.modeDefault,
    // ...
  }
}
```

2) In `stage_advance.ts`, replace the disable check on `constraints.option_c.enabled` with `constraints.deep_research_cli.enabled`.

3) In `flags_v1.ts` and `lifecycle_lib.ts`:
   - switch settings root from `deepResearch.flags` to `deepResearchCli.flags`
   - apply settings for the new `PAI_DR_CLI_*` keys
   - rename internal variable `optionCEnabled` to `cliEnabled`

**Validation:** update fixtures and tests first, then run:

```bash
bun test ./.opencode/tests/entities/deep_research_run_init.test.ts
bun test ./.opencode/tests/entities/deep_research_stage_advance_emergency_disable.test.ts
```

### Task 6: Update fixtures (manifest.json)

**Files:**
- `.opencode/tests/fixtures/**/manifest.json`

**Change:**
- `deep_research_flags` → `deep_research_cli_flags`
- `PAI_DR_OPTION_C_ENABLED` → `PAI_DR_CLI_ENABLED` and all other key renames from the mapping table
- Remove/rename any `source.env` mentions (env is unsupported; keep `source.settings` only)

**Validation:** run the fixture-backed tests:

```bash
bun test ./.opencode/tests/entities/deep_research_fixture_replay.test.ts
bun test ./.opencode/tests/entities/deep_research_gate_e_reports.test.ts
```

### Task 7: Rename and update tests

**Steps:**
1) Rename test files:

```bash
fd '^deep_research_.*\\.test\\.ts$' .opencode/tests -x bash -lc 'git mv "$1" "${1/deep_research_/deep_research_cli_}"' bash {}
```

2) Update their contents:
- CLI path: `.opencode/pai-tools/deep-research-option-c.ts` → `.opencode/pai-tools/deep-research-cli.ts`
- Any schema keys and flag keys per mapping

**Validation:**

```bash
bun test ./.opencode/tests/entities
```

### Task 8: Consolidate skills to a single `deep-research`

**Files:**
- Delete: `.opencode/skills/deep-research-option-c/`
- Delete: `.opencode/skills/deep-research-production/`
- Modify: `.opencode/skills/deep-research/SKILL.md`
- Modify: `.opencode/skills/deep-research/Workflows/*.md`
- Modify: `.opencode/pai-tools/AGENTS.md`

**Edits:**
- Replace all CLI references to `deep-research-option-c.ts` with `deep-research-cli.ts`.
- Remove any text claiming compatibility aliases exist.

**Validation:**

```bash
rg -n "deep-research-option-c|deep-research-production" .opencode/skills .opencode/pai-tools/AGENTS.md
```

Expected: 0 matches.

### Task 9: Update repo `Tools/*` wrappers

**Files:**
- Rename wrappers (see mapping)
- Update import lines to the new CLI entrypoint

Example expected wrapper content:

```ts
import "../.opencode/pai-tools/deep-research-cli.ts";
```

**Validation:**

```bash
bun Tools/deep-research-cli.ts --help
```

### Task 10: Update installer dependency map

**File:** `Tools/Install.ts`

**Change:** remove `SKILL_DEPENDENCIES` entries for now-deleted alias skills.

**Validation:**

```bash
bun Tools/Install.ts --help
```

### Task 11: Final repo-wide “old names = zero” gate

Run:

```bash
rg -n "deep-research-option-c|deep-research-production" .opencode Tools
rg -n "\\boption_c\\b|PAI_DR_OPTION_C_ENABLED|deep_research_flags" .opencode Tools
rg -n "tools/deep_research\\b" .opencode Tools
```

Expected: 0 matches (excluding `.opencode/Plans/**` if still present).

### Task 12: Full test suite

Run:

```bash
bun test ./.opencode/tests
```

Expected: PASS.

### Task 13: Install to runtime and verify runtime consolidation

**Do not edit `~/.config/opencode` directly.** Install from repo:

```bash
bun Tools/Install.ts --target "/Users/zuul/.config/opencode" --verify
```

Then verify runtime state:

```bash
rg -n "deep-research-option-c|deep-research-production" /Users/zuul/.config/opencode/skills /Users/zuul/.config/opencode/pai-tools
rg -n "PAI_DR_OPTION_C_ENABLED|deep_research_flags|\\boption_c\\b" /Users/zuul/.config/opencode/pai-tools /Users/zuul/.config/opencode/tools
```

Expected: 0 matches.

---

## Execution handoff

Plan complete.

Two execution options:

1) **Subagent-Driven (this session)** — dispatch one fresh subagent per task, review and verify between tasks.
   - REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`

2) **Parallel Session** — new session implements plan task-by-task.
   - REQUIRED SUB-SKILL: `superpowers:executing-plans`
