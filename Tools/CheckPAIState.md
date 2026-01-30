# Check PAI-OpenCode State

A diagnostic workflow for assessing your PAI installation health, identifying issues, and getting recommendations for improvements.

---

## What This Does

When you run this check, your DA will:

1. **Inventory installed packs** — Identify which PAI packs are currently installed in your system
2. **Verify basic functionality** — Test that core systems (hooks, history, skills) are working
3. **Detect issues** — Find packs that may be broken, misconfigured, or missing dependencies
4. **Compare to latest** — Show what's available in the Kai bundle vs what you have
5. **Recommend improvements** — Suggest tweaks, fixes, and new packs worth installing

---

## How to Use

Give this file to your DA and say:

```
Check my PAI state and give me recommendations.
```

Your DA will run through the diagnostic steps below and report back.

---

## Diagnostic Steps

### Step 1: Identify OpenCode Installation Location

Check for OpenCode configuration and PAI-OpenCode infrastructure:

```bash
# Check OpenCode config directory
ls -la ~/.config/opencode/ 2>/dev/null || echo "No ~/.config/opencode/ directory"

# Check OpenCode config files
ls -la ~/.config/opencode/opencode.json 2>/dev/null || echo "No OpenCode opencode.json"
ls -la ~/.config/opencode/settings.json 2>/dev/null || echo "No PAI settings.json"
```

**Expected:** At least one PAI directory exists with subdirectories for hooks, skills, history, etc.

---

### Step 2: Check Plugin System (Foundation)

The plugin system is the foundation—everything else depends on it.

```bash
# Check if plugins directory exists
ls -la ~/.config/opencode/plugins/ 2>/dev/null || echo "No plugins directory"

# Verify PAI unified plugin exists (if installed)
ls -la ~/.config/opencode/plugins/pai-unified.ts 2>/dev/null || echo "No pai-unified plugin"
```

**Health indicators:**
- ✅ plugins directory exists with .ts files
- ✅ pai-unified.ts is present (if using PAI-OpenCode plugin)
- ❌ Missing plugins directory = plugin system not installed

---

### Step 3: Check Memory/History System

```bash
# Check for MEMORY directory structure
PAI_DIR=${PAI_DIR:-$HOME/.config/opencode}
ls -la "$PAI_DIR/MEMORY/" 2>/dev/null || echo "No MEMORY directory"
```

**Health indicators:**
- ✅ MEMORY directory exists with proper structure
- ✅ New session files appear during use
- ❌ Empty or missing = memory capture not running

---

### Step 4: Check Skill System

```bash
# Check for skills directory
ls -la ~/.config/opencode/skills/ 2>/dev/null || echo "No skills directory"

# List installed skills
find ~/.config/opencode/skills/ -name "SKILL.md" 2>/dev/null
```

**Health indicators:**
- ✅ Skills directory exists
- ✅ Multiple SKILL.md files present
- ✅ Skills are present under ~/.config/opencode/skills/
- ❌ No SKILL.md files = No skills installed
- ❌ Skills exist but not in settings = Skills won't be discovered

---

### Step 5: Check Voice System (Optional)

```bash
# Check if voice server is running
curl -s http://localhost:8888/health 2>/dev/null || echo "Voice server not running"

# Check for voice configuration
ls -la $PAI_DIR/voice-server/ 2>/dev/null
```

**Health indicators:**
- ✅ Voice server responds on port 8888
- ✅ ElevenLabs API key configured
- ⚪ Not running = Optional, install if you want voice notifications

---

### Step 6: Check Observability Server (Optional)

```bash
# Check if observability is running
curl -s http://localhost:4000/health 2>/dev/null || echo "Observability server not running"
curl -s http://localhost:5172 2>/dev/null || echo "Observability dashboard not running"

# Check for observability installation
ls -la $PAI_DIR/observability/ 2>/dev/null
```

