# Post-integration findings (E1–E8)

Date: 2026-02-18
Branch: `graphviz`

## Summary

- All follow-up epics **E1–E8** are merged into `graphviz`.
- Global verification passes:
  - `bun test ./.opencode/tests` → **162 pass, 1 skip, 0 fail**
  - `bun Tools/Precommit.ts` → **PASS** (gitleaks + protected-files validator)

## Integration / merge commit map

| Epic | Branch | Merge commit on `graphviz` |
|---|---|---|
| E2 | `ws/epic-e2-cli-ergonomics` | `39b6529` |
| E5 | `ws/epic-e5-config-citations` | `1269d72` |
| E4 | `ws/epic-e4-observability` | `98395ff` |
| E3 | `ws/epic-e3-longrun-timeouts` | `18c06ac` |
| E1 | `ws/epic-e1-runagent-driver` | `f10033d` |
| E7 | `ws/epic-e7-production-skill` | `e365693` |
| E6 | `ws/epic-e6-canaries` | `1d1a544` |
| E8 | `ws/epic-e8-charter-refresh` | `49cea2b` |

Gate tracker follow-up commit:
- E2 Architect gate recorded on `graphviz`: `de55132`

## Final QA evidence

- Test run (repo root): `bun test ./.opencode/tests`
  - Result: **162 pass, 1 skip, 0 fail**
- Precommit: `bun Tools/Precommit.ts`
  - Result: **PASS** (no leaks; no protected files staged)

## Final Architect notes (acceptance)

Key invariants confirmed in integrated CLI/tooling:

- **Explicit enablement** for Option C CLI operations is enforced via `ensureOptionCEnabledForCli()`.
- **Path containment** for manifest-derived relative paths is enforced via `safeResolveManifestPath()` with `realpath()` normalization (macOS `/var` vs `/private/var` containment correctness).
- **Cancel semantics** are durable and terminal: `status=cancelled` written via `manifest_write`, plus a `cancel-checkpoint.md` artifact.

Pointers:
- `.opencode/pai-tools/deep-research-option-c.ts` (see `ensureOptionCEnabledForCli`, `safeResolveManifestPath`, `runCancel`)

## Operational notes

- A pre-integration stash still exists:
  - `stash@{0}: wip: local changes before optionc epic integration`
  - Decision needed: keep, drop, or re-apply selectively after reviewing contents.

## Follow-ups (if needed)

- Consider doing a **non-dry-run** install to runtime once you want these changes deployed:
  - `bun Tools/Install.ts --target "/Users/zuul/.config/opencode" --non-interactive`
- If you plan to publish upstream: push `graphviz` (currently ahead of `origin/graphviz`).
