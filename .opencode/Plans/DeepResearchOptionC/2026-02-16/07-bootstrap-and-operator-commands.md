# Option C — Bootstrap & Operator Commands

Date: 2026-02-16

This is the “how do I actually run things?” file for a new agent/operator.

---

## Repo bootstrap

From repo root:

```bash
cd "/Users/zuul/Projects/pai-opencode-graphviz"
bun install
```

Run the full deep research test suite:

```bash
bun test ./.opencode/tests
```

Run one entity test:

```bash
bun test ./.opencode/tests/entities/deep_research_stage_advance.test.ts
```

Run precommit checks:

```bash
bun Tools/Precommit.ts
```

---

## Environment variables (operator-critical)

| Var | Values | Meaning |
|---|---|---|
| `PAI_DR_OPTION_C_ENABLED` | `1` / `0` | master enable/disable |
| `PAI_DR_NO_WEB` | `1` / unset | force no-web mode |
| `PAI_DR_LIVE_TESTS` | `1` | allow live smoke tests (proposed in testing plan) |

---

## Canonical run root

Real runs live under:

```text
/Users/zuul/.config/opencode/research-runs/<run_id>
```

---

## Operator command surface (target contract)

The required operator command is:

```text
/deep-research <mode> "<query>" [--run_id <id>] [--sensitivity normal|restricted|no_web]
```

Modes:
- `plan` — generate perspectives + wave plans, no agents, no web
- `fixture` — offline fixture driver, deterministic
- `live` — real agent spawning + API/web retrieval (via drivers)

Contract (must always print):
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`
- `stage.current`
- `status`

On hard failure:
- typed error code
- remediation hint
- non-zero exit/failure

---

## How to run commands in OpenCode

These command files live under `.opencode/commands/` and are intended to be executed as **slash commands** inside an OpenCode session.

Operator workflow:
1) Start OpenCode in this repo.
2) In the chat input, run:
   - `/deep-research-status`
   - `/deep-research plan "<query>"`
   - `/deep-research fixture "<query>"`
   - `/deep-research live "<query>"`

If the runtime you’re in does not support slash commands, use the equivalent tool-by-tool procedure described in the operator plan.

---

## Where to look when something fails

In the run root:
- `manifest.json` (current stage + history)
- `gates.json` (gate statuses)
- `logs/audit.jsonl` (append-only event log)
