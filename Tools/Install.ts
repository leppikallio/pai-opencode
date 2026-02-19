#!/usr/bin/env bun
/**
 * Install.ts - Install/upgrade PAI-OpenCode into OpenCode global config dir.
 *
 * Source tree (this repo):
 *   <repo>/.opencode/
 *
 * Runtime tree (installed):
 *   ~/.config/opencode/
 *
 * Design goals:
 * - Keep repo shareable (no private USER/MEMORY content required)
 * - Keep runtime upgradeable (overwrite SYSTEM, preserve USER/MEMORY)
 * - Make OpenCode work from all working directories
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

type Mode = "sync";

type SkillsGateProfile = "off" | "advisory" | "block-critical" | "block-high";

type SkillSelectionSource = "interactive" | "config" | "default-all" | "cli";

type SkillSelectionConfig = {
  version: number;
  updatedAt: string;
  mandatorySkills: string[];
  selectedSkills: string[];
  source: SkillSelectionSource;
};

type SkillSelectionPlan = {
  availableSkills: string[];
  mandatorySkills: string[];
  selectedSkills: string[];
  source: SkillSelectionSource;
  configPath: string;
};

type SkillsSecurityScanCacheEntry = {
  contentHash: string;
  passedProfile: SkillsGateProfile;
  scannerFingerprint: string;
  allowlistFingerprint: string;
  scannedAt: string;
};

type SkillsSecurityScanCache = {
  version: number;
  updatedAt: string;
  entries: Record<string, SkillsSecurityScanCacheEntry>;
};

const SKILLS_SELECTION_CONFIG_REL_PATH = path.join("config", "skills-selection.json");
const SKILLS_SECURITY_SCAN_CACHE_REL_PATH = path.join("config", "skills-security-scan-cache.json");

// Force-selected/non-removable core skills.
const MANDATORY_SKILLS: string[] = [
  "PAI",
  "system",
  "agents",
  "research",
  "red-team",
  "council",
  "first-principles",
];

// Auto-include canonical skills when compatibility aliases are selected.
const SKILL_DEPENDENCIES: Record<string, string[]> = {
  "deep-research-option-c": ["deep-research"],
  "deep-research-production": ["deep-research"],
};

type Options = {
  targetDir: string;
  sourceDir: string;
  dryRun: boolean;
  migrateFromRepo: boolean;
  applyProfile: boolean;
  prune: boolean;
  installDeps: boolean;
  verify: boolean;
  skillsGateProfile: SkillsGateProfile;
  skillsGateScannerRoot: string;
  skillsGateScanAll: boolean;
  nonInteractive: boolean;
  skillsArg: string | null;
};

function verifyCrossReferences(args: { targetDir: string; dryRun: boolean; enabled: boolean }) {
  if (!args.enabled) {
    console.log("[write] verify: skipped (--no-verify)");
    return;
  }

  const toolPath = path.join(args.targetDir, "skills", "System", "Tools", "ScanBrokenRefs.ts");
  if (!isFile(toolPath)) {
    console.log(`[write] verify: skipped (missing ${toolPath})`);
    return;
  }

  const scope = path.join(args.targetDir, "skills");
  if (args.dryRun) {
    console.log(`[dry] verify: would run ScanBrokenRefs on ${scope}`);
    return;
  }

  try {
    const out = execSync(
      `bun "${toolPath}" --root "${args.targetDir}" --scope "${scope}" --format json --limit 50000 --allow-standalone`,
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "inherit"],
        env: { ...process.env, PAI_DIR: args.targetDir, PAI_INTEGRITYCHECK: "1" },
      }
    );

    const parsed = JSON.parse(out) as { count?: number };
    const count = typeof parsed.count === "number" ? parsed.count : NaN;
    if (Number.isFinite(count) && count === 0) {
      console.log("[write] verify: ScanBrokenRefs (ok)");
      return;
    }

    console.log("[write] verify: ScanBrokenRefs found missing refs");
    execSync(
      `PAI_INTEGRITYCHECK=1 bun "${toolPath}" --root "${args.targetDir}" --scope "${scope}" --limit 200 --verbose`,
      {
        stdio: "inherit",
        env: { ...process.env, PAI_DIR: args.targetDir, PAI_INTEGRITYCHECK: "1" },
      }
    );
    throw new Error(`verify failed: ScanBrokenRefs count=${String(parsed.count)}`);
  } catch (err) {
    throw new Error(
      `Post-install verification failed (ScanBrokenRefs). ` +
        `Fix missing references before continuing.\n${String(err)}`
    );
  }
}

function verifySkillSystemDocs(args: { targetDir: string; dryRun: boolean; enabled: boolean }) {
  if (!args.enabled) {
    console.log("[write] verify: skipped (--no-verify)");
    return;
  }

  const toolPath = path.join(args.targetDir, "skills", "system", "Tools", "ValidateSkillSystemDocs.ts");
  if (!isFile(toolPath)) {
    console.log(`[write] verify: skipped (missing ${toolPath})`);
    return;
  }

  if (args.dryRun) {
    console.log("[dry] verify: would run ValidateSkillSystemDocs");
    return;
  }

  try {
    execSync(`bun "${toolPath}"`, {
      stdio: "inherit",
      env: { ...process.env, PAI_DIR: args.targetDir },
    });
    console.log("[write] verify: ValidateSkillSystemDocs (ok)");
  } catch (err) {
    throw new Error(`Post-install verification failed (ValidateSkillSystemDocs).\n${String(err)}`);
  }
}

function listSkillDirectories(skillsRoot: string): string[] {
  if (!isDir(skillsRoot)) return [];

  const out: string[] = [];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hasSkillMd = entries.some((e) => e.isFile() && e.name === "SKILL.md");
    if (hasSkillMd) {
      out.push(path.relative(skillsRoot, dir).replace(/\\/g, "/"));
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "__pycache__" || e.name === ".git") continue;
      walk(path.join(dir, e.name));
    }
  };

  walk(skillsRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

function listTopLevelSkills(skillsRoot: string): string[] {
  if (!isDir(skillsRoot)) return [];
  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  const out: string[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
    const skillMd = path.join(skillsRoot, e.name, "SKILL.md");
    if (isFile(skillMd)) out.push(e.name);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function normalizeSelectedSkills(args: { rawSkills: string[]; availableSkills: string[] }): string[] {
  const byLower = new Map(args.availableSkills.map((s) => [s.toLowerCase(), s]));
  const out: string[] = [];

  for (const raw of args.rawSkills) {
    const resolved = byLower.get(raw.toLowerCase());
    if (!resolved) {
      console.log(`[warn] skill selection: unknown skill ignored: ${raw}`);
      continue;
    }
    if (!out.includes(resolved)) out.push(resolved);
  }

  return out;
}

function applySelectedSkillDependencies(args: { selectedSkills: string[]; availableSkills: string[] }): string[] {
  const byLower = new Map(args.availableSkills.map((s) => [s.toLowerCase(), s]));
  const out = [...args.selectedSkills];
  const selectedLower = new Set(out.map((s) => s.toLowerCase()));

  for (const [requiredByRaw, dependencySkillsRaw] of Object.entries(SKILL_DEPENDENCIES)) {
    const requiredBy = byLower.get(requiredByRaw.toLowerCase());
    if (!requiredBy || !selectedLower.has(requiredBy.toLowerCase())) continue;

    for (const dependencyRaw of dependencySkillsRaw) {
      const dependency = byLower.get(dependencyRaw.toLowerCase());
      if (!dependency) {
        console.log(`[warn] skill dependency missing in source: ${dependencyRaw} (required by ${requiredBy})`);
        continue;
      }

      if (selectedLower.has(dependency.toLowerCase())) continue;
      out.push(dependency);
      selectedLower.add(dependency.toLowerCase());
      console.log(`[write] skill dependency: auto-selected ${dependency} (required by ${requiredBy})`);
    }
  }

  return out;
}

function resolveMandatorySkills(availableSkills: string[]): string[] {
  const byLower = new Map(availableSkills.map((s) => [s.toLowerCase(), s]));
  const resolved: string[] = [];

  for (const mandatory of MANDATORY_SKILLS) {
    const skill = byLower.get(mandatory.toLowerCase());
    if (skill) {
      resolved.push(skill);
      continue;
    }
    console.log(`[warn] mandatory skill missing in source and cannot be selected: ${mandatory}`);
  }

  return resolved;
}

function loadSkillSelectionConfig(configPath: string): SkillSelectionConfig | null {
  const raw = readFileSafe(configPath);
  if (!raw.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SkillSelectionConfig>;
    const selected = Array.isArray(parsed.selectedSkills)
      ? parsed.selectedSkills.filter((v): v is string => typeof v === "string")
      : [];
    const mandatory = Array.isArray(parsed.mandatorySkills)
      ? parsed.mandatorySkills.filter((v): v is string => typeof v === "string")
      : [];
    const source =
      parsed.source === "interactive" ||
      parsed.source === "config" ||
      parsed.source === "default-all" ||
      parsed.source === "cli"
        ? parsed.source
        : "config";

    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      mandatorySkills: mandatory,
      selectedSkills: selected,
      source,
    };
  } catch {
    console.log(`[warn] skill selection: invalid JSON in ${configPath}; ignoring saved selection`);
    return null;
  }
}

async function promptSkillSelectionMenu(args: {
  availableSkills: string[];
  initialSelected: string[];
  mandatorySkills: string[];
}): Promise<string[]> {
  const mandatory = new Set(args.mandatorySkills);
  const initial = new Set(args.initialSelected);
  for (const m of mandatory) initial.add(m);

  const { default: prompts } = await import("prompts");
  const response = await prompts(
    {
      type: "multiselect",
      name: "selected",
      message: "Select skills to install (↑/↓, space, enter)",
      instructions: true,
      choices: args.availableSkills.map((skill) => ({
        title: mandatory.has(skill) ? `${skill} (locked)` : skill,
        value: skill,
        selected: initial.has(skill),
        disabled: mandatory.has(skill),
      })),
      min: args.mandatorySkills.length,
      hint: "- Space to toggle. Return to submit",
    },
    {
      onCancel: () => {
        throw new Error("Install cancelled: skill selection aborted by user");
      },
    }
  );

  const selectedFromPrompt = Array.isArray(response.selected)
    ? response.selected.filter((v): v is string => typeof v === "string")
    : [];
  const out = args.availableSkills.filter((s) => selectedFromPrompt.includes(s) || mandatory.has(s));
  for (const m of args.mandatorySkills) {
    if (!out.includes(m)) out.push(m);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function resolveSkillSelectionPlan(args: {
  sourceDir: string;
  targetDir: string;
  dryRun: boolean;
  nonInteractive: boolean;
  skillsArg: string | null;
}): Promise<SkillSelectionPlan> {
  const skillsRoot = path.join(args.sourceDir, "skills");
  const availableSkills = listTopLevelSkills(skillsRoot);
  if (availableSkills.length === 0) {
    throw new Error(`No top-level skills found in source: ${skillsRoot}`);
  }

  const mandatorySkills = resolveMandatorySkills(availableSkills);
  const configPath = path.join(args.targetDir, SKILLS_SELECTION_CONFIG_REL_PATH);
  const saved = loadSkillSelectionConfig(configPath);

  let source: SkillSelectionSource = "default-all";
  let selectedSkills: string[];

  if (args.skillsArg?.trim()) {
    const trimmed = args.skillsArg.trim();
    if (trimmed.toLowerCase() === "all") {
      selectedSkills = [...availableSkills];
    } else {
      selectedSkills = normalizeSelectedSkills({
        rawSkills: trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        availableSkills,
      });
      if (selectedSkills.length === 0) {
        throw new Error("--skills was provided but none of the values matched available skills");
      }
    }
    source = "cli";
  } else if (saved && saved.selectedSkills.length > 0) {
    selectedSkills = normalizeSelectedSkills({ rawSkills: saved.selectedSkills, availableSkills });
    source = "config";
  } else {
    selectedSkills = [...availableSkills];
    source = "default-all";
  }

  for (const mandatory of mandatorySkills) {
    if (!selectedSkills.includes(mandatory)) selectedSkills.push(mandatory);
  }
  selectedSkills = applySelectedSkillDependencies({ selectedSkills, availableSkills });

  const canPrompt = !args.nonInteractive && process.stdin.isTTY && process.stdout.isTTY;
  if (canPrompt) {
    selectedSkills = await promptSkillSelectionMenu({
      availableSkills,
      initialSelected: selectedSkills,
      mandatorySkills,
    });
    source = "interactive";
  } else if (!args.nonInteractive) {
    console.log("[warn] skill selection UI unavailable (non-TTY); using saved/default selection");
  }

  selectedSkills = normalizeSelectedSkills({ rawSkills: selectedSkills, availableSkills });
  for (const mandatory of mandatorySkills) {
    if (!selectedSkills.includes(mandatory)) selectedSkills.push(mandatory);
  }
  selectedSkills = applySelectedSkillDependencies({ selectedSkills, availableSkills });
  selectedSkills.sort((a, b) => a.localeCompare(b));

  console.log(
    `[write] skills selection: ${selectedSkills.length}/${availableSkills.length} selected (source: ${source})`
  );

  return {
    availableSkills,
    mandatorySkills,
    selectedSkills,
    source,
    configPath,
  };
}

function persistSkillSelection(args: { plan: SkillSelectionPlan; dryRun: boolean }) {
  const payload: SkillSelectionConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mandatorySkills: [...args.plan.mandatorySkills].sort((a, b) => a.localeCompare(b)),
    selectedSkills: [...args.plan.selectedSkills].sort((a, b) => a.localeCompare(b)),
    source: args.plan.source,
  };

  const prefix = args.dryRun ? "[dry]" : "[write]";
  console.log(`${prefix} skills selection config: ${args.plan.configPath}`);
  writeFileSafe(args.plan.configPath, `${JSON.stringify(payload, null, 2)}\n`, args.dryRun);
}

function shouldIgnoreSkillFile(args: { skillRel: string; relInSkillPosix: string }): boolean {
  // Runtime install preserves personal content and runtime state under skills/PAI/{USER,WORK}.
  // Those diffs should not trigger changed-skill detection for the security gate.
  const skillRoot = args.skillRel.split("/")[0];
  if (skillRoot === "PAI") {
    return args.relInSkillPosix.startsWith("USER/") || args.relInSkillPosix.startsWith("WORK/");
  }
  return false;
}

function fileSha256(p: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function isSkillDirChanged(args: { sourceDir: string; targetDir: string; skillRel: string }): boolean {
  if (!isDir(args.targetDir)) return true;

  // Compare only files present in source; ignore dest-only unmanaged files.
  const stack: string[] = [args.sourceDir];
  while (stack.length) {
    const base = stack.pop();
    if (!base) break;
    const entries = fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

    for (const e of entries) {
      if (e.name === "__pycache__" || e.name === ".git" || e.name === ".DS_Store" || e.name === "node_modules") {
        continue;
      }

      const full = path.join(base, e.name);
      const relInSkillPosix = path.relative(args.sourceDir, full).replace(/\\/g, "/");
      if (shouldIgnoreSkillFile({ skillRel: args.skillRel, relInSkillPosix })) continue;

      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (e.isSymbolicLink()) {
        const dest = path.join(args.targetDir, relInSkillPosix);
        if (!fs.existsSync(dest)) return true;
        try {
          const srcLink = fs.readlinkSync(full);
          const destLink = fs.readlinkSync(dest);
          if (srcLink !== destLink) return true;
        } catch {
          return true;
        }
        continue;
      }

      if (!e.isFile()) continue;

      const dest = path.join(args.targetDir, relInSkillPosix);
      if (!isFile(dest)) return true;

      // Fast path: size mismatch.
      try {
        if (fs.statSync(full).size !== fs.statSync(dest).size) return true;
      } catch {
        return true;
      }
      if (fileSha256(full) !== fileSha256(dest)) return true;
    }
  }

  return false;
}

function detectChangedSkills(sourceSkillsDir: string, targetSkillsDir: string): string[] {
  const sourceSkillDirs = listSkillDirectories(sourceSkillsDir);
  const changed: string[] = [];

  for (const rel of sourceSkillDirs) {
    const sourceDir = path.join(sourceSkillsDir, rel);
    const targetDir = path.join(targetSkillsDir, rel);

    if (!isDir(targetDir)) {
      changed.push(rel);
      continue;
    }

    if (isSkillDirChanged({ sourceDir, targetDir, skillRel: rel })) {
      changed.push(rel);
    }
  }

  return changed;
}

function profileRank(profile: SkillsGateProfile): number {
  switch (profile) {
    case "off":
      return 0;
    case "advisory":
      return 1;
    case "block-critical":
      return 2;
    case "block-high":
      return 3;
    default:
      return 0;
  }
}

function computeSkillDirectoryHash(skillDir: string): string {
  const hash = crypto.createHash("sha256");
  const stack: string[] = [skillDir];

  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name === "__pycache__" || e.name === ".git" || e.name === ".DS_Store" || e.name === "node_modules") {
        continue;
      }

      const full = path.join(current, e.name);
      const rel = path.relative(skillDir, full).replace(/\\/g, "/");

      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (e.isSymbolicLink()) {
        let target = "";
        try {
          target = fs.readlinkSync(full);
        } catch {
          target = "<broken-link>";
        }
        hash.update(`L:${rel}:${target}\n`);
        continue;
      }

      if (!e.isFile()) continue;
      hash.update(`F:${rel}:`);
      hash.update(fs.readFileSync(full));
      hash.update("\n");
    }
  }

  return hash.digest("hex");
}

function scannerGitHead(scannerRoot: string): string {
  try {
    const out = execSync(`git -C "${scannerRoot}" rev-parse HEAD`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return "unknown";
  }
}

function computeScannerFingerprint(args: { toolPath: string; scannerRoot: string }): string {
  const hash = crypto.createHash("sha256");
  hash.update(`tool:${fileSha256(args.toolPath)}\n`);
  hash.update(`scanner-git:${scannerGitHead(args.scannerRoot)}\n`);
  return hash.digest("hex");
}

function computeAllowlistFingerprint(args: { sourceDir: string; targetDir: string }): string {
  const files = [
    path.join(args.sourceDir, "skills", "skill-security-vetting", "Data", "allowlist.json"),
    path.join(
      args.targetDir,
      "skills",
      "PAI",
      "USER",
      "SKILLCUSTOMIZATIONS",
      "skill-security-vetting",
      "allowlist.json"
    ),
  ];

  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(`${file}:`);
    if (!isFile(file)) {
      hash.update("<missing>\n");
      continue;
    }
    hash.update(fileSha256(file));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function loadSkillsSecurityScanCache(cachePath: string): SkillsSecurityScanCache {
  const raw = readFileSafe(cachePath);
  if (!raw.trim()) {
    return { version: 1, updatedAt: "", entries: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SkillsSecurityScanCache>;
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const normalized: Record<string, SkillsSecurityScanCacheEntry> = {};

    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Partial<SkillsSecurityScanCacheEntry>;
      const profile =
        item.passedProfile === "advisory" ||
        item.passedProfile === "block-critical" ||
        item.passedProfile === "block-high"
          ? item.passedProfile
          : "advisory";
      if (typeof item.contentHash !== "string") continue;
      normalized[key] = {
        contentHash: item.contentHash,
        passedProfile: profile,
        scannerFingerprint: typeof item.scannerFingerprint === "string" ? item.scannerFingerprint : "",
        allowlistFingerprint: typeof item.allowlistFingerprint === "string" ? item.allowlistFingerprint : "",
        scannedAt: typeof item.scannedAt === "string" ? item.scannedAt : "",
      };
    }

    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      entries: normalized,
    };
  } catch {
    console.log(`[warn] skills gate cache: invalid JSON in ${cachePath}; resetting cache`);
    return { version: 1, updatedAt: "", entries: {} };
  }
}

function persistSkillsSecurityScanCache(args: {
  cachePath: string;
  cache: SkillsSecurityScanCache;
  dryRun: boolean;
}) {
  const payload: SkillsSecurityScanCache = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: args.cache.entries,
  };
  const prefix = args.dryRun ? "[dry]" : "[write]";
  console.log(`${prefix} skills gate cache: ${args.cachePath}`);
  writeFileSafe(args.cachePath, `${JSON.stringify(payload, null, 2)}\n`, args.dryRun);
}

function normalizeSelectedSkillDirs(args: { sourceSkillsDir: string; selectedTopLevelSkills: string[] }): string[] {
  const selectedTopLevel = new Set(args.selectedTopLevelSkills.map((s) => s.toLowerCase()));
  return listSkillDirectories(args.sourceSkillsDir)
    .filter((rel) => selectedTopLevel.has(rel.split("/")[0].toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function maybeRunSkillsSecurityGate(args: {
  sourceDir: string;
  targetDir: string;
  dryRun: boolean;
  profile: SkillsGateProfile;
  scannerRoot: string;
  scanAll: boolean;
  selectedTopLevelSkills: string[];
}) {
  if (args.profile === "off") {
    console.log("[write] skills gate: skipped (--skills-gate-profile off)");
    return;
  }

  const toolPath = path.join(
    args.sourceDir,
    "skills",
    "skill-security-vetting",
    "Tools",
    "RunSecurityScan.py"
  );
  const sourceSkillsDir = path.join(args.sourceDir, "skills");
  const targetSkillsDir = path.join(args.targetDir, "skills");
  const cachePath = path.join(args.targetDir, SKILLS_SECURITY_SCAN_CACHE_REL_PATH);

  if (!isFile(toolPath)) {
    const msg = `skills gate tool missing: ${toolPath}`;
    if (args.profile === "advisory") {
      console.log(`[warn] ${msg} (continuing in advisory mode)`);
      return;
    }
    throw new Error(msg);
  }

  if (!isDir(sourceSkillsDir)) {
    const msg = `skills directory missing: ${sourceSkillsDir}`;
    if (args.profile === "advisory") {
      console.log(`[warn] ${msg} (continuing in advisory mode)`);
      return;
    }
    throw new Error(msg);
  }

  if (!isDir(args.scannerRoot)) {
    const msg = `skill-scanner root missing: ${args.scannerRoot}`;
    if (args.profile === "advisory") {
      console.log(`[warn] ${msg} (continuing in advisory mode)`);
      return;
    }
    throw new Error(msg);
  }

  const selectedSkillDirs = normalizeSelectedSkillDirs({
    sourceSkillsDir,
    selectedTopLevelSkills: args.selectedTopLevelSkills,
  });
  if (selectedSkillDirs.length === 0) {
    console.log("[write] skills gate: skipped (no selected skills)");
    return;
  }

  const firstInstall = !isDir(targetSkillsDir);
  let candidateSkillDirs: string[];
  if (args.scanAll || firstInstall) {
    candidateSkillDirs = [...selectedSkillDirs];
  } else {
    const changed = new Set(detectChangedSkills(sourceSkillsDir, targetSkillsDir));
    candidateSkillDirs = selectedSkillDirs.filter((rel) => changed.has(rel));
  }

  if (!args.scanAll && candidateSkillDirs.length === 0) {
    console.log("[write] skills gate: skipped (no changed selected skills)");
    return;
  }

  const scannerFingerprint = computeScannerFingerprint({ toolPath, scannerRoot: args.scannerRoot });
  const allowlistFingerprint = computeAllowlistFingerprint({ sourceDir: args.sourceDir, targetDir: args.targetDir });
  const cache = loadSkillsSecurityScanCache(cachePath);

  const skillHashes = new Map<string, string>();
  const cacheSkipped: string[] = [];
  const toScan: string[] = [];
  for (const rel of candidateSkillDirs) {
    const sourceSkillDir = path.join(sourceSkillsDir, rel);
    const contentHash = computeSkillDirectoryHash(sourceSkillDir);
    skillHashes.set(rel, contentHash);

    if (!args.scanAll) {
      const cached = cache.entries[rel];
      const cacheHit =
        cached &&
        cached.contentHash === contentHash &&
        cached.scannerFingerprint === scannerFingerprint &&
        cached.allowlistFingerprint === allowlistFingerprint &&
        profileRank(cached.passedProfile) >= profileRank(args.profile);
      if (cacheHit) {
        cacheSkipped.push(rel);
        continue;
      }
    }

    toScan.push(rel);
  }

  if (args.dryRun) {
    console.log(
      `[dry] skills gate: would run uv scan profile=${args.profile} selected=${selectedSkillDirs.length} candidates=${candidateSkillDirs.length} scan=${toScan.length} cache-skip=${cacheSkipped.length} (scanner root: ${args.scannerRoot})`
    );
    if (toScan.length > 0) {
      console.log(`[dry] skills gate: scan list => ${toScan.join(", ")}`);
    }
    if (cacheSkipped.length > 0) {
      console.log(`[dry] skills gate: cache-skip => ${cacheSkipped.join(", ")}`);
    }
    return;
  }

  if (toScan.length === 0) {
    console.log(
      `[write] skills gate: skipped (all ${candidateSkillDirs.length} candidate skills passed cache checks)`
    );
    return;
  }

  let listFilePath: string | null = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pai-skills-gate-"));
  listFilePath = path.join(tmpDir, "scan-skills.txt");
  const rows = toScan.map((rel) => path.join(sourceSkillsDir, rel));
  fs.writeFileSync(listFilePath, `${rows.join("\n")}\n`, "utf8");

  const cmd = `uv run python "${toolPath}" --mode list --skill-list-file "${listFilePath}" --gate-profile ${args.profile}`;

  console.log(
    `[write] skills gate: running profile=${args.profile} mode=list scan=${toScan.length} cache-skip=${cacheSkipped.length}`
  );
  try {
    execSync(cmd, {
      cwd: args.scannerRoot,
      stdio: "inherit",
      env: { ...process.env, PAI_DIR: args.targetDir },
    });

    for (const rel of toScan) {
      const contentHash = skillHashes.get(rel) || computeSkillDirectoryHash(path.join(sourceSkillsDir, rel));
      cache.entries[rel] = {
        contentHash,
        passedProfile: args.profile,
        scannerFingerprint,
        allowlistFingerprint,
        scannedAt: new Date().toISOString(),
      };
    }
    persistSkillsSecurityScanCache({ cachePath, cache, dryRun: false });

    console.log(`[write] skills gate: ${args.profile} (ok)`);
  } catch (err) {
    if (args.profile === "advisory") {
      console.log(`[warn] skills gate advisory run failed (continuing): ${String(err)}`);
      return;
    }
    throw new Error(`skills gate failed with profile=${args.profile}.\n${String(err)}`);
  } finally {
    if (listFilePath) {
      try {
        fs.rmSync(path.dirname(listFilePath), { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function maybeGenerateSkillIndex(args: { targetDir: string; dryRun: boolean }) {
  const toolPath = path.join(args.targetDir, "skills", "PAI", "Tools", "GenerateSkillIndex.ts");
  if (!isFile(toolPath)) {
    console.log("[write] skill index: skipped (missing skills/PAI/Tools/GenerateSkillIndex.ts)");
    return;
  }

  if (args.dryRun) {
    console.log("[dry] skill index: would generate skills/skill-index.json");
    return;
  }

  try {
    console.log("[write] skill index: generating skills/skill-index.json");
    execSync(`bun run "${toolPath}"`, {
      stdio: "inherit",
      env: { ...process.env, PAI_DIR: args.targetDir },
    });
  } catch {
    // Best-effort: do not fail install on index generation.
    console.log("[write] skill index: failed (continuing)");
  }
}

const AGENTS_BLOCK_BEGIN = "<!-- PAI-OPENCODE:BEGIN -->";
const AGENTS_BLOCK_END = "<!-- PAI-OPENCODE:END -->";

function xdgConfigHome(): string {
  const v = process.env.XDG_CONFIG_HOME;
  if (v?.trim()) return v.trim();
  return path.join(os.homedir(), ".config");
}

function defaultTargetDir(): string {
  return path.join(xdgConfigHome(), "opencode");
}

function repoRootFromThisFile(): string {
  // Tools/Install.ts -> <repo>/Tools -> <repo>
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(path.join(here, ".."));
}

function defaultSourceDir(): string {
  return path.join(repoRootFromThisFile(), ".opencode");
}

function usage(opts: Partial<Options> = {}) {
  const target = opts.targetDir || defaultTargetDir();
  const source = opts.sourceDir || defaultSourceDir();
  console.log("Usage: bun Tools/Install.ts [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --target <dir>         Install/upgrade into this dir (default: ${target})`);
  console.log(`  --source <dir>         Source .opencode dir (default: ${source})`);
  console.log("  --migrate-from-repo    Seed runtime USER/MEMORY from source tree");
  console.log("  --apply-profile        Rewrite agent model frontmatter (disabled by default)");
  console.log("  --prune                Delete unmanaged files from target (safe)");
  console.log("  --no-verify             Skip post-install verification");
  console.log("  --skills-gate-profile <off|advisory|block-critical|block-high>");
  console.log("                         Run pre-install skill security gate (default: advisory)");
  console.log("  --skills-gate-scanner-root <dir>");
  console.log("                         skill-scanner repo root (default: /Users/zuul/Projects/skill-scanner)");
  console.log("  --skills-gate-scan-all  Force gate scan over all skills (default: changed skills only)");
  console.log("  --scan-all-skills       Alias for --skills-gate-scan-all");
  console.log("  --skills <csv|all>      Preselect skills by top-level name (e.g., PAI,system)");
  console.log("  --non-interactive       Skip interactive skill selector (use saved/default selection)");
  console.log("  --no-install-deps      Skip bun install dependency step");
  console.log("  --dry-run              Print actions without writing");
  console.log("  -h, --help             Show help");
}

function parseArgs(argv: string[]): Options | null {
  let targetDir = defaultTargetDir();
  let sourceDir = defaultSourceDir();
  let dryRun = false;
  let migrateFromRepo = false;
  let applyProfile = false;
  let prune = false;
  let installDeps = true;
  let verify = true;
  let skillsGateProfile: SkillsGateProfile = "advisory";
  let skillsGateScannerRoot = "/Users/zuul/Projects/skill-scanner";
  let skillsGateScanAll = false;
  let nonInteractive = false;
  let skillsArg: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return null;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--migrate-from-repo") {
      migrateFromRepo = true;
      continue;
    }
    if (arg === "--apply-profile") {
      applyProfile = true;
      continue;
    }
    if (arg === "--prune") {
      prune = true;
      continue;
    }
    if (arg === "--no-install-deps") {
      installDeps = false;
      continue;
    }
    if (arg === "--no-verify") {
      verify = false;
      continue;
    }
    if (arg === "--skills-gate-profile") {
      const v = argv[i + 1] as SkillsGateProfile | undefined;
      if (!v) throw new Error("Missing value for --skills-gate-profile");
      if (v !== "off" && v !== "advisory" && v !== "block-critical" && v !== "block-high") {
        throw new Error(`Invalid --skills-gate-profile value: ${v}`);
      }
      skillsGateProfile = v;
      i++;
      continue;
    }
    if (arg === "--skills-gate-scanner-root") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --skills-gate-scanner-root");
      skillsGateScannerRoot = path.resolve(v);
      i++;
      continue;
    }
    if (arg === "--skills-gate-scan-all") {
      skillsGateScanAll = true;
      continue;
    }
    if (arg === "--scan-all-skills") {
      skillsGateScanAll = true;
      continue;
    }
    if (arg === "--skills") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --skills");
      skillsArg = v;
      i++;
      continue;
    }
    if (arg === "--non-interactive") {
      nonInteractive = true;
      continue;
    }
    if (arg === "--target") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --target");
      targetDir = path.resolve(v);
      i++;
      continue;
    }
    if (arg === "--source") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --source");
      sourceDir = path.resolve(v);
      i++;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    targetDir,
    sourceDir,
    dryRun,
    migrateFromRepo,
    applyProfile,
    prune,
    installDeps,
    verify,
    skillsGateProfile,
    skillsGateScannerRoot,
    skillsGateScanAll,
    nonInteractive,
    skillsArg,
  };
}

function hasNodeModule(pkgDir: string, name: string): boolean {
  return isDir(path.join(pkgDir, "node_modules", name));
}

function msPlaywrightCacheDir(): string {
  // Default Playwright browser cache location.
  // https://playwright.dev/docs/browsers#managing-browser-binaries
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

function hasChromiumHeadlessShell(cacheDir: string): boolean {
  try {
    if (!isDir(cacheDir)) return false;
    const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    return entries.some((e) => e.isDirectory() && e.name.startsWith("chromium_headless_shell-"));
  } catch {
    return false;
  }
}

function ensurePlaywrightBrowsers(args: { targetDir: string; browserPkgDir: string; dryRun: boolean }) {
  // The browser skill uses Playwright's chromium headless shell. Ensure it's installed.
  const cacheDir = msPlaywrightCacheDir();
  if (hasChromiumHeadlessShell(cacheDir)) {
    console.log("[write] deps: Playwright browsers (ok)");
    return;
  }

  if (args.dryRun) {
    console.log(`[dry] deps: would run bunx playwright install chromium (cache: ${cacheDir})`);
    return;
  }

  console.log("[write] deps: installing Playwright browsers (chromium)");
  execSync("bunx playwright install chromium", {
    cwd: args.browserPkgDir,
    stdio: "inherit",
    env: { ...process.env, PAI_DIR: args.targetDir },
  });
}

function maybeInstallDependencies(args: { targetDir: string; dryRun: boolean; enabled: boolean }) {
  if (!args.enabled) {
    console.log("[write] deps: skipped (--no-install-deps)");
    return;
  }

  const packages: Array<{ rel: string; label: string; requireModule?: string }> = [
    { rel: ".", label: "root" },
    { rel: "skills/browser", label: "browser", requireModule: "playwright" },
    { rel: "skills/apify", label: "apify", requireModule: "apify-client" },
    { rel: "skills/Agents/Tools", label: "Agents tools", requireModule: "yaml" },
  ];

  for (const pkg of packages) {
    const pkgDir = path.join(args.targetDir, pkg.rel);
    const pkgJson = path.join(pkgDir, "package.json");
    if (!isFile(pkgJson)) continue;

    const alreadyHasNodeModules = isDir(path.join(pkgDir, "node_modules"));
    const alreadyHasRequired = pkg.requireModule ? hasNodeModule(pkgDir, pkg.requireModule) : false;
    if (alreadyHasNodeModules && (!pkg.requireModule || alreadyHasRequired)) {
      console.log(`[write] deps: ${pkg.label} (ok)`);
      if (pkg.rel === "skills/Browser") {
        ensurePlaywrightBrowsers({ targetDir: args.targetDir, browserPkgDir: pkgDir, dryRun: args.dryRun });
      }
      continue;
    }

    if (args.dryRun) {
      console.log(`[dry] deps: would run bun install (${pkg.label}) in ${pkgDir}`);
      continue;
    }

    console.log(`[write] deps: bun install (${pkg.label})`);
    execSync("bun install", {
      cwd: pkgDir,
      stdio: "inherit",
      env: { ...process.env, PAI_DIR: args.targetDir },
    });

    if (pkg.rel === "skills/browser") {
      ensurePlaywrightBrowsers({ targetDir: args.targetDir, browserPkgDir: pkgDir, dryRun: args.dryRun });
    }
  }
}

function isDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function removeLegacyOpenCodeTools(args: { targetDir: string; dryRun: boolean }) {
  // OpenCode loads custom tools from <opencodeDir>/tools. We must not ship
  // PAI helper scripts there. Clean up the legacy file if present.
  const legacyPath = path.join(args.targetDir, "tools", "ApplyProfile.ts");
  if (!isFile(legacyPath)) return;

  const content = readFileSafe(legacyPath);
  const looksLikeLegacy =
    content.includes("ApplyProfile.ts - Apply a model profile") &&
    content.includes("runtime-friendly version");

  if (!looksLikeLegacy) return;

  const prefix = args.dryRun ? "[dry]" : "[write]";
  console.log(`${prefix} remove legacy file tools/ApplyProfile.ts`);
  if (!args.dryRun) {
    try {
      fs.unlinkSync(legacyPath);
    } catch {
      // best-effort
    }
  }
}

function removeLegacyStatusLineDocs(args: { targetDir: string; dryRun: boolean }) {
  // Status line is not supported in OpenCode. Remove legacy docs/config artifacts.
  const legacyUserDirs = [
    path.join(args.targetDir, "skills", "PAI", "USER", "STATUSLINE"),
    path.join(args.targetDir, "skills", "CORE", "USER", "STATUSLINE"),
  ];
  const legacyScript = path.join(args.targetDir, "statusline-command.sh");
  const userReadmes = [
    path.join(args.targetDir, "skills", "PAI", "USER", "README.md"),
    path.join(args.targetDir, "skills", "CORE", "USER", "README.md"),
  ];

  for (const legacyUserDir of legacyUserDirs) {
    if (!isDir(legacyUserDir)) continue;
    const prefix = args.dryRun ? "[dry]" : "[write]";
    console.log(`${prefix} remove legacy dir ${legacyUserDir}`);
    removePath(legacyUserDir, args.dryRun);
  }

  if (isFile(legacyScript)) {
    const prefix = args.dryRun ? "[dry]" : "[write]";
    console.log(`${prefix} remove legacy file statusline-command.sh`);
    removePath(legacyScript, args.dryRun);
  }

  // Remove legacy mentions from preserved USER README (best-effort, narrow match).
  for (const userReadme of userReadmes) {
    const readmeRaw = readFileSafe(userReadme);
    if (!readmeRaw.includes("STATUSLINE/")) continue;
    const lines = readmeRaw.split(/\r?\n/);
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("STATUSLINE/")) {
        // Also drop the next line if it's the indented README entry.
        const next = lines[i + 1] || "";
        if (next.includes("README.md") && (next.toLowerCase().includes("status") || next.includes("guide"))) {
          i++;
        }
        continue;
      }
      out.push(line);
    }

    const updated = out.join("\n");
    if (updated !== readmeRaw) {
      const prefix = args.dryRun ? "[dry]" : "[write]";
      console.log(`${prefix} remove legacy STATUSLINE mention from ${userReadme}`);
      writeFileSafe(userReadme, updated, args.dryRun);
    }
  }
}

function migrateLegacyCoreSkills(args: { targetDir: string; dryRun: boolean }) {
  const coreDir = path.join(args.targetDir, "skills", "CORE");
  const paiDir = path.join(args.targetDir, "skills", "PAI");
  if (!isDir(coreDir)) return;

  let coreIsSymlink = false;
  try {
    coreIsSymlink = fs.lstatSync(coreDir).isSymbolicLink();
  } catch {
    coreIsSymlink = false;
  }
  if (coreIsSymlink) return;

  const prefix = args.dryRun ? "[dry]" : "[write]";

  if (!isDir(paiDir)) {
    console.log(`${prefix} migrate compatibility skills/CORE -> skills/PAI`);
    if (args.dryRun) return;
    try {
      fs.renameSync(coreDir, paiDir);
      return;
    } catch {
      copyDirRecursive(coreDir, paiDir, {
        dryRun: false,
        overwrite: false,
        preserveIfExistsPrefixes: [""],
        relBase: "skills/PAI/",
      });
      removePath(coreDir, false);
      return;
    }
  }

  const subdirs = ["USER", "WORK"];
  for (const name of subdirs) {
    const from = path.join(coreDir, name);
    const to = path.join(paiDir, name);
    if (!isDir(from) || isDir(to)) continue;
    console.log(`${prefix} migrate compatibility skills/CORE/${name} -> skills/PAI/${name}`);
    if (args.dryRun) continue;
    try {
      fs.renameSync(from, to);
    } catch {
      copyDirRecursive(from, to, {
        dryRun: false,
        overwrite: false,
        preserveIfExistsPrefixes: [""],
        relBase: `skills/PAI/${name}/`,
      });
      removePath(from, false);
    }
  }
}

function detectProfileName(args: { targetDir: string }): string | null {
  // Prefer explicit provider.id in settings.json (PAI runtime config)
  const settingsPath = path.join(args.targetDir, "settings.json");
  const settingsRaw = readFileSafe(settingsPath);
  if (settingsRaw.trim()) {
    try {
      const settings = JSON.parse(settingsRaw);
      const providerId = settings?.provider?.id;
      if (typeof providerId === "string" && providerId.trim()) return providerId.trim();
    } catch {
      // ignore
    }
  }

  // Fallback: infer from OpenCode model string
  const opencodePath = path.join(args.targetDir, "opencode.json");
  const opencodeRaw = readFileSafe(opencodePath);
  if (opencodeRaw.trim()) {
    try {
      const cfg = JSON.parse(opencodeRaw);
      const model = cfg?.model;
      if (typeof model === "string") {
        if (model.startsWith("openai/")) return "openai";
        if (model.startsWith("anthropic/")) return "anthropic";
        if (model.startsWith("local/")) return "local";
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function maybeApplyProfile(args: { targetDir: string; sourceDir: string; dryRun: boolean; enabled: boolean }) {
  if (!args.enabled) return;
  if (args.dryRun) {
    console.log("[dry] apply profile (auto): skipped in dry-run");
    return;
  }

  const profileName = detectProfileName({ targetDir: args.targetDir });
  if (!profileName) {
    console.log("[write] apply profile (auto): skipped (no provider detected)");
    return;
  }

  const profilePath = path.join(args.targetDir, "profiles", `${profileName}.yaml`);
  if (!isFile(profilePath)) {
    console.log(`[write] apply profile (auto): skipped (missing profiles/${profileName}.yaml)`);
    return;
  }

  const toolPath = path.join(args.targetDir, "pai-tools", "ApplyProfile.ts");
  if (!isFile(toolPath)) {
    console.log("[write] apply profile (auto): skipped (missing pai-tools/ApplyProfile.ts)");
    return;
  }

  try {
    console.log(`[write] apply profile (auto): ${profileName}`);
    execSync(
      `bun "${toolPath}" "${profileName}" --opencode-dir "${args.targetDir}"`,
      { stdio: "inherit" }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[warn] apply profile (auto) failed: ${message}`);
  }
}

function ensureDir(p: string, dryRun: boolean) {
  if (dryRun) return;
  fs.mkdirSync(p, { recursive: true });
}

function readFileSafe(p: string): string {
  try {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return "";
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function writeFileSafe(p: string, content: string, dryRun: boolean) {
  if (dryRun) return;
  ensureDir(path.dirname(p), dryRun);
  fs.writeFileSync(p, content);
}

function renderGlobalAgentsManagedBlock(args: {
  repoRoot: string;
  sourceDir: string;
  targetDir: string;
}): string {
  const repoRoot = args.repoRoot;
  const baseDir = path.join(repoRoot, ".opencode");
  const targetDir = args.targetDir;

  // Keep this intentionally short and binding. OpenCode loads it every session.
  return [
    AGENTS_BLOCK_BEGIN,
    "# PAI-OpenCode Global Rules (Managed)",
    "",
    "## HARD RULE: Do Not Edit Runtime Directly",
    "",
    `HARD RULE: Do not edit files under \`${targetDir}/\` directly.`,
    "",
    "If a task requires changing anything under that directory:",
    "1) STOP and do the change in the base repository instead:",
    `   \`${baseDir}/\``,
    "2) Deploy the change into the runtime by running:",
    `   \`cd "${repoRoot}" && bun Tools/Install.ts --target "${targetDir}"\``,
    "",
    "Only exception:",
    "- If you explicitly instruct me to perform a runtime-only edit under the runtime directory, I may do it.",
    "",
    "## Private Paths (Never Touch Unless Explicitly Instructed)",
    "",
    `- \`${targetDir}/settings.json\``,
    `- \`${targetDir}/opencode.json\``,
    `- \`${targetDir}/skills/PAI/USER/\``,
    `- \`${targetDir}/MEMORY/\``,
    "",
    AGENTS_BLOCK_END,
  ].join("\n");
}

function normalizeTextFile(content: string): string {
  // Normalize newlines and trailing whitespace so idempotent updates stay stable.
  const normalized = content.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  return normalized.replace(/\n*$/, "\n");
}

function upsertManagedBlock(existing: string, block: string): { content: string; changed: boolean; action: "created" | "updated" | "unchanged" } {
  const trimmedExisting = existing;
  if (!trimmedExisting.trim()) {
    return { content: normalizeTextFile(block), changed: true, action: "created" };
  }

  const beginIdx = trimmedExisting.indexOf(AGENTS_BLOCK_BEGIN);
  const endIdx = trimmedExisting.indexOf(AGENTS_BLOCK_END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const afterEndIdx = endIdx + AGENTS_BLOCK_END.length;
    const before = trimmedExisting.slice(0, beginIdx).trimEnd();
    const after = trimmedExisting.slice(afterEndIdx).trimStart();

    const next = normalizeTextFile([before, block.trim(), after].filter(Boolean).join("\n\n"));
    if (normalizeTextFile(trimmedExisting) === next) {
      return { content: normalizeTextFile(trimmedExisting), changed: false, action: "unchanged" };
    }
    return { content: next, changed: true, action: "updated" };
  }

  // No managed block present: prepend it and preserve existing content.
  const next = normalizeTextFile(`${block.trim()}\n\n${trimmedExisting.trimStart()}`);
  if (normalizeTextFile(trimmedExisting) === next) {
    return { content: normalizeTextFile(trimmedExisting), changed: false, action: "unchanged" };
  }
  return { content: next, changed: true, action: "updated" };
}

function ensureGlobalAgentsMd(args: { targetDir: string; repoRoot: string; sourceDir: string; dryRun: boolean }) {
  const agentsPath = path.join(args.targetDir, "AGENTS.md");
  const existing = readFileSafe(agentsPath);
  const managedBlock = renderGlobalAgentsManagedBlock({
    repoRoot: args.repoRoot,
    sourceDir: args.sourceDir,
    targetDir: args.targetDir,
  });

  const { content, changed, action } = upsertManagedBlock(existing, managedBlock);

  const prefix = args.dryRun ? "[dry]" : "[write]";
  console.log(`${prefix} AGENTS.md (${action}): ${agentsPath}`);

  if (args.dryRun && changed) {
    console.log("\n--- Managed Block Preview ---\n");
    console.log(managedBlock.trimEnd());
    console.log("\n--- End Preview ---\n");
  }

  if (changed) {
    writeFileSafe(agentsPath, content, args.dryRun);
  }
}

function copyFile(src: string, dest: string, dryRun: boolean) {
  if (dryRun) return;
  ensureDir(path.dirname(dest), dryRun);
  fs.copyFileSync(src, dest);
}

function copyDirRecursive(
  srcDir: string,
  destDir: string,
  opts: { dryRun: boolean; overwrite: boolean; preserveIfExistsPrefixes: string[]; relBase: string }
) {
  const { dryRun, overwrite, preserveIfExistsPrefixes, relBase } = opts;

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const destPath = path.join(destDir, ent.name);
    const relPath = path.posix
      .join(relBase.replace(/\\/g, "/"), ent.name)
      .replace(/^\.\//, "");

    const preserveIfExists = preserveIfExistsPrefixes.some((pfx) => relPath.startsWith(pfx));

    if (ent.isDirectory()) {
      const destExists = isDir(destPath);
      if (preserveIfExists && destExists) {
        // Still recurse: we want to allow seeding missing files under preserved dirs.
        copyDirRecursive(srcPath, destPath, {
          dryRun,
          overwrite: false,
          preserveIfExistsPrefixes,
          relBase: relPath,
        });
        continue;
      }

      if (!dryRun) fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath, {
        dryRun,
        overwrite,
        preserveIfExistsPrefixes,
        relBase: relPath,
      });
      continue;
    }

    if (ent.isSymbolicLink()) {
      if (preserveIfExists && fs.existsSync(destPath)) continue;
      if (!overwrite && fs.existsSync(destPath)) continue;
      const linkTarget = fs.readlinkSync(srcPath);
      if (!dryRun) {
        ensureDir(path.dirname(destPath), dryRun);
        try {
          fs.rmSync(destPath, { recursive: true, force: true });
        } catch {
          // ignore
        }
        fs.symlinkSync(linkTarget, destPath);
      }
      continue;
    }

    if (!ent.isFile()) continue;

    if (preserveIfExists && fs.existsSync(destPath)) {
      continue;
    }

    if (!overwrite && fs.existsSync(destPath)) {
      continue;
    }

    copyFile(srcPath, destPath, dryRun);
  }
}

function removePath(targetPath: string, dryRun: boolean) {
  const prefix = dryRun ? "[dry]" : "[write]";
  console.log(`${prefix} delete ${targetPath}`);
  if (dryRun) return;
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function pruneDirRecursive(
  srcDir: string,
  destDir: string,
  opts: { dryRun: boolean; preserveIfExistsPrefixes: string[]; relBase: string }
): { deleted: number } {
  const { dryRun, preserveIfExistsPrefixes, relBase } = opts;

  if (!isDir(destDir)) return { deleted: 0 };

  let deleted = 0;
  const entries = fs.readdirSync(destDir, { withFileTypes: true });

  for (const ent of entries) {
    const destPath = path.join(destDir, ent.name);
    const srcPath = path.join(srcDir, ent.name);
    const relPath = path.posix
      .join(relBase.replace(/\\/g, "/"), ent.name)
      .replace(/^\.\//, "");

    const preserveIfExists = preserveIfExistsPrefixes.some((pfx) => relPath.startsWith(pfx));
    if (preserveIfExists) continue;

    const srcExists = fs.existsSync(srcPath);
    if (!srcExists) {
      removePath(destPath, dryRun);
      deleted++;
      continue;
    }

    const srcIsDir = isDir(srcPath);
    const srcIsFile = isFile(srcPath);

    // If types mismatch (dir vs file), delete the destination; it will be recreated by copy.
    if (ent.isDirectory() && !srcIsDir) {
      removePath(destPath, dryRun);
      deleted++;
      continue;
    }
    if (ent.isFile() && !srcIsFile) {
      removePath(destPath, dryRun);
      deleted++;
      continue;
    }
    if (ent.isSymbolicLink() && !(srcIsDir || srcIsFile)) {
      removePath(destPath, dryRun);
      deleted++;
      continue;
    }

    if (ent.isDirectory() && srcIsDir) {
      const child = pruneDirRecursive(srcPath, destPath, {
        dryRun,
        preserveIfExistsPrefixes,
        relBase: relPath,
      });
      deleted += child.deleted;
    }
  }

  return { deleted };
}

function syncSelectedSkills(args: {
  sourceSkillsDir: string;
  targetSkillsDir: string;
  selectedSkills: string[];
  dryRun: boolean;
  prune: boolean;
}) {
  const ensureCoreAlias = () => {
    const paiPath = path.join(args.targetSkillsDir, "PAI");
    const corePath = path.join(args.targetSkillsDir, "CORE");
    if (!isDir(paiPath)) return;

    const prefix = args.dryRun ? "[dry]" : "[write]";
    let coreExists = fs.existsSync(corePath);
    if (coreExists) {
      try {
        const stat = fs.lstatSync(corePath);
        if (stat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(corePath);
          if (linkTarget === "PAI" || linkTarget === "skills/PAI") {
            console.log(`${prefix} skills alias CORE -> PAI (ok)`);
            return;
          }
        }
      } catch {
        // Fallthrough to overwrite alias.
      }

      if (!args.dryRun) {
        try {
          fs.rmSync(corePath, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      }
      coreExists = false;
    }

    if (!coreExists) {
      console.log(`${prefix} skills alias CORE -> PAI`);
      if (!args.dryRun) {
        fs.symlinkSync("PAI", corePath);
      }
    }
  };

  const selectedSet = new Set(args.selectedSkills);
  ensureDir(args.targetSkillsDir, args.dryRun);

  if (args.prune && isDir(args.targetSkillsDir)) {
    let deleted = 0;
    const entries = fs.readdirSync(args.targetSkillsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!(ent.isDirectory() || ent.isSymbolicLink())) continue;
      const name = ent.name;
      if (name.startsWith(".")) continue;
      if (name === "CORE") continue;
      if (selectedSet.has(name)) continue;
      removePath(path.join(args.targetSkillsDir, name), args.dryRun);
      deleted++;
    }
    if (deleted > 0) {
      console.log(`${args.dryRun ? "[dry]" : "[write]"} pruned ${deleted} deselected skill(s)`);
    }
  }

  const preserve = ["skills/PAI/USER/", "skills/PAI/WORK/"];

  for (const skill of args.selectedSkills) {
    const src = path.join(args.sourceSkillsDir, skill);
    if (!isDir(src)) continue;
    const dest = path.join(args.targetSkillsDir, skill);
    const prefix = args.dryRun ? "[dry]" : "[sync]";
    console.log(`${prefix} skill ${skill}`);
    ensureDir(dest, args.dryRun);
    copyDirRecursive(src, dest, {
      dryRun: args.dryRun,
      overwrite: true,
      preserveIfExistsPrefixes: preserve,
      relBase: `skills/${skill}/`,
    });
  }

  ensureCoreAlias();
}

async function sync(mode: Mode, opts: Options) {
  if (mode !== "sync") throw new Error(`Unsupported mode: ${mode}`);

  const {
    sourceDir,
    targetDir,
    dryRun,
    migrateFromRepo,
    applyProfile,
    prune,
    installDeps,
    verify,
    skillsGateProfile,
    skillsGateScannerRoot,
    skillsGateScanAll,
    nonInteractive,
    skillsArg,
  } = opts;
  if (!isDir(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const repoRoot = path.resolve(path.join(sourceDir, ".."));

  console.log("PAI-OpenCode Install/Upgrade");
  console.log(`  source: ${sourceDir}`);
  console.log(`  target: ${targetDir}`);
  console.log(`  mode:   ${dryRun ? "dry-run" : "write"}`);
  console.log(`  prune:  ${prune ? "enabled" : "disabled"}`);
  console.log(`  skills-gate: ${skillsGateProfile}`);
  console.log(`  skills-gate-scope: ${skillsGateScanAll ? "all" : "changed"}`);
  console.log(`  skills-ui: ${nonInteractive ? "disabled" : "enabled"}`);
  console.log("");

  ensureDir(targetDir, dryRun);

  // Migrate legacy CORE layout before syncing in PAI layout.
  migrateLegacyCoreSkills({ targetDir, dryRun });

  // Resolve selected skills (interactive by default on TTY) and persist the selection manifest.
  const skillSelectionPlan = await resolveSkillSelectionPlan({
    sourceDir,
    targetDir,
    dryRun,
    nonInteractive,
    skillsArg,
  });
  persistSkillSelection({ plan: skillSelectionPlan, dryRun });

  // Pre-install skills security gate (runs against selected source skills before runtime copy).
  maybeRunSkillsSecurityGate({
    sourceDir,
    targetDir,
    dryRun,
    profile: skillsGateProfile,
    scannerRoot: skillsGateScannerRoot,
    scanAll: skillsGateScanAll,
    selectedTopLevelSkills: skillSelectionPlan.selectedSkills,
  });

  // Core runtime directories (OpenCode uses plural names)
  const copyAlways = [
    "ACTIONS",
    "BACKUPS",
    "agents",
    "commands",
    "config",
    "docs",
    "History",
    "mcp",
    "PIPELINES",
    "plugins",
    "profiles",
    "security",
    "skills",
    "tools",
    "pai-tools",
    "PAISYSTEM",
    "PAISECURITYSYSTEM",
  ];

  for (const name of copyAlways) {
    const src = path.join(sourceDir, name);
    if (!fs.existsSync(src)) continue;
    const srcStat = fs.lstatSync(src);
    if (srcStat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(src);
      const dest = path.join(targetDir, name);
      console.log(`${dryRun ? "[dry]" : "[sync]"} symlink ${name} -> ${linkTarget}`);
      if (!dryRun) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
        } catch {
          // ignore
        }
        ensureDir(path.dirname(dest), dryRun);
        fs.symlinkSync(linkTarget, dest);
      }
      continue;
    }
    if (!isDir(src)) continue;
    const dest = path.join(targetDir, name);
    console.log(`${dryRun ? "[dry]" : "[sync]"} dir ${name}`);
    ensureDir(dest, dryRun);

    if (name === "skills") {
      syncSelectedSkills({
        sourceSkillsDir: src,
        targetSkillsDir: dest,
        selectedSkills: skillSelectionPlan.selectedSkills,
        dryRun,
        prune,
      });
      continue;
    }

    // Preserve personal content and runtime state.
    const preserve: string[] = [
      "MEMORY/",
      "config/",
      "skills/PAI/USER/",
      "skills/PAI/WORK/",
    ];

    // Optional: delete target files/dirs that are not present in source.
    // This is intentionally limited to the managed directories listed in copyAlways.
    if (prune) {
      const pruneResult = pruneDirRecursive(src, dest, {
        dryRun,
        preserveIfExistsPrefixes: preserve,
        relBase: `${name}/`,
      });
      if (pruneResult.deleted > 0) {
        console.log(
          `${dryRun ? "[dry]" : "[write]"} pruned ${pruneResult.deleted} path(s) under ${name}`
        );
      }
    }

    const overwrite = true;
    copyDirRecursive(src, dest, {
      dryRun,
      overwrite,
      preserveIfExistsPrefixes: preserve,
      relBase: `${name}/`,
    });
  }

  // Sync VoiceServer bundle (managed runtime scripts + server).
  // Source lives in repo Packs so it stays decoupled from .opencode.
  const voiceServerSrc = path.join(repoRoot, "Packs", "pai-voice-system", "src", "VoiceServer");
  if (isDir(voiceServerSrc)) {
    const dest = path.join(targetDir, "VoiceServer");
    console.log(`${dryRun ? "[dry]" : "[sync]"} dir VoiceServer`);
    ensureDir(dest, dryRun);
    copyDirRecursive(voiceServerSrc, dest, {
      dryRun,
      overwrite: true,
      // Allow local tweaks to the voice registry.
      preserveIfExistsPrefixes: ["voice-server/voices.json"],
      relBase: "VoiceServer/",
    });
  }

  // Cleanup legacy PAI helper scripts in OpenCode tool namespace.
  removeLegacyOpenCodeTools({ targetDir, dryRun });

  // Remove unsupported/deprecated status line artifacts.
  removeLegacyStatusLineDocs({ targetDir, dryRun });

  // Seed MEMORY only if requested or missing.
  const srcMemory = path.join(sourceDir, "MEMORY");
  const destMemory = path.join(targetDir, "MEMORY");
  if (isDir(srcMemory)) {
    const shouldSeed = migrateFromRepo || !isDir(destMemory);
    if (shouldSeed) {
      console.log(`${dryRun ? "[dry]" : "[seed]"} MEMORY`);
      ensureDir(destMemory, dryRun);
      copyDirRecursive(srcMemory, destMemory, {
        dryRun,
        overwrite: false,
        preserveIfExistsPrefixes: [""],
        relBase: "MEMORY/",
      });
    }
  }

  // Always keep MEMORY/README.md up to date (managed documentation).
  // Do not overwrite other MEMORY content.
  const srcMemoryReadme = path.join(sourceDir, "MEMORY", "README.md");
  const destMemoryReadme = path.join(targetDir, "MEMORY", "README.md");
  if (fs.existsSync(srcMemoryReadme)) {
    const prefix = dryRun ? "[dry]" : "[write]";
    console.log(`${prefix} MEMORY/README.md (overwrite): ${destMemoryReadme}`);
    if (!dryRun) {
      ensureDir(path.dirname(destMemoryReadme), dryRun);
      fs.copyFileSync(srcMemoryReadme, destMemoryReadme);
    }
  }

  // Seed MEMORY/LEARNING/README.md if missing (safe, non-destructive).
  const srcLearningReadme = path.join(sourceDir, "MEMORY", "LEARNING", "README.md");
  const destLearningReadme = path.join(targetDir, "MEMORY", "LEARNING", "README.md");
  if (fs.existsSync(srcLearningReadme) && !fs.existsSync(destLearningReadme)) {
    const prefix = dryRun ? "[dry]" : "[seed]";
    console.log(`${prefix} MEMORY/LEARNING/README.md (no-overwrite): ${destLearningReadme}`);
    if (!dryRun) {
      ensureDir(path.dirname(destLearningReadme), dryRun);
      fs.copyFileSync(srcLearningReadme, destLearningReadme);
    }
  }

  // Seed USER/TELOS etc from source if requested.
  if (migrateFromRepo) {
    const srcUser = path.join(sourceDir, "skills", "PAI", "USER");
    const destUser = path.join(targetDir, "skills", "PAI", "USER");
    if (isDir(srcUser)) {
      console.log(`${dryRun ? "[dry]" : "[seed]"} skills/PAI/USER (no-overwrite)`);
      ensureDir(destUser, dryRun);
      copyDirRecursive(srcUser, destUser, {
        dryRun,
        overwrite: false,
        preserveIfExistsPrefixes: [""],
        relBase: "skills/PAI/USER/",
      });
    }
  }

  // Copy top-level runtime files if missing
  // - Overwrite shareable runtime files so upgrades propagate.
  // - Never overwrite private config files (settings.json/opencode.json).
  const topLevelFiles: Array<{ name: string; overwrite: boolean }> = [
    { name: "PAIOpenCodeWizard.ts", overwrite: true },
    { name: "OPENCODE.md", overwrite: true },
    { name: "INSTALL.md", overwrite: true },
    { name: "package.json", overwrite: true },
    { name: "bun.lock", overwrite: true },
    { name: "tsconfig.json", overwrite: true },
    { name: "settings.json", overwrite: false },
    { name: "opencode.json", overwrite: false },
  ];

  // If pruning, remove managed top-level files that were deleted from source.
  // Never prune private config files.
  if (prune) {
    const managedTopLevel = topLevelFiles
      .filter((f) => f.overwrite)
      .map((f) => f.name);
    for (const f of managedTopLevel) {
      const src = path.join(sourceDir, f);
      const dest = path.join(targetDir, f);
      if (!fs.existsSync(src) && fs.existsSync(dest)) {
        removePath(dest, dryRun);
      }
    }
  }

  for (const { name: f, overwrite: overwriteFile } of topLevelFiles) {
    const src = path.join(sourceDir, f);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(targetDir, f);

    const exists = fs.existsSync(dest);
    if (exists && !overwriteFile) continue;

    const label = exists ? "update" : "copy";
    console.log(`${dryRun ? "[dry]" : "[write]"} file ${label} ${f}`);
    copyFile(src, dest, dryRun);
  }

  // Ensure global OpenCode rules exist and are updated safely.
  ensureGlobalAgentsMd({ targetDir, repoRoot, sourceDir, dryRun });

  // Ensure runtime agent frontmatter models match selected provider profile.
  // This prevents ProviderModelNotFoundError when switching providers.
  maybeApplyProfile({ targetDir, sourceDir, dryRun, enabled: applyProfile });

  // Generate skills/skill-index.json for deterministic skill discovery.
  maybeGenerateSkillIndex({ targetDir, dryRun });

  // Post-install verification (default): ensure skill cross-references resolve.
  verifyCrossReferences({ targetDir, dryRun, enabled: verify });

  // Post-install verification: ensure SkillSystem router + section docs are internally consistent.
  // This is a static check (no LLM calls).
  verifySkillSystemDocs({ targetDir, dryRun, enabled: verify });

  // Ensure runtime dependencies exist for code-first tools (e.g., Playwright).
  // This is best-effort but runs by default so skills work immediately.
  maybeInstallDependencies({ targetDir, dryRun, enabled: installDeps });

  console.log("\nDone.");
  console.log("Next:");
  console.log(`  1) Run: bun "${path.join(targetDir, "PAIOpenCodeWizard.ts")}"`);
  console.log("  2) Start OpenCode: opencode");
}

async function main() {
  let opts: Options | null = null;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (!opts) {
      usage();
      process.exit(0);
    }

    await sync("sync", opts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    usage(opts || undefined);
    process.exit(1);
  }
}

void main();
