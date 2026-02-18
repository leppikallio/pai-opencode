# Integration + Final Review Plan (post-epics)

## When to use this
Only after **all epics E1–E8 are merged** and their validators are PASS.

## Integration policy

### Merge order (suggested)
1) E2 CLI ergonomics
2) E5 config + citations guidance
3) E4 observability
4) E3 long-run timeouts
5) E1 production runAgent driver
6) E7 production skill
7) E6 canaries
8) E8 charter refresh

Reason: reduce conflicts (CLI/config/observability should stabilize before driver + canaries).

### Commands
All commands run from repo root:
`/Users/zuul/Projects/pai-opencode-graphviz`

```bash
git checkout graphviz
git status

# Merge each epic branch (prefer fast-forward; if not possible, use normal merge)
git merge --ff-only ws/epic-e2-cli-ergonomics
git merge --ff-only ws/epic-e5-config-citations
git merge --ff-only ws/epic-e4-observability
git merge --ff-only ws/epic-e3-longrun-timeouts
git merge --ff-only ws/epic-e1-runagent-driver
git merge --ff-only ws/epic-e7-production-skill
git merge --ff-only ws/epic-e6-canaries
git merge --ff-only ws/epic-e8-charter-refresh

# Global verification
bun test ./.opencode/tests
bun Tools/Precommit.ts
```

## Final Architect review (required)

### Scope
Architect must re-evaluate the deep research setup end-to-end, specifically:
- Stage machine invariants preserved
- Determinism boundaries respected
- M2/M3 runbooks are coherent
- New CLI ergonomics don’t introduce unsafe path resolution

### Evidence
Architect output must include:
- PASS/FAIL
- file evidence pointers
- new risks / regressions

## Final QA review (required)

### Scope
QA must run:
- `bun test ./.opencode/tests`
- `bun Tools/Precommit.ts`
- manual canary procedure(s) if applicable (gated tests may require env flags)

### Evidence
QA output must include:
- PASS/FAIL
- command outputs (or pass/fail totals)

## Capture findings
Write a new file after final review:
`91-post-integration-findings.md` containing:
- what passed
- what failed
- any follow-up work (new epics)
- links to architect/QA outputs
