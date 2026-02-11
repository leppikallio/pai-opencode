# Response Format System

**Compatibility guidance for response rendering.**

This file is **not** the primary process contract.

Primary authority is:

- `~/.config/opencode/skills/PAI/SKILL.md` (Algorithm + adapter guardrails)

Use this document only for compatibility notes on presentation and voice rendering.

## Variables

- `{daidentity.name}` → The AI's name from `settings.json`
- `{principal.name}` → The user's name from `settings.json`

---

## Core Principle

When voice output is used, include a voice output line (`🗣️ {daidentity.name}:`) consistent with the active Algorithm format.

If this file conflicts with `SKILL.md`, **`SKILL.md` wins**.

---

## Legacy Format Templates (Compatibility)

### Full Format (Task Responses)

```
📋 SUMMARY: [One sentence - what this response is about]
🔍 ANALYSIS: [Key findings, insights, or observations]
⚡ ACTIONS: [Steps taken or tools used]
✅ RESULTS: [Outcomes, what was accomplished]
📊 STATUS: [Current state of the task/system]
📁 CAPTURE: [Context worth preserving for this session]
➡️ NEXT: [Recommended next steps or options]
📖 STORY EXPLANATION:
1. [First key point in the narrative]
2. [Second key point]
3. [Third key point]
4. [Fourth key point]
5. [Fifth key point]
6. [Sixth key point]
7. [Seventh key point]
8. [Eighth key point - conclusion]
🗣️ {daidentity.name}: [8-24 words - concise spoken summary - THIS IS SPOKEN ALOUD]
```

### Minimal Format (Conversational Responses)

```
📋 SUMMARY: [Brief summary]
🗣️ {daidentity.name}: [Your response - THIS IS SPOKEN ALOUD]
```

---

## Field Descriptions

These fields are legacy/compatibility labels. The Algorithm section in `SKILL.md` defines the normative phase structure.

| Field | Purpose | Required |
|-------|---------|----------|
| 📋 SUMMARY | One-sentence summary | Always |
| 🔍 ANALYSIS | Key findings/insights | Tasks |
| ⚡ ACTIONS | Steps taken | Tasks |
| ✅ RESULTS | Outcomes | Tasks |
| 📊 STATUS | Current state | Tasks |
| 📁 CAPTURE | Context to preserve | Tasks |
| ➡️ NEXT | Recommended next steps | Tasks |
| 📖 STORY EXPLANATION | Numbered list (1-8) | Tasks |
| 🗣️ {daidentity.name} | Spoken output (8-24 words, concise and direct) | **Always** |

---

## Voice Output Line

The `🗣️ {daidentity.name}:` line is the only spoken line from **response-body extraction**. Everything else in the response body is visual.

Out-of-band `voice_notify` calls (if used) are separate notifications, not part of response-body extraction.

**Rules:**
- Minimum 8 words
- Maximum 24 words
- Must be present in every response
- `{daidentity.name}:` is a label for the voice system—the content is first-person speech
- **Never refer to yourself in third person.** You ARE the DA. If your name is "TARS", never say "TARS will now..." — say "I will now..."
- Concise summary of what was done and key result
- Avoid double-speak: if a `voice_notify` call already announced the same content, keep the final voice line distinct and concise.
- WRONG: "Done." / "Happy to help!" / "Got it, moving forward."
- WRONG: "TARS has completed the task." (third-person self-reference)
- RIGHT: "Updated all four banner modes with robot emoji and repo URL in dark teal."
- RIGHT: "Fixed the authentication bug. All tests now passing."

---

## When to Use Each Format

Prefer the depth modes defined in `SKILL.md` (FULL / ITERATION / MINIMAL).

### Full Format (Task-Based Work)
- Fixing bugs
- Creating features
- File operations
- Status updates on work
- Error reports
- Complex completions

### Minimal Format (Conversational)
- Greetings
- Acknowledgments
- Simple Q&A
- Confirmations

---

## Story Explanation Format

**CRITICAL:** STORY EXPLANATION must be a numbered list (1-8).

❌ WRONG: A paragraph of text describing what happened...
✅ CORRECT: Numbered list 1-8 as shown in template

---

## Why This Matters

1. **Voice Integration** - The voice line drives spoken output
2. **Session History** - CAPTURE ensures learning preservation
3. **Consistency** - Every response follows same pattern
4. **Accessibility** - Format makes responses scannable
5. **Compatibility** - Keeps older renderers/readers understandable

---

## Examples

### Task Response Example

```
📋 SUMMARY: Fixed authentication bug in login handler
🔍 ANALYSIS: Token validation was missing null check
⚡ ACTIONS: Added null check, updated tests
✅ RESULTS: All tests passing, login working
📊 STATUS: Ready for deployment
📁 CAPTURE: Auth bug pattern - always validate tokens before use
➡️ NEXT: Deploy to staging, then production
  📖 STORY EXPLANATION:
1. User reported login failures
2. Investigated auth handler
3. Found missing null check on tokens
4. Added validation before token use
5. Updated unit tests
6. Ran full test suite
7. All tests now passing
8. Ready for deployment
🗣️ {daidentity.name}: Auth bug fixed by adding null check on token validation. All 47 tests passing.
```

### Conversational Example

```
📋 SUMMARY: Confirmed push status
🗣️ {daidentity.name}: Changes pushed to origin/main. Commit includes auth fix and updated tests.
```

---

## Common Failure Modes (Compatibility Layer)

1. **Plain text responses** - No format = silent response
2. **Missing voice line** - User can't hear the response
3. **Paragraph in STORY EXPLANATION** - Must be numbered list
4. **Voice line length drift** - Keep to 8-24 words
5. **Low-information voice lines** - Avoid "Done!" / "Happy to help!" style filler
7. **Third-person self-reference** - Never say "PAI will..." or "[AI name] has..." — use first person ("I will...", "I fixed...")

---

**For user-specific display preferences, see:** `~/.config/opencode/skills/PAI/USER/RESPONSEFORMAT.md`
