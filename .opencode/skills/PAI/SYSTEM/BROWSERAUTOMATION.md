# Browser Automation

**Status:** Active runtime guidance  
**Scope:** Visual verification, browser-driven checks, UI evidence capture

---

## Purpose

This document defines how PAI performs browser-based validation in OpenCode.

Use browser automation when work requires visual proof (layout, rendering, interaction state), not just code/tool output.

---

## Core Rules

1. **Do not claim UI success without visual evidence.**
2. **Capture at least one screenshot or explicit browser result** for each UI criterion marked complete.
3. **Treat browser output as evidence data** (record source + content in verification section).
4. **If browser automation is unavailable, report the blocker** instead of asserting success.

---

## When to Use Browser Automation

- CSS/layout/spacing changes
- UI regressions and interaction bugs
- Form-flow and navigation checks
- “Confirm this page works” requests
- Any task where user-visible output is the acceptance criterion

---

## Verification Pattern

For each UI criterion:

1. Open target page/state
2. Capture screenshot or browser result
3. Record evidence:
   - Evidence type: `screenshot` or `tool_result`
   - Evidence source: browser tool/session
   - Evidence content: what the screenshot/result proves

---

## Runtime Notes

- Prefer the browser-capable QA flow (`QATester` or browser skill/runbook) for non-trivial UI checks.
- Keep checks scoped to requested criteria; avoid unrelated exploratory testing unless asked.
- For long browser runs, provide milestone progress updates.

---

## Common Failure Modes

1. Declaring success after code change without opening the page
2. Screenshot captured from wrong route/state
3. Missing evidence linkage back to acceptance criterion
4. Passing visual checks while known console/runtime errors remain unreported

---

## Related

- `SKILL.md` (Algorithm verification/evidence contract)
- `PAIAGENTSYSTEM.md` (QATester routing)
- `THENOTIFICATIONSYSTEM.md` (optional progress voice notifications)
