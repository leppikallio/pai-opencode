# Evals CLI Reference

## CLI-First Architecture

This skill follows the CLI-First Architecture pattern:

```
User Request -> AI orchestrates -> Evals Tools -> Deterministic results
```

---

## CLI Commands

### Use Case Management

Use cases are file-backed under `UseCases/`. There is no `EvalServer/cli.ts` in this repo.

Test cases are file-backed under `UseCases/<name>/test-cases/`.

### Run Evaluations

```bash
# Run an eval suite and optionally update ISC
bun run ~/.config/opencode/skills/Evals/Tools/AlgorithmBridge.ts -s <suite>
```

---

## Web UI

Not shipped in this repo.

---

## Storage Strategy

### Files (Source of Truth)

```
~/.config/opencode/skills/Evals/
├── UseCases/
│   └── <name>/
│       ├── config.yaml         # Criteria, thresholds
│       ├── judge-config.yaml   # Judge template data
│       ├── rubric.yaml         # Rubric template data
│       ├── test-cases/         # Input/expected pairs
│       ├── golden-outputs/     # Reference standards
│       ├── prompts/            # Versioned prompts
│       └── README.md           # Use case documentation
├── Results/
│   └── <use-case>/
│       └── <run-id>/           # Per-run results
└── (no EvalServer shipped)
```

### SQLite (Query Optimization)

Not shipped in this repo.
