# Fresh Install Test - v1.0.0

**Zweck:** Validierung dass PAI-OpenCode auf einem sauberen System funktioniert.
**User:** `opencode` (existierender Test-User) oder neuer User
**Version:** v1.0.0 (Session 9 Update - Normalization Discovery)
**Datum:** 2026-01-23

---

## CRITICAL WARNING: OpenCode Normalization Behavior

> **BLOCKER DISCOVERED IN SESSION 9**
>
> OpenCode modifiziert Dateien beim Start/Laden:
> 1. `opencode.json` wird überschrieben - `plugins` Array wird ENTFERNT
> 2. `SKILL.md` Dateien werden "normalisiert" - PAI-Features werden ENTFERNT
>
> **Impact:** Ohne `plugins` ist PAI "tot". Ohne PAI-Features in SKILL.md fehlen Voice Notifications und Customization Hooks.
>
> **Diese Tests verifizieren das Verhalten systematisch.**

---

## Quick Copy-Paste (Gesamter Test-Block)

```bash
# ============================================
# PAI-OPENCODE FRESH INSTALL TEST v1.0.0
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

# STEP 3: BASELINE (CRITICAL - VOR opencode Start!)
echo "=== BASELINE VOR OPENCODE START ===" > ~/test-results.txt
date >> ~/test-results.txt
git status >> ~/test-results.txt
echo "--- opencode.json plugins check ---" >> ~/test-results.txt
grep -A2 "plugins" opencode.json >> ~/test-results.txt || echo "NO PLUGINS FOUND" >> ~/test-results.txt
echo "--- SKILL.md checksums ---" >> ~/test-results.txt
find .opencode/skills -name "SKILL.md" -exec md5 {} \; | sort >> ~/test-results.txt

# STEP 4: SYMLINK
ln -sfn ~/pai-opencode/.opencode ~/.opencode
ls -la ~/.opencode

echo ""
echo "============================================"
echo "BASELINE COMPLETE - Results in ~/test-results.txt"
echo "NOW: Start opencode, then IMMEDIATELY Ctrl+C"
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

# Check 1: Git Status
echo "--- git status ---" >> ~/test-results.txt
git status >> ~/test-results.txt

# Check 2: opencode.json plugins
echo "--- opencode.json plugins check ---" >> ~/test-results.txt
grep -A2 "plugins" opencode.json >> ~/test-results.txt || echo "PLUGINS REMOVED!" >> ~/test-results.txt

# Check 3: SKILL.md checksums (compare to baseline)
echo "--- SKILL.md checksums AFTER ---" >> ~/test-results.txt
find .opencode/skills -name "SKILL.md" -exec md5 {} \; | sort >> ~/test-results.txt

# Check 4: What changed?
echo "--- git diff --stat ---" >> ~/test-results.txt
git diff --stat >> ~/test-results.txt

# Show results
cat ~/test-results.txt
```

---

## Detaillierte Test-Schritte

### Step 0: Clean Slate (Alles löschen)

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

### Step 1: Prerequisites prüfen

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

### Step 2: Repository klonen

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

# CRITICAL: plugins muss vorhanden sein!
cat opencode.json | grep plugins
# Sollte: "plugins": [".opencode/plugins/pai-unified.ts"]
```

---

### Step 3: BASELINE erstellen (CRITICAL!)

**VOR dem ersten OpenCode-Start Baseline erstellen!**

```bash
cd ~/pai-opencode

# 3a: Git Status (sollte clean sein)
git status
# Erwartet: "nothing to commit, working tree clean"

# 3b: opencode.json plugins vorhanden?
cat opencode.json | grep -A2 plugins
# Erwartet: "plugins": [".opencode/plugins/pai-unified.ts"]

# 3c: SKILL.md Checksums erstellen
find .opencode/skills -name "SKILL.md" -exec md5 {} \; | sort > ~/baseline-checksums.txt
wc -l ~/baseline-checksums.txt
# Notieren: ___ SKILL.md Dateien

