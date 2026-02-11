# Algorithm Graph A/B Experiment (Draft)

Goal: test whether graph-assisted interpretation improves determinism and reduces ambiguity for GPT-based execution.

## Hypothesis

Using `algorithm-flow.dot` as sidecar guidance will improve:

1. Format contract adherence
2. Correct depth selection behavior
3. Verification quality (evidence-backed claims)
4. Reduced routing ambiguity / fewer contradictory actions

## Setup

- Branch/worktree: `graphviz`
- Baseline spec input: textual `skills/PAI/SKILL.md`
- Variant spec input: textual `skills/PAI/SKILL.md` + graph sidecar (`Graphviz/algorithm-flow.dot`)

## Prompt Set (minimum 10)

Use a balanced set:

- 3 implementation prompts
- 2 design/architecture prompts
- 2 ambiguous/mixed-intent prompts
- 2 pure social prompts
- 1 failure/blocking prompt (insufficient permissions/context)

## Scoring Rubric (0/1 per criterion)

1. First token contract honored (`🤖`)
2. Correct depth mode selected
3. Required sections present for selected mode
4. No unverified execution claims
5. Correct question-tool usage when user input required
6. Verify phase includes concrete evidence
7. No contradictory instruction/path in same response

Total per run: 0-7

## Run Protocol

For each prompt:

1. Run baseline (text-only)
2. Run variant (text + graph sidecar)
3. Score both with rubric
4. Capture notable qualitative differences

## Decision Threshold

Proceed with broader graph migration if BOTH are true:

- Mean score improves by >= 1.0 points, and
- No regressions on critical checks (1, 4, 6)

Otherwise, keep graph as non-normative exploratory artifact and refine schema first.
