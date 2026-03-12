# PromptClassifier

Canonical advisory prompt-hint producer (utility path).

## Usage

```bash
bun ~/.config/opencode/skills/PAI/Tools/PromptClassifier.ts [--carrier-mode active|shadow|disabled] "<user prompt>"
```

## Output

Prints canonical advisory envelope JSON to stdout:

- `kind`: `pai.advisory_hint`
- `advisory.depth`: `MINIMAL` | `ITERATION` | `FULL`
- `advisory.reasoning_profile`: `light` | `standard` | `deep`
- `advisory.verbosity`: `minimal` | `standard` | `detailed`
- `advisory.capabilities`: suggested capability labels
- `advisory.thinking_tools`: suggested thinking tools
- `provenance`: producer trace with deterministic reducer selection

## Advisory-Only Contract

The envelope is advisory-only and must not include imperative routing controls.

Forbidden keys include:

- `model`
- `spawn`
- `run_in_background`
- `subagent_type`

## Carrier Modes

- `active` (default): heuristic + carrier candidate; reducer picks deterministically
- `shadow`: both candidates captured; heuristic remains selected
- `disabled`: heuristic-only output (recommended for producer parity tests)

## Inference Backend

When carrier mode is not disabled, PromptClassifier uses `Inference.ts` with this preset:

- `level`: `fast`
- `timeout`: `2000ms` (intentional quick-pass budget)
- `model`: `openai/gpt-5.2` (explicit override)
- `reasoningEffort` / `textVerbosity` / `steps`: unset by this tool

Auth behavior:

- Carrier: OpenCode server path (same auth session used by OpenCode)
- No direct `OPENAI_API_KEY` path in this classifier
- If carrier inference fails or is disabled, deterministic heuristic remains available
