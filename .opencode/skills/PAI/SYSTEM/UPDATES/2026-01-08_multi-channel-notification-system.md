# Multi-Channel Notification System

**Date:** 2026-01-08
**Type:** feature
**Impact:** major

---

## Summary

Added external notification infrastructure with ntfy.sh (mobile push), Discord webhooks, and smart event-based routing. Notifications fire asynchronously based on event type and task duration.

## What Changed

### Before

- Voice notifications only (localhost:8888)
- No mobile alerts when away from computer
- No team channel notifications

### After

```
Hook Event → Notification Service → Smart Router
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         │               │               │               │               │
         v               v               v               v               v
      Voice          Desktop          ntfy           Discord           SMS
    (localhost)      (macOS)         (push)        (webhook)       (disabled)
```

## Key Design Decisions

1. **Fire and Forget**: Notifications never block hook execution
2. **Fail Gracefully**: Missing services don't cause errors
3. **Conservative Defaults**: Avoid notification fatigue (voice only for normal tasks)
4. **Duration-Aware**: Only push for long-running tasks (>5 min threshold)

## SMS Research Findings

US carriers require A2P 10DLC registration since December 2024. Recommendation: Use ntfy.sh instead - same result (phone alert), zero carrier bureaucracy.

## Files Affected

- OpenCode port note: the Claude Code hook files listed in the original design do not exist in this runtime.
- `~/.config/opencode/VoiceServer/server.ts` - Voice notification service
- `plugins/pai-unified.ts` - Session lifecycle + rating kiosk integration
- `plugins/handlers/agent-capture.ts` - Background agent capture
- `plugins/lib/file-logger.ts` - TUI-safe debug logging
- `skills/PAI/SYSTEM/THENOTIFICATIONSYSTEM.md` - Documentation

---

**Migration Status:** Complete
