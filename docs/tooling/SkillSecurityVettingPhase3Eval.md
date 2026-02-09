# Skill Security Vetting — Phase 3 Eval

This document records the initial Phase 3 comparison run after integrating native `OpencodeAnalyzer` in the scanner fork.

## Scope

- Target set: `.opencode/skills` in `pai-opencode`
- Baseline: deterministic scan (static + behavioral + trigger)
- Phase 2: adjudication summary from OpenCode triage
- Phase 3: deterministic scan + `--use-opencode`

## Snapshot

### Baseline deterministic raw

- Skills: 40
- Findings: 16
- Severity: CRITICAL=3, HIGH=0, MEDIUM=11, LOW=0, INFO=2

### Phase 2 adjudication

- Reviewed: 10
- Verdicts: TP=1, likely FP=7, needs review=2
- Actions: fix_now=9, needs_human_review=1

### Phase 3 opencode-enabled

- Skills: 40
- Findings: 16
- Severity: CRITICAL=3, HIGH=0, MEDIUM=11, LOW=0, INFO=2
- Opencode analyzer findings: 0

## Tuning iteration (follow-up)

After tuning prompt extraction and using realistic opencode timeout values, semantic findings were observed on targeted runs.

### Malicious fixture: `eval-execution`

- Total findings: 10
- Opencode findings: 3
  - CRITICAL: arbitrary code execution via `eval()`
  - CRITICAL: arbitrary code execution via `exec()`
  - MEDIUM: misleading “safe” claims in SKILL.md

### Malicious fixture: `environment-secrets`

- Total findings: 12
- Opencode findings: 5
  - CRITICAL: environment secret exfiltration
  - CRITICAL: external HTTP exfil endpoint usage
  - HIGH/MEDIUM: undeclared network + obfuscation + policy mismatch

### PAI skill sample: `web-assessment`

- Total findings: 9
- Opencode findings: 3
  - HIGH: shell command injection risk (`shell=True`)
  - MEDIUM: untrusted customization override path risk
  - LOW: mandatory tool invocation instruction risk

### PAI skill sample: `documents/pdf`

- Total findings: 3
- Opencode findings: 3
  - HIGH: unnecessary CORE context loading exposure
  - MEDIUM: possible PII leakage in stdout validation paths
  - LOW: password-like literal in example command

## Conclusion

- Phase 3 infrastructure is functional (analyzer wired into scanner/CLI/API).
- Initial full-scan pass with low timeout under-represented semantic output.
- Tuned runs demonstrate meaningful semantic findings across malicious fixtures and selected PAI skills.
- No regression observed.

## Next tuning work

1. Run a full-repo opencode comparison with a production timeout budget.
2. Calibrate severity for semantic policy-style findings to minimize noise.
3. Add explicit precision/recall tracking against known fixture corpora.
4. Decide default enablement point in `RunSecurityScan.py` wrapper (off vs opt-in profile).
