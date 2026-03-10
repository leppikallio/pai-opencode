# Orchestration Parity v1 Reference

This document captures the V1 orchestration parity contract for `pai-opencode` and links concrete acceptance evidence.

---

## Preserved Invariants (Authoritative)

1. **No parallel sources of truth**
   - No `.sisyphus/tasks`, `.sisyphus/plans`, `boulder.json`, or rival orchestration ledger.
   - Existing authority remains PRD/ISC/current-work/background-state/learning artifacts.

2. **Native-safe `task_id` compatibility**
   - Foreground and background delegation keep `task_id` as the public continuation handle.
   - No public `session_id` continuation API replacement.

3. **Background tasks remain first-class**
   - Background launch remains supported and explicit (`run_in_background: true`).
   - Lifecycle/state behavior is hardened rather than removed.

4. **Compaction continuity is PAI-native**
   - Continuity uses bounded bundle + existing PAI work/ISC/background artifacts.
   - No hidden rewrite of PRD/ISC source-of-truth files.

5. **Wisdom projection extends existing learning capture**
   - Projection is derived from existing `MEMORY/LEARNING` + `MEMORY/STATE` inputs.
   - No new memory root is introduced.

---

## Orchestration Behavior Summary

### Foreground routing parity

- Explicit `@general` / `@agent` requests delegate through `task`.
- Foreground explicit-mention bypass semantics are retained.
- Foreground envelope still emits public `task_id` and stock-compatible metadata through the plugin seam.

### Background lifecycle + admission controls

- Background state uses normalized lifecycle semantics.
- Parent fan-in/notification handling is preserved and hardened.
- Optional concurrency grouping can throttle launches by provider/model/agent group.

### Compaction continuity

- Continuation context is bounded and derived from existing artifacts.
- Parent-turn restoration focuses on continuity state, not PRD/ISC source mutation.

### Wisdom projection

- Derived orchestration guidance is written under `MEMORY/LEARNING/wisdom-projection.md`.
- Retrieval/injection remains bounded and tied to existing context-loading pathways.

---

## Feature Flags (Rollback Posture)

| Slice | Flag |
| --- | --- |
| Foreground parity | `PAI_ORCHESTRATION_FOREGROUND_PARITY_ENABLED` |
| Concurrency gating | `PAI_ORCHESTRATION_CONCURRENCY_ENABLED` |
| Stable completion hardening | `PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED` |
| Compaction bundle | `PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED` |
| Wisdom projection | `PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED` |

Precedence: **env override > module default**.

---

## Manual Acceptance Matrix (Task 8)

Session exports are reproducible via `opencode export <session-id>`.

| Scenario | Expected | Evidence source | Result |
| --- | --- | --- | --- |
| `@general run bash echo "test"` | Main model delegates via `task`; not in-place self-execution | Session `ses_32779c810ffe76VhmKZ4cozPHZ` shows assistant `tool: task` call with `subagent_type: general` and `task_id` output | PASS |
| Foreground explicit `@agent` | Explicit mention path bypass semantics preserved | Session `ses_32712f9f0ffeUkGL6VQeeSXLSl` (`opencode run --format json "@agent reply with exactly: foreground bypass works"`) includes explicit `@agent` prompt text, shows `tool: task` with `run_in_background: false`, and detour-tool count for `"tool": "question"|"tool": "ask"` is `0` | PASS |
| Background launch | Parent remains usable; background completion retrievable | Session `ses_3277710f0ffeZZpZ8zHASPgnm9`: background `task` launch returns `bg_...`; continued parent prompt succeeds; `background_output` resolves terminal completed status | PASS |
| Multiple background tasks | Concurrency controls visible; completion path avoids spammy fan-out behavior | Session `ses_3277553eaffeGpF1rb85VDTY7x` includes four background launches with `Concurrency group: model:openai/gpt-5.2`; anti-spam/fan-in behavior validated in `pai_background_parent_fanin_queue.test.ts` | PASS |
| Force compaction during active work | Continuity survives compaction path without parallel task files | Session `ses_3276f9fc3ffe11yvWTdyfoLx74` issues `/compact` and preserves same background `task_id` continuity via `background_output`; filesystem scan `fd -HI "(.sisyphus|boulder.json)" .` emits no lines and `fd -HI "(.sisyphus|boulder.json)" . | wc -l` returns `0` | PASS |
| Learning projection visibility | Orchestration learning appears in existing learning path | `PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED=1` projection update writes `/Users/zuul/.config/opencode/MEMORY/LEARNING/wisdom-projection.md`; no alternate wisdom root found | PASS |

---

## Deterministic Verification Commands

```bash
env -u PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK bun test ./.opencode/tests/entities/pai_task_tool_native_routing_contract.test.ts ./.opencode/tests/entities/pai_task_gpt5_routing_integration.test.ts ./.opencode/tests/entities/pai_cc_hooks_prompt_control.test.ts ./.opencode/tests/entities/pai_background_task_concurrency.test.ts ./.opencode/tests/entities/pai_background_task_state_machine.test.ts ./.opencode/tests/entities/pai_background_task_stable_completion.test.ts ./.opencode/tests/entities/pai_background_parent_fanin_queue.test.ts ./.opencode/tests/entities/pai_background_metadata_survival.test.ts ./.opencode/tests/entities/pai_compaction_continuation_bundle.test.ts ./.opencode/tests/entities/pai_compaction_isc_preservation.test.ts ./.opencode/tests/entities/pai_learning_wisdom_projection.test.ts
bun run typecheck
```

Observed result for Task 8 run:
- `58 pass, 0 fail` across 11 targeted test files
- `bun run typecheck` completed successfully

### Evidence-lint command (packet completeness audit)

```bash
bun docs/reviews/2026-03-09-pai-orchestration-parity-v1/task-8/evidence-lint.ts; echo "lint_exit=$?"
```

Intent: validate review-packet file/section completeness across all stable task labels. Non-zero exit is expected until all required QA/Architect packets are present.

---

## Evidence Packet

- Engineer evidence: `docs/reviews/2026-03-09-pai-orchestration-parity-v1/task-8/engineer-evidence.md`
