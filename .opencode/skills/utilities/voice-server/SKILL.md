---
name: voice-server
description: Voice server management. USE WHEN voice server, TTS server, voice notification, prosody.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/voice-server/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.


## 🚨 MANDATORY: Voice Notification (REQUIRED BEFORE ANY ACTION)

**When this skill is invoked, do BOTH before any action:**

1. **Send voice notification**:
   Use the `voice_notify` tool:
   - `message`: "Running WORKFLOWNAME workflow from voice-server skill"
   - optional: `fire_and_forget: true` for non-blocking delivery
   - optional: `timeout_ms` (e.g., 1200) to avoid UI stalls

2. **Output text notification**:
   "Running the **WorkflowName** workflow from the **voice-server** skill to ACTION..."

# voice-server Skill

**Domain**: Voice notification system using ElevenLabs TTS with prosody guidance.

**Algorithm**: `~/.config/opencode/skills/PAI/SKILL.md (Algorithm embedded in v2.4)`

---

## Phase Overrides

### OBSERVE
- **Key sources**: Operation type (status/notify/manage), message content, voice selection
- **Critical**: Voice relies on `🎯 COMPLETED:` line - without it, user won't hear response

### THINK
- **Voice selection**: Match agent to voice ID (see routing table below)
- **Prosody**: Emotional markers + markdown emphasis = natural speech
- **Anti-patterns**: Missing COMPLETED line, no prosody, wrong voice for agent

### BUILD
| Criterion | PASS | FAIL |
|-----------|------|------|
| COMPLETED | Line present with message | Missing line |
| Prosody | Emotional markers applied | Flat/robotic |
| Voice | Correct agent voice | Wrong voice |

### EXECUTE
- **Notify**: `voice_notify` (message: "...")
- **Manage**: `~/.config/opencode/VoiceServer/{start,stop,status,restart}.sh`
- **Workflow**: `Workflows/Status.md`

---

## Domain Knowledge

**Voice Routing**:
| Agent | Voice ID | Style |
|-------|----------|-------|
| assistant | `voices.assistant` | Primary assistant voice |
| engineer | `voices.engineer` | Engineering voice |
| architect | `voices.architect` | Architecture voice |
| security | `voices.security` | Security voice |

Configure voice IDs in `~/.config/opencode/VoiceServer/voices.json`.

**Prosody Quick Reference**:
- Emotional: `[💥 excited]` `[✨ success]` `[⚠️ caution]` `[🚨 urgent]`
- Emphasis: `**bold**` for key words, `...` for pause, `--` for break

**Infrastructure**: Server at `~/.config/opencode/VoiceServer/`, Port 8888, Config `voices.json`.
