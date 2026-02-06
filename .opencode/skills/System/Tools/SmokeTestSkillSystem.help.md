# SmokeTestSkillSystem

Pragmatic verification for “does the system behave as intended” after SkillSystem/CreateSkill refactors.

This tool supports **parallel validation** by running in a *fresh OpenCode session* via `opencode run`, without touching your current interactive session.

## Modes

### 1) Static (no LLM calls)

Runs:

- SkillSystem router/section invariants:
  - `/Users/zuul/.config/opencode/skills/System/Tools/ValidateSkillSystemDocs.ts`
- Budget-line checks for key skills (examples excluded):
  - `/Users/zuul/.config/opencode/skills/CreateSkill/Tools/CountSkillBudgetLines.ts`

Run:

```bash
bun "/Users/zuul/.config/opencode/skills/System/Tools/SmokeTestSkillSystem.ts" --mode static
```

### 2) Behavior (LLM calls via `opencode run`)

Runs `opencode run --format json` for a small suite of targeted prompts that must:

- trigger Read-gated behavior
- cite the correct SkillSystem canary comment (strongest anti-guessing proof)

Run:

```bash
bun "/Users/zuul/.config/opencode/skills/System/Tools/SmokeTestSkillSystem.ts" \
  --mode behavior \
  --agent Engineer \
  --model openai/gpt-5.3-codex
```

Tip for debugging:

```bash
bun "/Users/zuul/.config/opencode/skills/System/Tools/SmokeTestSkillSystem.ts" \
  --mode behavior \
  --print-logs
```

### 3) Both

```bash
bun "/Users/zuul/.config/opencode/skills/System/Tools/SmokeTestSkillSystem.ts" --mode both
```

## Output formats

- default: human-readable text
- `--format json`: machine-readable report

## Exit codes

- `0`: all checks passed
- `1`: one or more checks failed
- `2`: tool error (bad args / IO / spawn failures)

## Notes

- This tool assumes runtime is installed at `/Users/zuul/.config/opencode`.
- Behavioral checks spend tokens and can fail if the provider/model rejects the request.
  When that happens, inspect the error event output from `opencode run`.
