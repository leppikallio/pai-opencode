# Workflow: Triage Findings

## When to use

- After a scan produces findings
- Before deciding whether to block a commit/PR

## Inputs

- JSON findings from skill-scanner
- optional context: changed files, intended behavior

## Preferred command (Phase 2)

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/AdjudicateFindingsWithOpencode.py" \
  --scan-report "<REPORT_JSON_PATH>" \
  --model "openai/gpt-5.2"
```

Use `--strict` when you want the run to fail if structured adjudication JSON cannot be extracted.

## Triage rubric

For each finding, classify:

- **Verdict**: `true_positive` | `likely_false_positive` | `needs_review`
- **Exploitability**: low/medium/high
- **Impact**: low/medium/high/critical
- **Action**: fix now | defer with rationale | tune rule

## Decision order (fix before mute)

Apply this order strictly:

1. **Can we fix the underlying issue safely now?**
   - If yes, create/execute remediation task.
2. **If not fixed immediately, is it still exploitable?**
   - If yes, keep finding active and escalate.
3. **Only if non-exploitable in context**, consider rule tuning/disable.
   - Must record rationale, owner, and revisit trigger.

## Output format

Produce a concise table/list with:

1. finding id (`rule_id`)
2. file + line
3. verdict + confidence
4. remediation recommendation
5. decision type (`fixed` | `deferred-fix` | `tuned-rule`) with rationale

Tool artifacts produced:

- `adjudication.json`
- `prioritized-actions.md`
- `llm-text-output.txt`
- `opencode-events.jsonl`

## Follow-up

After triage, generate a human-readable audit report with:

- `Workflows/GenerateAuditReport.md`

## Phase 2 direction

This workflow is the bridge to automated local subagent adjudication.
When implemented, triage should become structured and repeatable from raw JSON input.
