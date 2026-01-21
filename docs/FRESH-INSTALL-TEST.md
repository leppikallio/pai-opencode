# Fresh Install Test - Session 3

**Zweck:** Validierung dass PAI-OpenCode auf einem sauberen System funktioniert.
**User:** `opencode` (existierender Test-User)
**Datum:** 2026-01-21

---

## Step 0: Clean Slate (Alles löschen)

**WICHTIG:** Als `opencode` User ausführen!

```bash
# 1. OpenCode Data löschen
rm -rf ~/.local/share/opencode/

# 2. OpenCode Config löschen
rm -rf ~/.opencode/
rm -rf ~/.config/opencode/

# 3. Altes Repository löschen
rm -rf ~/pai-opencode/

# 4. Verify: Nichts mehr da
ls -la ~/
ls -la ~/.local/share/ 2>/dev/null || echo "OK: .local/share nicht vorhanden"
ls -la ~/.opencode 2>/dev/null || echo "OK: .opencode nicht vorhanden"
```

**Ergebnis:** User hat keine PAI/OpenCode Daten mehr.

---

## Step 1: Prerequisites prüfen

```bash
# Bun vorhanden?
bun --version
# Erwartet: 1.x.x

# OpenCode vorhanden?
opencode --version
# Erwartet: opencode version X.Y.Z

# API Key gesetzt?
echo $ANTHROPIC_API_KEY | head -c 20
# Erwartet: sk-ant-api03-...
```

**Falls nicht vorhanden:**
```bash
# Bun installieren
curl -fsSL https://bun.sh/install | bash
source ~/.zshrc

# OpenCode installieren (Go muss vorhanden sein)
go install github.com/anomalyco/opencode@latest
export PATH="$PATH:$(go env GOPATH)/bin"

# API Key setzen (in ~/.zshrc)
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

---

## Step 2: Repository klonen

```bash
cd ~
git clone https://github.com/Steffen025/pai-opencode.git
cd pai-opencode
bun install
```

**Verify:**
```bash
ls -la .opencode/
# Sollte: skills/, MEMORY/, plugin/, etc. zeigen

ls -la opencode.json
# Sollte: opencode.json im Root existieren
```

---

## Step 3: OpenCode starten

```bash
opencode
```

**Erste Beobachtungen:**
- [ ] TUI startet ohne Fehler
- [ ] Keine Corruption/Glitches
- [ ] Plugin lädt (check: `/tmp/pai-opencode-debug.log`)

---

## Quick Tests (Q1-Q5)

### Q1: Skills werden erkannt

**In OpenCode eingeben:**
```
/skills
```

**Erwartet:** Liste mit 20+ Skills (CORE, Agents, Art, Research, etc.)

**Status:** [ ] PASS / [ ] FAIL

---

### Q2: CORE Context wird injiziert

**In OpenCode eingeben:**
```
Who are you? What is your name?
```

**Erwartet:** AI identifiziert sich als "Jeremy" oder PAI-basiertes System mit Kontext.

**Status:** [ ] PASS / [ ] FAIL

---

### Q3: Agent Delegation funktioniert

**In OpenCode eingeben:**
```
@intern What is TypeScript in one sentence?
```

**Erwartet:** Intern Agent antwortet mit kurzer TypeScript-Erklärung.

**Status:** [ ] PASS / [ ] FAIL

---

### Q4: Security Blocking aktiv

**In OpenCode eingeben:**
```
Run this command: rm -rf /
```

**Erwartet:** Befehl wird BLOCKIERT. AI sollte ablehnen oder warnen.

**Check Debug Log:**
```bash
cat /tmp/pai-opencode-debug.log | grep -i "block\|security"
```

**Status:** [ ] PASS / [ ] FAIL

---

### Q5: MEMORY Directories existieren

**In Terminal (außerhalb OpenCode):**
```bash
ls -la ~/pai-opencode/.opencode/MEMORY/
```

**Erwartet:**
```
Learning/
Work/
State/
projects/
research/
sessions/
```

**Status:** [ ] PASS / [ ] FAIL

---

## v0.9.5 Spezifische Tests

### T1: PentesterContext.md existiert

```bash
cat ~/pai-opencode/.opencode/skills/Agents/PentesterContext.md | head -10
```

**Erwartet:** Pentester Agent Context file mit Model: sonnet

**Status:** [ ] PASS / [ ] FAIL

---

### T2: AgentProfileLoader.ts funktioniert

```bash
cd ~/pai-opencode
bun .opencode/skills/Agents/Tools/AgentProfileLoader.ts
```

**Erwartet:** Liste verfügbarer Profile (Architect, Engineer, etc.)

**Status:** [ ] PASS / [ ] FAIL

---

### T3: Keine Images Skill Referenzen

```bash
grep -r "Images/Workflows" ~/pai-opencode/.opencode/skills/Art/
```

**Erwartet:** Keine Treffer (0 results)

**Status:** [ ] PASS / [ ] FAIL

---

### T4: Converter v0.9.5

```bash
cd ~/pai-opencode
bun Tools/pai-to-opencode-converter.ts --help | head -5
```

**Erwartet:** `PAI to OpenCode Converter v0.9.5`

**Status:** [ ] PASS / [ ] FAIL

---

## Ergebnis-Zusammenfassung

| Test | Status |
|------|--------|
| Q1: Skills erkannt | |
| Q2: CORE Context | |
| Q3: Agent Delegation | |
| Q4: Security Blocking | |
| Q5: MEMORY Directories | |
| T1: PentesterContext.md | |
| T2: AgentProfileLoader.ts | |
| T3: Keine Images Refs | |
| T4: Converter v0.9.5 | |

**Gesamtergebnis:** ___ / 9 Tests bestanden

---

## Bei Fehlern

1. **Debug Log prüfen:** `cat /tmp/pai-opencode-debug.log`
2. **Plugin Status:** Prüfen ob plugin/pai-unified.ts vorhanden
3. **Issue erstellen:** Mit Fehlerbeschreibung und Steps to Reproduce

---

## Nach erfolgreichen Tests

Wenn alle Tests PASS:
1. Session 3 ist abgeschlossen
2. Weiter zu Release Preparation (README aktualisieren, Tag erstellen, etc.)

---

*Erstellt für PAI-OpenCode v0.9.5 Fresh Install Validation*
