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
 * - Make OpenCode work from any working directory
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

type Mode = "sync";

type Options = {
  targetDir: string;
  sourceDir: string;
  dryRun: boolean;
  migrateFromRepo: boolean;
  applyProfile: boolean;
};

const AGENTS_BLOCK_BEGIN = "<!-- PAI-OPENCODE:BEGIN -->";
const AGENTS_BLOCK_END = "<!-- PAI-OPENCODE:END -->";

function xdgConfigHome(): string {
  const v = process.env.XDG_CONFIG_HOME;
  if (v && v.trim()) return v.trim();
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
  console.log("  --skip-apply-profile   Do not rewrite agent model frontmatter");
  console.log("  --dry-run              Print actions without writing");
  console.log("  -h, --help             Show help");
}

function parseArgs(argv: string[]): Options | null {
  let targetDir = defaultTargetDir();
  let sourceDir = defaultSourceDir();
  let dryRun = false;
  let migrateFromRepo = false;
  let applyProfile = true;

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
    if (arg === "--skip-apply-profile") {
      applyProfile = false;
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

  return { targetDir, sourceDir, dryRun, migrateFromRepo, applyProfile };
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
  } catch (err: any) {
    console.log(`[warn] apply profile (auto) failed: ${err?.message || String(err)}`);
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
    `   \`cd \"${repoRoot}\" && bun Tools/Install.ts --target \"${targetDir}\"\``,
    "",
    "Only exception:",
    "- If you explicitly instruct me to perform a runtime-only edit under the runtime directory, I may do it.",
    "",
    "## Private Paths (Never Touch Unless Explicitly Instructed)",
    "",
    `- \`${targetDir}/settings.json\``,
    `- \`${targetDir}/opencode.json\``,
    `- \`${targetDir}/skills/CORE/USER/\``,
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
  const next = normalizeTextFile(block.trim() + "\n\n" + trimmedExisting.trimStart());
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

function sync(mode: Mode, opts: Options) {
  if (mode !== "sync") throw new Error(`Unsupported mode: ${mode}`);

  const { sourceDir, targetDir, dryRun, migrateFromRepo, applyProfile } = opts;
  if (!isDir(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const repoRoot = path.resolve(path.join(sourceDir, ".."));

  console.log("PAI-OpenCode Install/Upgrade");
  console.log(`  source: ${sourceDir}`);
  console.log(`  target: ${targetDir}`);
  console.log(`  mode:   ${dryRun ? "dry-run" : "write"}`);
  console.log("");

  ensureDir(targetDir, dryRun);

  // Core runtime directories (OpenCode uses plural names)
  const copyAlways = [
    "agents",
    "plugins",
    "profiles",
    "skills",
    "pai-tools",
    "PAISYSTEM",
    "PAISECURITYSYSTEM",
  ];

  for (const name of copyAlways) {
    const src = path.join(sourceDir, name);
    if (!isDir(src)) continue;
    const dest = path.join(targetDir, name);
    console.log(`${dryRun ? "[dry]" : "[sync]"} dir ${name}`);
    ensureDir(dest, dryRun);

    // Preserve personal content and runtime state.
    const preserve: string[] = [
      "MEMORY/",
      "skills/CORE/USER/",
      "skills/CORE/WORK/",
    ];

    const overwrite = true;
    copyDirRecursive(src, dest, {
      dryRun,
      overwrite,
      preserveIfExistsPrefixes: preserve,
      relBase: `${name}/`,
    });
  }

  // Cleanup legacy PAI helper scripts in OpenCode tool namespace.
  removeLegacyOpenCodeTools({ targetDir, dryRun });

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

  // Seed USER/TELOS etc from source if requested.
  if (migrateFromRepo) {
    const srcUser = path.join(sourceDir, "skills", "CORE", "USER");
    const destUser = path.join(targetDir, "skills", "CORE", "USER");
    if (isDir(srcUser)) {
      console.log(`${dryRun ? "[dry]" : "[seed]"} skills/CORE/USER (no-overwrite)`);
      ensureDir(destUser, dryRun);
      copyDirRecursive(srcUser, destUser, {
        dryRun,
        overwrite: false,
        preserveIfExistsPrefixes: [""],
        relBase: "skills/CORE/USER/",
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

  console.log("\nDone.");
  console.log("Next:");
  console.log(`  1) Run: bun \"${path.join(targetDir, "PAIOpenCodeWizard.ts")}\"`);
  console.log("  2) Start OpenCode: opencode");
}

function main() {
  let opts: Options | null = null;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (!opts) {
      usage();
      process.exit(0);
    }

    sync("sync", opts);
  } catch (err: any) {
    console.error(`Error: ${err?.message || String(err)}`);
    usage(opts || undefined);
    process.exit(1);
  }
}

main();
