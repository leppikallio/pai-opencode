# ViewResults Workflow

Query and display evaluation results, generate reports, and track trends.

## Voice Notification

Use the `voice_notify` tool:

- `message`: "Running the ViewResults workflow in the evals skill to display eval results"

Running the **ViewResults** workflow in the **evals** skill to display eval results...

---

## Prerequisites

- Evaluations have been run
- Results exist in Results/ directory or SQLite database

## Execution

### Step 1: Identify Query

Ask the user:
1. Which use case?
2. What time range? (latest, last week, specific run)
3. What to show? (summary, details, comparison, trends)
4. What format? (table, report, chart)

### Step 2: Quick Status Check (File-Based)

```bash
# List suites with results
ls -la ~/.config/opencode/skills/evals/Results

# List runs for a suite
ls -la ~/.config/opencode/skills/evals/Results/<suite>
```

### Step 3: View Detailed Results (File-Based)

```bash
# View the raw run payload
cat ~/.config/opencode/skills/evals/Results/<suite>/<run-id>/run.json
```

### Step 4: Generate Report

This is not yet standardized in the repo. If you have a report template, render it with:

```bash
bun run ~/.config/opencode/skills/prompting/Tools/RenderTemplate.ts --help
```

### Step 5: Query Database

This repo does not ship the EvalServer SQLite layer.

### Step 6: Compare Runs

Manual comparison for now:

```bash
diff -u \
  ~/.config/opencode/skills/evals/Results/<suite>/<run-a>/run.json \
  ~/.config/opencode/skills/evals/Results/<suite>/<run-b>/run.json
```

### Step 7: Report Summary

Use structured response format:

```markdown
📋 SUMMARY: Evaluation results for <use-case>

📊 STATUS:
| Metric | Value |
|--------|-------|
| Run ID | <run-id> |
| Date | <date> |
| Model | <model> |
| Pass Rate | X% |
| Mean Score | X.XX |
| Total Tests | N |
| Passed | N |
| Failed | N |

📖 STORY EXPLANATION:
1. Retrieved evaluation run from <date>
2. <N> test cases were evaluated
3. Deterministic scorers ran first (format, length, voice)
4. AI judges evaluated accuracy and style
5. Weighted scores calculated
6. <Pass rate>% passed the 0.75 threshold
7. <Key finding about top/bottom performers>
8. <Recommendation based on results>

🎯 COMPLETED: Results retrieved for <use-case>, <pass-rate>% pass rate.
```

## Query Patterns

### By Time Range

```bash
# Last 24 hours
--since "24 hours ago"

# Last week
--since "7 days ago"

# Specific date range
--from "2024-01-01" --to "2024-01-15"
```

### By Score Threshold

```bash
# Only failed runs
--min-pass-rate 0 --max-pass-rate 0.74

# Only excellent runs
--min-pass-rate 0.90
```

### By Model

```bash
# Specific model
--model claude-3-5-sonnet-20241022

# Compare models
--compare-models
```

### By Test Case

```bash
# Specific test
--test-id 001-basic

# All failures
--failures-only
```

## Output Formats

### Table (Default)

```
┌──────────┬────────────────────────────┬───────────┬────────────┐
│ Run ID   │ Model                      │ Pass Rate │ Mean Score │
├──────────┼────────────────────────────┼───────────┼────────────┤
│ abc123   │ claude-3-5-sonnet-20241022 │ 92%       │ 4.3        │
│ def456   │ gpt-4o                     │ 88%       │ 4.1        │
└──────────┴────────────────────────────┴───────────┴────────────┘
```

### JSON

```bash
--format json
```

```json
{
  "run_id": "abc123",
  "use_case": "newsletter_summaries",
  "model": "claude-3-5-sonnet-20241022",
  "summary": {
    "total_cases": 12,
    "passed": 11,
    "failed": 1,
    "pass_rate": 0.917,
    "mean_score": 4.3,
    "std_dev": 0.5
  },
  "per_test_case": [...]
}
```

### Markdown Report

```bash
--format markdown
```

Uses Report.hbs template to generate full report.

### CSV Export

```bash
--format csv --output results.csv
```

For spreadsheet analysis.

## Trend Analysis (File-Based)

This repo does not ship an EvalServer trend CLI or web UI.

Use the on-disk results in `Results/`:

```bash
# List runs (newest last if you sort)
ls -la ~/.config/opencode/skills/evals/Results/<suite>

# Inspect a run
cat ~/.config/opencode/skills/evals/Results/<suite>/<run-id>/run.json
```

If you have `jq`, you can quickly extract headline metrics:

```bash
jq -r '.pass_rate, .mean_score, .n_trials' \
  ~/.config/opencode/skills/evals/Results/<suite>/<run-id>/run.json
```

## Common Queries (File-Based)

### "How did the last eval go?"

```bash
ls -la ~/.config/opencode/skills/evals/Results/<suite> | tail -n 5
```

### "Show me the summary for a run"

```bash
cat ~/.config/opencode/skills/evals/Results/<suite>/<run-id>/run.json
```

## Done

Results retrieved and reported. Use findings to guide prompt/model decisions.

