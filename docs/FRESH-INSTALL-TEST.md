# Fresh Install Test - v1.0.1

**Zweck:** Validierung dass PAI-OpenCode auf einem sauberen System funktioniert.
**User:** `opencode` (existierender Test-User) oder neuer User
**Version:** v1.0.1 (Session 10 - Auto-Discovery Fix)
**Datum:** 2026-01-23

---

## Key Learnings (Session 9-10)

| Issue | Root Cause | Fix |
|-------|------------|-----|
| `Unrecognized key: "plugins"` | Config key was `plugins` (plural) | Use `plugin` (singular) or remove entirely |
| `BunInstallFailedError` | Relative path in config | Remove config - use auto-discovery |
| "OpenCode modifies files" | FALSE ALARM - caused by config errors | Config is now clean |

**Reality:** OpenCode does NOT modify SKILL.md files. Plugins are auto-discovered from `.opencode/plugins/`.

---

## Quick Copy-Paste (Gesamter Test-Block)

```bash
# ============================================
# PAI-OPENCODE FRESH INSTALL TEST v1.0.1
# Auf separatem User-Account ausführen!
# ============================================

# STEP 0: CLEAN SLATE
rm -rf ~/.local/share/opencode/
rm -rf ~/.opencode/
rm -rf ~/.config/opencode/
rm -rf ~/pai-opencode/
echo "Clean slate complete"

# STEP 1: PREREQUISITES
bun --version || echo "FAIL: Bun not installed"
opencode --version || echo "FAIL: OpenCode not installed"

# STEP 2: FRESH CLONE
cd ~
git clone https://github.com/Steffen025/pai-opencode.git
cd pai-opencode
bun install

# STEP 3: VERIFY PLUGIN EXISTS (Auto-Discovery)
echo "=== PLUGIN CHECK ===" > ~/test-results.txt
ls -la .opencode/plugins/pai-unified.ts >> ~/test-results.txt
echo "Plugin file exists: OK" >> ~/test-results.txt

# STEP 4: BASELINE
echo "" >> ~/test-results.txt
echo "=== BASELINE VOR OPENCODE START ===" >> ~/test-results.txt
date >> ~/test-results.txt
git status >> ~/test-results.txt

# STEP 5: SYMLINK
ln -sfn ~/pai-opencode/.opencode ~/.opencode
ls -la ~/.opencode >> ~/test-results.txt

echo ""
echo "============================================"
echo "BASELINE COMPLETE - Results in ~/test-results.txt"
echo "NOW: Start opencode, run a command, then Ctrl+C"
echo "THEN: Run the verification commands below"
echo "============================================"
```

---

## Nach OpenCode Start (Verification Commands)

```bash
# Nach dem Start von opencode (und Ctrl+C zum Beenden):
cd ~/pai-opencode

echo "" >> ~/test-results.txt
echo "=== NACH OPENCODE START ===" >> ~/test-results.txt
date >> ~/test-results.txt

# Check 1: Git Status (should be clean!)
echo "--- git status ---" >> ~/test-results.txt
git status >> ~/test-results.txt

# Check 2: Plugin loaded? (check debug log)
echo "--- Plugin Debug Log ---" >> ~/test-results.txt
cat /tmp/pai-opencode-debug.log 2>/dev/null | head -20 >> ~/test-results.txt || echo "No debug log found" >> ~/test-results.txt

# Check 3: Any file changes?
echo "--- git diff --stat ---" >> ~/test-results.txt
git diff --stat >> ~/test-results.txt

# Show results
cat ~/test-results.txt
```

---

## Detaillierte Test-Schritte

### Step 0: Clean Slate

```bash
rm -rf ~/.local/share/opencode/
rm -rf ~/.opencode/
rm -rf ~/.config/opencode/
rm -rf ~/pai-opencode/
```

### Step 1: Prerequisites

```bash
bun --version    # Erwartet: 1.x.x
opencode --version   # Erwartet: opencode version X.Y.Z
```

### Step 2: Clone & Install

```bash
cd ~
git clone https://github.com/Steffen025/pai-opencode.git
cd pai-opencode
bun install
```

### Step 3: Verify Plugin File

```bash
ls -la .opencode/plugins/pai-unified.ts
# Erwartet: File exists (~7KB)
```

**Important:** No `plugin` entry needed in `opencode.json` - OpenCode auto-discovers from `.opencode/plugins/`.

### Step 4: Set Symlink

```bash
ln -sfn ~/pai-opencode/.opencode ~/.opencode
ls -la ~/.opencode
# Erwartet: Symlink zu ~/pai-opencode/.opencode
```

### Step 5: Start OpenCode

```bash
cd ~/pai-opencode
opencode
```

**In OpenCode testen:**
1. "Who are you?" → Sollte PAI/Jeremy Context zeigen
2. "Run: echo hello" → Test command execution
3. Ctrl+C zum Beenden

### Step 6: Verify No File Changes

```bash
git status
# Erwartet: "nothing to commit, working tree clean"

git diff --stat
# Erwartet: Keine Ausgabe (keine Änderungen)
```

---

## Quick Tests (Q1-Q5)

### Q1: Plugin Loaded

```bash
cat /tmp/pai-opencode-debug.log | grep -i "loaded\|context"
```

**Erwartet:** Log entries showing plugin/context loaded

**Status:** [ ] PASS / [ ] FAIL

---

### Q2: CORE Context Injected

**In OpenCode eingeben:**
```
Who are you? What is your name?
```

**Erwartet:** AI identifiziert sich als "Jeremy" oder zeigt PAI-Context.

**Status:** [ ] PASS / [ ] FAIL

---

### Q3: Security Blocking

**In OpenCode eingeben:**
```
Run this command: rm -rf /
```

**Erwartet:** Befehl wird BLOCKIERT.

**Status:** [ ] PASS / [ ] FAIL

---

### Q4: No File Modifications

```bash
git status && git diff --stat
```

**Erwartet:** Repository ist unverändert.

**Status:** [ ] PASS / [ ] FAIL

---

### Q5: Skills Available

**In OpenCode eingeben:**
```
/skills
```

**Erwartet:** Liste mit 20+ Skills

**Status:** [ ] PASS / [ ] FAIL

---

## Ergebnis-Zusammenfassung

| Test | Status |
|------|--------|
| Plugin file exists | |
| OpenCode starts without error | |
| Q1: Plugin loaded | |
| Q2: CORE Context | |
| Q3: Security Blocking | |
| Q4: No file modifications | |
| Q5: Skills available | |

**Gesamtergebnis:** ___ / 7 Tests bestanden

---

## Troubleshooting

### "Unrecognized key: plugins"

**Fix:** Remove `plugins` from `opencode.json` - auto-discovery is correct.

### "BunInstallFailedError"

**Fix:** Remove any relative paths from `plugin` in `opencode.json`.

### Plugin not loading

**Check:**
1. File exists: `ls .opencode/plugins/pai-unified.ts`
2. Bun can parse: `bun run .opencode/plugins/pai-unified.ts`
3. Debug log: `cat /tmp/pai-opencode-debug.log`

### Context not showing

**Check:**
1. CORE skill exists: `ls .opencode/skills/CORE/SKILL.md`
2. Debug log for errors

---

## Nach erfolgreichen Tests

Wenn alle Tests PASS:
1. Fresh Install funktioniert
2. Auto-Discovery lädt Plugin korrekt
3. OpenCode modifiziert keine Dateien
4. PAI-OpenCode ist production-ready

---

*Erstellt für PAI-OpenCode v1.0.1 Fresh Install Validation*
*Session 10: Auto-Discovery Fix - Config errors resolved*
