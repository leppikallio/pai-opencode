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

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

type Mode = "sync";

type Options = {
  targetDir: string;
  sourceDir: string;
  dryRun: boolean;
  migrateFromRepo: boolean;
  applyProfile: boolean;
  prune: boolean;
  installDeps: boolean;
  verify: boolean;
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

  return { targetDir, sourceDir, dryRun, migrateFromRepo, applyProfile, prune, installDeps, verify };
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
  // The Browser skill uses Playwright's chromium headless shell. Ensure it's installed.
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
    { rel: "skills/Browser", label: "Browser", requireModule: "playwright" },
    { rel: "skills/Apify", label: "Apify", requireModule: "apify-client" },
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

    if (pkg.rel === "skills/Browser") {
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

function sync(mode: Mode, opts: Options) {
  if (mode !== "sync") throw new Error(`Unsupported mode: ${mode}`);

  const { sourceDir, targetDir, dryRun, migrateFromRepo, applyProfile, prune, installDeps, verify } = opts;
  if (!isDir(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const repoRoot = path.resolve(path.join(sourceDir, ".."));

  console.log("PAI-OpenCode Install/Upgrade");
  console.log(`  source: ${sourceDir}`);
  console.log(`  target: ${targetDir}`);
  console.log(`  mode:   ${dryRun ? "dry-run" : "write"}`);
  console.log(`  prune:  ${prune ? "enabled" : "disabled"}`);
  console.log("");

  ensureDir(targetDir, dryRun);

  // Migrate legacy CORE layout before syncing in PAI layout.
  migrateLegacyCoreSkills({ targetDir, dryRun });

  // Core runtime directories (OpenCode uses plural names)
  const copyAlways = [
    "ACTIONS",
    "BACKUPS",
    "agents",
    "config",
    "docs",
    "History",
    "mcp",
    "PIPELINES",
    "plugins",
    "profiles",
    "security",
    "skills",
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
      preserveIfExistsPrefixes: ["VoiceServer/voices.json"],
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
  // Do not overwrite any other MEMORY content.
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

  // Ensure runtime dependencies exist for code-first tools (e.g., Playwright).
  // This is best-effort but runs by default so skills work immediately.
  maybeInstallDependencies({ targetDir, dryRun, enabled: installDeps });

  console.log("\nDone.");
  console.log("Next:");
  console.log(`  1) Run: bun "${path.join(targetDir, "PAIOpenCodeWizard.ts")}"`);
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    usage(opts || undefined);
    process.exit(1);
  }
}

main();