# 3d: Kopie von opencode.json
cp opencode.json ~/baseline-opencode.json
```

**Baseline dokumentieren:**
- [ ] Repository ist clean nach Clone
- [ ] `plugins` Array ist in opencode.json vorhanden
- [ ] Anzahl SKILL.md Dateien: ___

---

### Step 4: Symlink setzen

```bash
ln -sfn ~/pai-opencode/.opencode ~/.opencode
ls -la ~/.opencode
# Sollte zeigen: ~/.opencode -> /Users/xxx/pai-opencode/.opencode
```

---

### Step 5: OpenCode starten (OHNE Interaktion)

```bash
cd ~/pai-opencode
opencode
# Warte bis UI geladen
# SOFORT Ctrl+C (keine Befehle eingeben!)
```

---

### Step 6: Normalization Check (CRITICAL!)

**Sofort nach Step 5 ausführen:**

```bash
cd ~/pai-opencode

# 6a: Git Status prüfen
git status
# FRAGE: Gibt es geänderte Dateien?

# 6b: opencode.json prüfen
diff ~/baseline-opencode.json opencode.json
# FRAGE: Wurde plugins entfernt?

# 6c: SKILL.md Checksums vergleichen
find .opencode/skills -name "SKILL.md" -exec md5 {} \; | sort > ~/after-start-checksums.txt
diff ~/baseline-checksums.txt ~/after-start-checksums.txt
# FRAGE: Wurden SKILL.md Dateien geändert?

# 6d: Was genau wurde geändert?
git diff --stat
git diff opencode.json
```

**Ergebnisse dokumentieren:**

| Check | Ergebnis |
|-------|----------|
| opencode.json geändert? | [ ] Ja / [ ] Nein |
| plugins entfernt? | [ ] Ja / [ ] Nein |
| SKILL.md geändert? | [ ] Ja / [ ] Nein |
| Anzahl geänderter Skills | ___ |

---

### Step 7: Skill-Aufruf Test

```bash
# Repository zurücksetzen
cd ~/pai-opencode
git restore .

# OpenCode starten
opencode

# IN OPENCODE eingeben:
# "Use the CreateCLI skill to show me help"
# Warte auf Antwort, dann Ctrl+C

# Nach Beenden:
git status
git diff --stat
```

**Dokumentieren:**
- [ ] Wurde CreateCLI/SKILL.md geändert?
- [ ] Wurden andere Skills geändert?
- [ ] Welche PAI-Features wurden entfernt?

---

### Step 8: Wiederholter Start Test

```bash
# NICHT zurücksetzen - normalisierte Dateien behalten

# OpenCode erneut starten
opencode

# Gleichen Skill aufrufen
# "Use the CreateCLI skill to show me help"
# Ctrl+C

# Prüfen
git status
git diff --stat
```

**Dokumentieren:**
- [ ] Weitere Änderungen nach zweitem Start?
- [ ] Normalisierung ist: [ ] Einmalig / [ ] Wiederholend

---

### Step 9: git restore Workaround Test

```bash
# Repository zurücksetzen
cd ~/pai-opencode
git restore .

# OpenCode starten, Skill aufrufen, beenden
opencode
# (Skill aufrufen, Ctrl+C)

# git restore ausführen
git restore .

# OpenCode erneut starten
opencode

# Prüfen ob PAI-Features funktionieren
# Wenn Voice Notification konfiguriert:
# Eingabe: "Say hello"
# Sollte Voice Notification auslösen

# Status nach zweitem Start mit restore
git status
```

**Dokumentieren:**
- [ ] Werden Dateien nach restore erneut geändert?
- [ ] Funktionieren PAI-Features nach restore?
- [ ] Ist `git restore` ein praktikabler Workaround?

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

## Normalization-Spezifische Tests (N1-N4)

### N1: opencode.json plugins Persistenz

```bash
cd ~/pai-opencode
git restore opencode.json
cat opencode.json | grep plugins
# Erwartet: plugins Array vorhanden

opencode
# Ctrl+C nach Start

