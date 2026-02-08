# RunEval Workflow

Run evaluations for a specific use case.

## Voice Notification

Use the `voice_notify` tool:

- `message`: "Running the RunEval workflow in the evals skill to execute evaluation"

Running the **RunEval** workflow in the **evals** skill to execute evaluation...

---

## Prerequisites

- Use case must exist in `UseCases/<name>/`
- Test cases defined in use case
- Config.yaml with scoring criteria

## Execution

### Step 1: Validate Use Case

```bash
# Check use case exists
ls ~/.config/opencode/skills/evals/UseCases/<use-case>/config.yaml
```

If missing, redirect to `CreateUseCase.md` workflow.

### Step 2: Run Evaluation (Current Implementation)

This repo does not ship an `EvalServer/` web UI + CLI yet.

For now, run a suite-based eval through the Evals toolchain:

```bash
# Run an eval suite (regression/capability)
bun run ~/.config/opencode/skills/evals/Tools/AlgorithmBridge.ts -s <suite>
```

### Step 4: Collect Results

Results are stored in:
- `~/.config/opencode/skills/evals/Results/<suite>/<run-id>/run.json`

### Step 5: Report Summary

Use structured response format:

```markdown
📋 SUMMARY: Evaluation completed for <use-case>

📊 STATUS:
| Metric | Value |
|--------|-------|
| Pass Rate | X% |
| Mean Score | X.XX |
| Failed Tests | X |

📖 STORY EXPLANATION:
1. Ran evaluation against <N> test cases
2. Deterministic scorers completed first
3. AI judges evaluated accuracy and style
4. Calculated weighted scores
5. Compared against pass threshold
6. <Key finding 1>
7. <Key finding 2>
8. <Recommendation>

🎯 COMPLETED: Evaluation finished with X% pass rate.
```

## Error Handling

**If eval fails:**
1. Check model API key is configured
2. Verify test cases have valid inputs
3. Check scorer configurations in config.yaml
4. Review error logs in terminal

## Done

Evaluation complete. Results available in UI and files.

