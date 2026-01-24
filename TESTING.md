# PAI-OpenCode Installation Testing

**TEMPORARY FILE - Remove before v1.0 release**

---

## Test Environment

- **Test User:** `opencode`
- **Test Date:** 2026-01-25
- **Testing:** Two-stage installation (Wizard + Onboarding)

---

## Quick Commands

```bash
# Switch to test user
su - opencode

# Clean slate
rm -rf ~/pai-opencode ~/opencode.json

# Fresh clone
git clone https://github.com/Steffen025/pai-opencode.git ~/pai-opencode
cd ~/pai-opencode
```

---

## Stage 1: Installation Wizard Test

### Run Wizard

```bash
cd ~/pai-opencode
bun run .opencode/PAIOpenCodeWizard.ts
```

### Expected Flow

| Step | Prompt | Example Input |
|------|--------|---------------|
| 1 | Choose AI Provider | `1` (Anthropic) or `3` (ZEN free) |
| 2 | What is your name? | `TestUser` |
| 3 | Timezone | Press Enter (auto-detect) |
| 4 | Name your AI assistant | `PAI` |
| 5 | Startup catchphrase | Press Enter (default) |
| 6 | ElevenLabs API key | Press Enter (skip) |

### Verify Wizard Output

```bash
# 1. Check opencode.json exists at project root
cat ~/pai-opencode/opencode.json

# Expected:
# {
#   "model": "anthropic/claude-sonnet-4-5",
#   "pai": {
#     "model_provider": "anthropic"
#   }
# }

# 2. Check settings.json
cat ~/pai-opencode/.opencode/settings.json | head -30

# Expected: principal.name, daidentity.name populated

# 3. Check DAIDENTITY.md was created
cat ~/pai-opencode/.opencode/skills/CORE/USER/DAIDENTITY.md

# 4. Check BASICINFO.md was created
cat ~/pai-opencode/.opencode/skills/CORE/USER/BASICINFO.md
```

### Wizard Success Criteria

- [ ] Wizard runs without errors
- [ ] Provider selection works (all 4 options)
- [ ] `opencode.json` created with `pai.model_provider`
- [ ] `settings.json` created with user info
- [ ] `DAIDENTITY.md` created with AI name
- [ ] `BASICINFO.md` created with user name
- [ ] Permissions set correctly (no permission errors)

---

## Stage 2: Onboarding Workflow Test

### Start OpenCode

```bash
cd ~/pai-opencode
opencode
```

### Trigger Onboarding

Paste this prompt:

```
Let's do the onboarding. Guide me through setting up my personal context -
my name, my goals, my values, and how I want you to behave. Create the TELOS
and identity files that make this AI mine.
```

### Expected Questions

The AI should ask about:
1. Your name (confirmation)
2. Timezone/location
3. AI personality traits
4. Your mission/purpose
5. Current focus areas
6. Goals for this year
7. Challenges you face
8. Values that guide you
9. Anti-goals (what to avoid)
10. Primary programming language
11. Work context

### Verify Onboarding Output

```bash
# Check TELOS files were created/updated
ls -la ~/pai-opencode/.opencode/skills/CORE/USER/TELOS/

# Check main TELOS file
cat ~/pai-opencode/.opencode/skills/CORE/USER/TELOS/TELOS.md
```

### Onboarding Success Criteria

- [ ] Onboarding triggered by prompt
- [ ] AI asks questions interactively
- [ ] TELOS.md populated with user answers
- [ ] DAIDENTITY.md updated if needed
- [ ] AI confirms completion with summary

---

## Full Test Script (Copy-Paste)

```bash
#!/bin/bash
# PAI-OpenCode Full Installation Test
# Run as: su - opencode -c "bash /path/to/this/script.sh"

set -e

echo "=== PAI-OpenCode Installation Test ==="
echo ""

# Clean
echo "[1/4] Cleaning old installation..."
rm -rf ~/pai-opencode ~/opencode.json 2>/dev/null || true

# Clone
echo "[2/4] Cloning fresh repo..."
git clone https://github.com/Steffen025/pai-opencode.git ~/pai-opencode
cd ~/pai-opencode

# Run Wizard (interactive)
echo "[3/4] Running Installation Wizard..."
echo "      Follow the prompts..."
echo ""
bun run .opencode/PAIOpenCodeWizard.ts

# Verify
echo ""
echo "[4/4] Verifying installation..."
echo ""

if [ -f "opencode.json" ]; then
    echo "✓ opencode.json exists"
    grep -q "model_provider" opencode.json && echo "✓ model_provider configured"
else
    echo "✗ opencode.json missing!"
fi

if [ -f ".opencode/settings.json" ]; then
    echo "✓ settings.json exists"
else
    echo "✗ settings.json missing!"
fi

if [ -f ".opencode/skills/CORE/USER/DAIDENTITY.md" ]; then
    echo "✓ DAIDENTITY.md exists"
else
    echo "✗ DAIDENTITY.md missing!"
fi

echo ""
echo "=== Wizard Test Complete ==="
echo ""
echo "Next: Run 'opencode' and paste the onboarding prompt"
```

---

## Troubleshooting

### "bun: command not found"

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc  # or ~/.zshrc
```

### Permission errors

```bash
sudo chown -R $(whoami) ~/pai-opencode
chmod -R 755 ~/pai-opencode
```

### "opencode.json not found" in OpenCode

The wizard creates `opencode.json` at project root (`~/pai-opencode/opencode.json`).
Make sure you run `opencode` from inside `~/pai-opencode/`.

### Provider model errors

If you see `ProviderModelNotFoundError`, check:
1. `opencode.json` has correct `pai.model_provider`
2. API key is set for paid providers (ANTHROPIC_API_KEY, OPENAI_API_KEY)

---

## Test Results Log

| Date | Tester | Wizard | Onboarding | Notes |
|------|--------|--------|------------|-------|
| 2026-01-25 | | | | |

---

**DELETE THIS FILE BEFORE v1.0 RELEASE**
