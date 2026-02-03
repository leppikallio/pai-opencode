# Verification v2.5 (OpenCode parity)

Canonical path: `.opencode/Plans/Verification_v2.5.md`

This checklist verifies that we achieved v2.5 parity for the REQUIRED items.

## Pass-1 Artifacts

In any OpenCode session, verify these files exist under its work dir:

- `FORMAT_HINTS.jsonl` (assistant responses)
- `PROMPT_HINTS.jsonl` (user prompts)

Toast behavior (optional; default off):
- Enable prompt hint toasts: `PAI_ENABLE_PROMPT_HINT_TOASTS=1`
- Enable format hint toasts: `PAI_ENABLE_FORMAT_HINT_TOASTS=1`

## Pass-2 Contract

Verify `.opencode/skills/PAI/SKILL.md` includes:
- Two-pass selection
- Thinking tools justify-exclusion
- Parallel-by-default rule
- Composition patterns requirement

## Format Gate (enforcement)

- Default-on: assistant output is rewritten pre-display if format invalid.
- Disable (debug only): `PAI_ENABLE_FORMAT_GATE=0`
- Evidence file: `MEMORY/WORK/<YYYY-MM>/<sessionId>/FORMAT_GATE.jsonl`
- Force one rewrite (default-on; disable with env=0): `PAI_FORMAT_GATE_FORCE=0`
- If rewrite fails, `event:"rewrite_failed"` includes error snippet.
- If rewrite fails, `event:"rewrote_fallback"` indicates deterministic wrapper applied.

Debug gating:
- Set `PAI_DEBUG=1` to enable `FORMAT_GATE.jsonl` evidence logging.
- Without debug, the gate still enforces formatting but stays quiet.

Self-test (no interactive session needed):
- Run OpenCode with `PAI_FORMAT_GATE_SELFTEST=1`
- Check `MEMORY/STATE/format-gate-selftest.json`

## Hook parity spot-check

- Security validator still blocks dangerous commands.
- Explicit rating capture still writes to `MEMORY/LEARNING/SIGNALS/ratings.jsonl`.
- Agent capture still writes to `MEMORY/RESEARCH/<YYYY-MM>/`.
- Work completion learning still runs on session completion.

## Relationship + Soul parity checks

- Trigger: after an assistant finishes a response (idle).
- Default-on: disable only when explicitly set.
  - Disable relationship capture: `PAI_ENABLE_RELATIONSHIP_MEMORY=0`
  - Disable soul evolution capture: `PAI_ENABLE_SOUL_EVOLUTION=0`
- Relationship notes exist under `MEMORY/RELATIONSHIP/<YYYY-MM>/<YYYY-MM-DD>.md`.
- Soul evolution queue exists at `MEMORY/STATE/soul-evolution-queue.json`.

## Infinite loop safety check

- Verify `MEMORY/WORK/<YYYY-MM>/` does not rapidly fill with `[PAI INTERNAL]` workdirs.
- Verify `plugins/debug.log` does not show repeating errors for Relationship/Soul.

## Missing parity checks (currently TODO)

- Implicit sentiment capture: ensure `MEMORY/LEARNING/SIGNALS/ratings.jsonl` has `source: implicit` entries.

Implicit sentiment self-test (debug):
- Set `PAI_DEBUG=1` and `PAI_IMPLICIT_SENTIMENT_SELFTEST=1`
- Check `MEMORY/STATE/implicit-sentiment-selftest.json`

## Evidence Log (append-only)

- 2026-02-02: Format hint toast verified; `FORMAT_HINTS.jsonl` exists.
- 2026-02-02: Prompt hint toast verified; `PROMPT_HINTS.jsonl` exists.
- 2026-02-03: WU05 audit — `session.deleted` occurs once and `META.yaml` shows COMPLETED (ses_3dd60dfdfffeisB7TjaKKNaJfC).
- 2026-02-03: WU06 ISC gate — FULL validator fails on empty criteria (`MEMORY/STATE/format-gate-selftest.json`).
