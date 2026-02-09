# AdjudicateFindingsWithOpencode

Phase 2 helper that runs LLM adjudication over `skill-scanner` findings via `opencode run`.

## Purpose

Transform raw findings into structured triage decisions:

- verdict (`true_positive | likely_false_positive | needs_review`)
- exploitability + impact
- action (`fix_now | deferred_fix | tuned_rule | needs_human_review`)
- remediation + rationale

## Usage

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/AdjudicateFindingsWithOpencode.py" \
  --scan-report "/path/to/report.json" \
  --model "openai/gpt-5.2"
```

## Key options

- `--scan-report <path>`: input `report.json` from scanner run
- `--output-dir <dir>`: where triage artifacts are written
- `--model <provider/model>`: OpenCode model id
- `--agent <name>`: optional OpenCode agent
- `--max-findings <n>`: cap findings for one adjudication run
- `--strict`: fail if structured JSON extraction fails

## Artifacts

- `adjudication.json`
- `prioritized-actions.md`
- `llm-text-output.txt`
- `opencode-events.jsonl`
- `opencode-stderr.log`
