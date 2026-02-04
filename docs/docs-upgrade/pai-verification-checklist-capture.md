# Verification checklist: history + work + learning capture

Scope: verify that the *capture pipeline exists on disk* and that it produces the expected artifacts.

## 1) History capture (RAW firehose)
- Confirm RAW file exists for this session:
  - `~/.config/opencode/MEMORY/RAW/2026-02/ses_3d756b0cdffeC0kA03W2v0kIk7.jsonl`
- Confirm it contains message + tool lifecycle events.

## 2) Work projection
- Confirm work dir exists:
  - `~/.config/opencode/MEMORY/WORK/2026-02/ses_3d756b0cdffeC0kA03W2v0kIk7/`
- Confirm required files exist:
  - `META.yaml` (started_at, title, session id)
  - `THREAD.md` (contains user message)
  - `ISC.json` (structured ISC state)

## 3) ISC capture behavior
- Confirm tool-state persistence: make a `todowrite` call and verify `ISC.json` updates from the tool event.
- Confirm fallback parsing: include an `ISC TRACKER` / `FINAL ISC STATE` table in assistant text and verify `ISC.json` updates from text parsing.

## 4) Learning capture
- Confirm historical evidence that learning extraction works:
  - Example existing file:
    - `~/.config/opencode/MEMORY/LEARNING/GENERAL/2026-02/2026-02-01T12-39-36_work_skills-are-how-pai-scales.md`
- Confirm ratings signals exist:
  - `~/.config/opencode/MEMORY/LEARNING/SIGNALS/ratings.jsonl`

## 5) Relationship memory
- Confirm daily relationship log exists:
  - `~/.config/opencode/MEMORY/RELATIONSHIP/2026-02/2026-02-04.md`