cat opencode.json | grep plugins
# FRAGE: Ist plugins noch da?
```

**Status:** [ ] Bleibt / [ ] Wird entfernt

---

### N2: SKILL.md Voice Notification Check

```bash
# Vor Start
grep -r "Voice Notification" .opencode/skills/*/SKILL.md | wc -l
# Notieren: ___ Skills mit Voice Notification

# Nach Start (ohne restore)
grep -r "Voice Notification" .opencode/skills/*/SKILL.md | wc -l
# FRAGE: Gleiche Anzahl?
```

**Status:** [ ] Erhalten / [ ] Entfernt

---

### N3: SKILL.md Customization Hook Check

```bash
# Vor Start
grep -r "Customization" .opencode/skills/*/SKILL.md | wc -l
# Notieren: ___ Skills mit Customization

# Nach Start (ohne restore)
grep -r "Customization" .opencode/skills/*/SKILL.md | wc -l
# FRAGE: Gleiche Anzahl?
```

**Status:** [ ] Erhalten / [ ] Entfernt

---

### N4: Skill Name Normalization Check

```bash
# Vor Start
grep "^name:" .opencode/skills/CreateCLI/SKILL.md
# Erwartet: name: CreateCLI

# Nach Start (ohne restore)
grep "^name:" .opencode/skills/CreateCLI/SKILL.md
# FRAGE: Wurde zu "system-createcli" umbenannt?
```

**Status:** [ ] Original / [ ] Umbenannt

---

## Ergebnis-Zusammenfassung

| Test | Status |
|------|--------|
| **Baseline Tests** | |
| Repository clean nach Clone | |
| plugins in opencode.json | |
| **Normalization Tests** | |
| N1: plugins Persistenz | |
| N2: Voice Notification erhalten | |
| N3: Customization erhalten | |
| N4: Skill Names original | |
| **Quick Tests** | |
| Q1: Skills erkannt | |
| Q2: CORE Context | |
| Q3: Agent Delegation | |
| Q4: Security Blocking | |
| Q5: MEMORY Directories | |
| **Workaround Tests** | |
| git restore funktioniert | |
| PAI-Features nach restore | |

**Gesamtergebnis:** ___ / 13 Tests bestanden

---

## Kritische Fragen zu beantworten

Nach Abschluss aller Tests:

1. **Normalisiert OpenCode bei JEDEM Start oder nur einmalig?**
   - [ ] Einmalig
   - [ ] Bei jedem Start
   - [ ] Nur bei Skill-Zugriff

2. **Werden alle Skills oder nur geladene normalisiert?**
   - [ ] Alle Skills
   - [ ] Nur geladene/aufgerufene
   - [ ] Unklar

3. **Funktioniert `git restore` als Workaround?**
   - [ ] Ja, vollständig
   - [ ] Teilweise
   - [ ] Nein

4. **Können wir mit diesem Verhalten leben?**
   - [ ] Ja, mit Workaround
   - [ ] Nein, brauchen Fix
   - [ ] Projekt stoppen

---

## Bei Fehlern

1. **Debug Log prüfen:** `cat /tmp/pai-opencode-debug.log`
2. **Plugin Status:** Prüfen ob `plugins/pai-unified.ts` vorhanden
3. **Git Diff:** `git diff` zeigt exakte Änderungen
4. **Baseline vergleichen:** `diff ~/baseline-*.txt` vs aktuelle Werte
5. **Issue erstellen:** Mit Fehlerbeschreibung und Test-Ergebnissen

---

## Nach erfolgreichen Tests

Wenn alle Tests PASS und Workaround funktioniert:
1. Workaround dokumentieren (git restore nach jedem Start?)
2. Hook/Script für automatischen restore erwägen
3. Weiter zu v1.0 Release

Wenn Tests FAIL:
1. Ergebnisse in Jeremy Repo dokumentieren
2. Fork anpassen oder Issue bei anomalyco/opencode erstellen
3. Migration pausieren bis gelöst

---

*Erstellt für PAI-OpenCode v1.0.0 Fresh Install Validation*
*Session 9 Update: OpenCode Normalization Discovery*
