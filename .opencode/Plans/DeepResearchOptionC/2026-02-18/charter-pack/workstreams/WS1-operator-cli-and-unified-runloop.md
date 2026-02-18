# WS1 — Operator CLI + Unified Run Loop (no env vars)

## Objective

Deliver a single operator-grade entrypoint that the LLM/operator can drive *without env vars* and that dispatches by `manifest.stage.current`.

This workstream is the foundation for running M2/M3 evidence runs repeatedly and safely.

## Inputs / Evidence anchors

- Architect: Operator CLI spec and "unify orchestrator" next step.
- Engineer: “make /deep-research live a real loop”, “typed run/resume/status/triage”, “no env fiddling”.

## Scope (what we will do)

1) Implement a single CLI entrypoint:

- `.opencode/pai-tools/deep-research-option-c.ts`

With commands:

- `init`, `tick`, `run`, `status`, `inspect`, `triage`, `pause`, `resume`

2) CLI must set required flags internally (in-process) and persist run-local config:

- `<run_root>/run-config.json` (new; schema v1)

3) Update `/deep-research` command doc to be a thin wrapper contract that calls the CLI.

## Non-goals

- Do not implement wave2 or generate mode here.
- Do not modify OpenCode.

## Deliverables (files)

- `.opencode/pai-tools/deep-research-option-c.ts`
- `Tools/lib/deep_research_option_c_cli/*` (optional helper modules, keep minimal)
- `.opencode/commands/deep-research.md` updates:
  - remove env-var setup steps
  - document CLI usage and print contract

## Acceptance criteria

- [ ] Operator can run: `init` → `tick` → `status` without env vars.
- [ ] `tick` reads `manifest.stage.current` and calls the correct orchestrator segment.
- [ ] CLI prints required contract fields:
  - run_id, run_root, manifest_path, gates_path, stage.current, status
- [ ] `inspect`/`triage` prints compact blockers from `stage_advance` error decision payload.
- [ ] `pause` and `resume` set durable state and write checkpoint artifacts.

## Verification commands

```bash
bun test ./.opencode/tests
bun Tools/Precommit.ts
```

## Reviews

- Architect PASS required (operator UX correctness, no traps)
- QA PASS required (commands work; tests cover)
