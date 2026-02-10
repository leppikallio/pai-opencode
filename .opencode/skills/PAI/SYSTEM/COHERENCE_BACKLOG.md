# PAI Coherence Backlog (Out-of-Scope Findings)

Tracks coherence issues discovered during mitigation that are intentionally deferred.

---

## Open Items

| ID | Severity | Area | Finding | Suggested Follow-up |
|---|---|---|---|---|
| CB-001 | Medium | Cross-skill docs | `<skills/create-skill/Workflows/ImportSkill.md>` references `<skills/skill-index.json>`, which is runtime-generated and absent in source tree scans. | Mark reference as runtime-only/optional or adjust source-scan heuristics. |
| CB-002 | Medium | Validation tooling | `ValidateSkillSystemDocs.ts` is runtime-anchored to `~/.config/opencode` paths and produces false failures in source-tree mode. | Add explicit `--mode source` support to validator, or keep skip behavior documented. |
| CB-003 | High | System docs architecture | `BROWSERAUTOMATION.md` appears semantically duplicated/misaligned with CLI-first content sections. | Decide canonical owner doc and convert duplicate to alias/redirect doc. |
| CB-004 | Medium | Workflow quality | `GitPush.md` still contains legacy Claude-code style commit snippet metadata not aligned with current repo policy. | Perform a focused modern workflow cleanup in a dedicated pass. |
| CB-005 | Medium | Graph migration prep | No machine-readable conflict register yet (only prose). | Create JSON/YAML blockers register for Graphviz sidecar pipeline. |

---

## Completed During Current Mitigation Wave

- Added domain authority map (`DOC_AUTHORITY_MAP.md`)
- Clarified response contract authority (`SKILL.md` over response compatibility docs)
- Aligned delegation docs with runtime-safe Task assumptions (no model parameter assumption)
- Demoted mandatory/no-op `UpdateDocumentation` workflow semantics to checklist guidance
- Added coherence runner (`skills/PAI/Tools/RunCoherenceChecks.ts`) and documentation
