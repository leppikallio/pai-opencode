# Fresh Install Test - v0.9.7

**Zweck:** Validierung dass PAI-OpenCode auf einem sauberen System funktioniert.
**User:** `opencode` (existierender Test-User) oder neuer User
**Version:** v0.9.7 (Two-Layer Migration)
**Datum:** 2026-01-22

---

## Änderungen gegenüber v0.9.5

| Feature | v0.9.5 | v0.9.7 |
|---------|--------|--------|
| Converter | Path Translation | Path + Architecture Translation |
| Validation Gate | ❌ | ✅ System file risk analysis |
| MigrationValidator | ❌ | ✅ 12+12+3 validation checks |
| Model-Provider Config | ❌ | ✅ Sen/Anthropic/OpenAI |
| Manifest | ❌ | ✅ MIGRATION-MANIFEST.json |

---

## Step 0: Clean Slate (Alles löschen)

**WICHTIG:** Als Test-User ausführen!

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

# API Key gesetzt? (falls Anthropic/OpenAI statt Sen)
echo $ANTHROPIC_API_KEY | head -c 20
# Erwartet: sk-ant-api03-... (optional - Sen ist kostenlos)
```

**Falls nicht vorhanden:**
```bash
# Bun installieren
curl -fsSL https://bun.sh/install | bash
source ~/.zshrc

# OpenCode installieren (Go muss vorhanden sein)
go install github.com/anomalyco/opencode@latest
export PATH="$PATH:$(go env GOPATH)/bin"

# API Key setzen (optional, nur für Anthropic/OpenAI)
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
# Sollte: skills/, MEMORY/, plugins/, etc. zeigen

ls -la opencode.json
# Sollte: opencode.json im Root existieren
```

---

## Step 3: Converter testen (NEU in v0.9.7)

### 3a: Converter Version prüfen

```bash
bun Tools/pai-to-opencode-converter.ts --help | head -5
```

**Erwartet:** `PAI to OpenCode Converter v0.9.7`

**Status:** [ ] PASS / [ ] FAIL

---

### 3b: Converter Dry-Run

```bash
bun Tools/pai-to-opencode-converter.ts \
  --source ~/.claude \
  --target /tmp/test-opencode \
  --dry-run
```

**Erwartet:**
- Source detection: Hooks, Skills, Custom Skills werden erkannt
- "Migration manifest would be written to..."
- "This was a DRY RUN - no files were modified."

**Status:** [ ] PASS / [ ] FAIL

---

### 3c: MigrationValidator testen

```bash
# Erst echte Konvertierung durchführen
bun Tools/pai-to-opencode-converter.ts \
  --source ~/.claude \
  --target /tmp/test-opencode \
  --skip-validation

# Dann Validator separat testen
bun Tools/MigrationValidator.ts \
  --manifest /tmp/test-opencode/MIGRATION-MANIFEST.json \
  --target /tmp/test-opencode \
  --skip-llm \
  --verbose
```

**Erwartet:**
- Phase A: 12 deterministic checks (most should pass)
- Phase C: Self-tests
- Summary mit pass/fail counts

**Status:** [ ] PASS / [ ] FAIL

---

### 3d: MIGRATION-MANIFEST.json prüfen

```bash
cat /tmp/test-opencode/MIGRATION-MANIFEST.json | head -30
```

**Erwartet:** JSON mit version, timestamp, source.detected (hooks, skills, etc.)

**Status:** [ ] PASS / [ ] FAIL

---

## Step 4: OpenCode starten

```bash
cd ~/pai-opencode
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
Use the Task tool to spawn an Intern agent to explain what TypeScript is in one sentence.
```

**Erwartet:** Task tool wird verwendet, Intern Agent antwortet.

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

## v0.9.7 Spezifische Tests

### T1: Validation Gate Library existiert

```bash
ls -la ~/pai-opencode/Tools/lib/
```

**Erwartet:**
- `validation-gate.ts`
- `migration-manifest.ts`

**Status:** [ ] PASS / [ ] FAIL

---

### T2: Model-Config Library existiert

```bash
cat ~/pai-opencode/.opencode/plugins/lib/model-config.ts | head -20
```

**Erwartet:** TypeScript mit `PaiModelConfig` interface

**Status:** [ ] PASS / [ ] FAIL

---

### T3: Hook Discovery funktioniert

```bash
cd ~/pai-opencode
bun -e "
const { discoverHooks } = await import('./Tools/pai-to-opencode-converter.ts');
// Note: discoverHooks is internal, test via converter dry-run output
console.log('Hook discovery test - check dry-run output for hook count');
"
```

**Alternative:** Check dry-run output from Step 3b zeigt "Hooks: XX"

**Status:** [ ] PASS / [ ] FAIL

---

### T4: Keine .claude Pfade im konvertierten Output

```bash
grep -r "\.claude/" /tmp/test-opencode/ 2>/dev/null | head -10
```

**Erwartet:** Keine Treffer (oder nur in Migration-Dokumentation)

**Status:** [ ] PASS / [ ] FAIL

---

### T5: plugins/ Directory statt hooks/

```bash
ls ~/pai-opencode/.opencode/plugins/
ls ~/pai-opencode/.opencode/hooks/ 2>/dev/null || echo "OK: hooks/ nicht vorhanden"
```

**Erwartet:**
- plugins/ existiert mit pai-unified.ts
- hooks/ existiert NICHT

**Status:** [ ] PASS / [ ] FAIL

---

## Ergebnis-Zusammenfassung

| Test | Status |
|------|--------|
| **Converter Tests** | |
| 3a: Converter v0.9.7 | |
| 3b: Converter Dry-Run | |
| 3c: MigrationValidator | |
| 3d: MIGRATION-MANIFEST | |
| **Quick Tests** | |
| Q1: Skills erkannt | |
| Q2: CORE Context | |
| Q3: Agent Delegation | |
| Q4: Security Blocking | |
| Q5: MEMORY Directories | |
| **v0.9.7 Tests** | |
| T1: Validation Gate Lib | |
| T2: Model-Config Lib | |
| T3: Hook Discovery | |
| T4: Keine .claude Pfade | |
| T5: plugins/ statt hooks/ | |

**Gesamtergebnis:** ___ / 14 Tests bestanden

---

## Bei Fehlern

1. **Debug Log prüfen:** `cat /tmp/pai-opencode-debug.log`
2. **Plugin Status:** Prüfen ob `plugins/pai-unified.ts` vorhanden
3. **Manifest prüfen:** `cat MIGRATION-MANIFEST.json`
4. **Validator manuell:** `bun Tools/MigrationValidator.ts --target . --skip-llm --verbose`
5. **Issue erstellen:** Mit Fehlerbeschreibung und Steps to Reproduce

---

## Nach erfolgreichen Tests

Wenn alle Tests PASS:
1. Fresh Install Test ist abgeschlossen
2. Weiter zu v1.0 Release:
   - Version auf v1.0.0 bumpen
   - README.md finalisieren
   - GitHub Release erstellen
   - Announce

---

*Erstellt für PAI-OpenCode v0.9.7 Fresh Install Validation*
*Two-Layer Migration: Converter + MigrationValidator*
