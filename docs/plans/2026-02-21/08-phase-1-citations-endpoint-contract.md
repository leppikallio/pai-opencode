# Deep Research Option C — Phase 1B (Citations endpoint contract) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make online citations configuration explicit, inspectable, and reproducible by flowing endpoints through: CLI `init` flags → `run-config.json` → `citations_validate` resolver.

**Architecture:** `citations_validate` already reads `run-config.json` (if present). This phase ensures operator CLI can *authoritatively* populate it without relying on ambient settings.json.

**Tech Stack:** cmd-ts CLI init command + handler; tool layer citations validator; bun:test regression tests.

---

## Phase outputs (deliverables)

- `deep-research-cli init` accepts:
  - `--citations-brightdata-endpoint <url>`
  - `--citations-apify-endpoint <url>`
  - (optional) `--citation-validation-tier basic|standard|thorough`
- `run-config.json` records endpoints and their source as `run-config`.
- `citations_validate` resolves endpoints from run-config (already) and uses them in online mode.

## Task 1B.1: Add failing regression test for init → run-config endpoint flow

**Files:**
- Create: `.opencode/tests/regression/deep_research_init_writes_citations_endpoints_regression.test.ts`
- Modify later: `.opencode/pai-tools/deep-research-cli/cmd/init.ts`
- Modify later: `.opencode/pai-tools/deep-research-cli/handlers/init.ts`

**Step 1: Write failing test**

Test strategy:
- Run `bun .opencode/pai-tools/deep-research-cli.ts init --json ...` with endpoint flags.
- Parse stdout JSON, read `run_config_path`, load run-config and assert:
  - endpoints match the flags
  - `source.endpoints.*` is `run-config`

**Step 2: Run (expect FAIL)**

```bash
bun test .opencode/tests/regression/deep_research_init_writes_citations_endpoints_regression.test.ts
```

## Task 1B.2: Add init command flags

**Files:**
- Modify: `.opencode/pai-tools/deep-research-cli/cmd/init.ts`

**Step 1: Add options**

Extend `RunInitArgs` with:

- `citationsBrightDataEndpoint?: string`
- `citationsApifyEndpoint?: string`
- `citationValidationTier?: "basic" | "standard" | "thorough"`

Add cmd-ts options:

- `--citations-brightdata-endpoint`
- `--citations-apify-endpoint`
- `--citation-validation-tier`

**Step 2: Commit**

```bash
git add .opencode/pai-tools/deep-research-cli/cmd/init.ts
git commit -m "feat(dr-cli): add init flags for citations endpoints"
```

## Task 1B.3: Wire init flags into run-config.json

**Files:**
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/init.ts` (thread args → `writeRunConfig`)

**Step 1: Update `InitCliArgs` and `writeRunConfig` signature**

- Pass the CLI-provided endpoints into `writeRunConfig`.
- Update `brightDataSource` / `apifySource` logic:
  - if CLI flag provided → source = `run-config`
  - else fallback to manifest/settings as today

**Step 2: Ensure empty strings become null**

- Trim and normalize.
- Validate that provided endpoints look like URLs (minimal: must start with `http`), or leave strict validation for later.

**Step 3: Re-run regression test (expect PASS) + commit**

```bash
bun test .opencode/tests/regression/deep_research_init_writes_citations_endpoints_regression.test.ts
git add .opencode/pai-tools/deep-research-cli/handlers/init.ts .opencode/tests/regression/deep_research_init_writes_citations_endpoints_regression.test.ts
git commit -m "feat(dr-cli): write citations endpoints to run-config"
```

## Task 1B.4: (Optional) Add regression test for citations_validate resolving from run-config

**Files:**
- Create: `.opencode/tests/regression/deep_research_citations_validate_uses_run_config_endpoints_regression.test.ts`

Test strategy:
- Create run root + manifest + run-config with endpoints.
- Run `citations_validate` in `online_dry_run` mode (no network) and assert resolved endpoints appear in returned JSON.

## Phase 1B Gate

**Gate execution (required):**

- Architect agent reviews CLI contract and ensures no ambient settings dependence is required.
- QATester agent runs regression tests and reports PASS/FAIL.

### QA Gate — PASS checklist

```bash
bun test .opencode/tests/regression/deep_research_init_writes_citations_endpoints_regression.test.ts
```

Expected: PASS.