**Health indicators:**
- ✅ Server responds on port 4000
- ✅ Dashboard accessible on port 5172
- ⚪ Not running = Optional, install if you want agent monitoring

---

### Step 7: Check Identity Configuration (Optional)

```bash
# Check for identity/personality configuration
ls -la $PAI_DIR/skills/CORE/ 2>/dev/null
cat $PAI_DIR/skills/CORE/SKILL.md 2>/dev/null | head -50
```

**Health indicators:**
- ✅ CORE skill exists with identity configuration
- ✅ Response format defined
- ✅ Personality calibration present
- ⚪ Not configured = Using default AI personality

---

## Comparison: Your Installation vs PAI Bundle

### Available Packs in PAI Bundle

| Pack | Version | Purpose | Status |
|------|---------|---------|--------|
| pai-hook-system | 1.0.0 | Event-driven automation foundation | ⬜ Check |
| pai-history-system | 1.0.0 | Automatic context capture and organization | ⬜ Check |
| pai-skill-system | 1.0.0 | Capability routing and dynamic loading | ⬜ Check |
| pai-voice-system | 1.1.0 | Voice notifications with ElevenLabs TTS | ⬜ Check |
| pai-identity | 1.0.0 | Personality, response format, principles | ⬜ Check |
| pai-observability-server | 1.0.0 | Real-time multi-agent monitoring | ⬜ Check |

**Status key:**
- ✅ Installed and working
- ⚠️ Installed but has issues
- ❌ Not installed
- ⬜ Not yet checked

---

## Generating Recommendations

After running diagnostics, your DA should provide:

### 1. Health Summary

```
PAI Health Report
=================
Hook System:        ✅ Working
History System:     ✅ Working
Skill System:       ⚠️ 3 skills found, but routing not configured
Voice System:       ❌ Not installed
Observability:      ❌ Not installed
Identity:           ⚪ Using defaults
```

### 2. Critical Issues (Fix These First)

List any broken functionality that affects core operation:
- Missing dependencies
- Misconfigured hooks
- Broken file permissions
- Missing environment variables

### 3. Recommended Improvements

Based on what's installed and working:
- **Quick wins** — Small tweaks to improve existing functionality
- **Missing pieces** — Packs that would complement your current setup
- **Upgrades available** — Newer versions of installed packs

### 4. Suggested Next Pack

Recommend ONE pack to install next based on:
- What's already working (dependencies met)
- What would add the most value
- Ease of installation

---

## Example Output

```
PAI State Check Complete
========================

INSTALLED (4 packs):
  ✅ pai-hook-system v1.0.0 - Working
  ✅ pai-history-system v1.0.0 - Working
  ✅ pai-skill-system v1.0.0 - Working
  ⚠️ pai-voice-system v1.0.0 - Installed but ElevenLabs key missing

NOT INSTALLED (2 packs):
  ⬜ pai-identity - Would add personality and response format
  ⬜ pai-observability-server - Would add agent monitoring dashboard

ISSUES FOUND:
  1. Voice system missing ELEVENLABS_API_KEY in environment
     → Fix: Add to ~/.config/opencode/.env (or your shell env) or disable voice notifications

RECOMMENDATIONS:
  1. [Quick fix] Add ElevenLabs API key to enable voice notifications
  2. [New pack] Consider pai-identity for consistent response formatting
  3. [Optional] pai-observability-server useful if you run multiple agents

SUGGESTED NEXT: pai-identity
  - All dependencies met (hooks, history, skills installed)
  - Adds consistent personality and response format
  - Installation: Give your DA the pai-identity.md pack file
```

---

## Running the Check

To run this diagnostic:

1. Give this file to your DA
2. Set your PAI directory: `PAI_DIR=~/.pai` (or wherever you installed)
3. Say: "Check my PAI state"

Your DA will run through each step, build a health report, and provide actionable recommendations.

---

*Part of the [PAI (Personal AI Infrastructure)](https://github.com/danielmiessler/PAI) project.*
