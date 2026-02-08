#!/usr/bin/env bun
/**
 * ApplyProfile.ts - Apply a model profile to all agents
 *
 * IMPORTANT:
 * This is a PAI helper script. It must NOT live under OpenCode's `tools/`
 * directory, because OpenCode will attempt to load/execute custom tools.
 *
 * Usage:
 *   bun pai-tools/ApplyProfile.ts <profile-name> [--opencode-dir <dir>] [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as os from "node:os";

type ApplyProfileOptions = {
  opencodeDir: string;
  profileName: string;
  dryRun: boolean;
};

type SimpleProfile = {
  models?: Record<string, string>;
  [key: string]: string | Record<string, string> | undefined;
};

function dirExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function defaultOpencodeDir(): string {
  const fromEnv = process.env.PAI_DIR;
  if (fromEnv?.trim()) return resolve(fromEnv.trim());

  // Resolve to the directory that contains the runtime tree.
  // pai-tools/ApplyProfile.ts -> <opencodeDir>/pai-tools -> <opencodeDir>
  const here = dirname(fileURLToPath(import.meta.url));
  const fromHere = resolve(join(here, ".."));
  if (dirExists(join(fromHere, "skills")) && dirExists(join(fromHere, "plugins"))) {
    return fromHere;
  }

  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "opencode");
  return join(os.homedir(), ".config", "opencode");
}

function usage(opencodeDir?: string) {
  console.log("Usage: bun pai-tools/ApplyProfile.ts <profile-name> [--opencode-dir <dir>] [--dry-run]");
  console.log("\nOptions:");
  console.log("  --opencode-dir <dir>  OpenCode config dir (default: $PAI_DIR, then ~/.config/opencode)");
  console.log("  --dry-run             Print changes without writing files");
  console.log("");

  const dir = opencodeDir || defaultOpencodeDir();
  const profilesDir = join(dir, "profiles");
  if (existsSync(profilesDir)) {
    console.log("Available profiles:");
    const profiles = readdirSync(profilesDir).filter((f) => f.endsWith(".yaml"));
    profiles.forEach((p) => {
      console.log(`  - ${p.replace(".yaml", "")}`);
    });
  }
}

function parseArgs(argv: string[]): ApplyProfileOptions | null {
  let profileName: string | undefined;
  let opencodeDir = defaultOpencodeDir();
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage(opencodeDir);
      return null;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--opencode-dir") {
      const v = argv[i + 1];
      if (!v) {
        console.error("Missing value for --opencode-dir");
        usage(opencodeDir);
        return null;
      }
      opencodeDir = v;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      usage(opencodeDir);
      return null;
    }
    if (!profileName) {
      profileName = arg;
    }
  }

  if (!profileName) {
    usage(opencodeDir);
    return null;
  }

  return { profileName, opencodeDir, dryRun };
}

function getModelKeyCandidates(agentName: string): string[] {
  // Keep mapping explicit and predictable.
  // The primary key is the agent filename stem (e.g. `Architect`).
  // We also accept its lowercase form (e.g. `researcher`).
  const lower = agentName.toLowerCase();
  return [...new Set([agentName, lower].filter(Boolean))];
}

export function applyProfileToAgents(opts: ApplyProfileOptions): { updated: number; total: number } {
  const profilesDir = join(opts.opencodeDir, "profiles");
  const agentsDir = join(opts.opencodeDir, "agents");

  if (!existsSync(profilesDir)) {
    throw new Error(`Profiles directory not found: ${profilesDir}`);
  }
  if (!existsSync(agentsDir)) {
    throw new Error(`agents directory not found: ${agentsDir}`);
  }

  const profilePath = join(profilesDir, `${opts.profileName}.yaml`);
  if (!existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }

  const profileContent = readFileSync(profilePath, "utf-8");
  const profile = parseSimpleProfileYaml(profileContent);

  if (!profile?.models?.default) {
    throw new Error(`Invalid profile (missing models.default): ${profilePath}`);
  }

  console.log(`\nApplying profile: ${profile.name || opts.profileName}`);
  if (profile.description) console.log(`  ${profile.description}`);
  console.log(`  opencodeDir: ${opts.opencodeDir}`);
  if (opts.dryRun) console.log("  mode: dry-run (no files written)");
  console.log("");

  const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  let updated = 0;

  for (const agentFile of agentFiles) {
    const agentName = agentFile.replace(".md", "");
    const agentPath = join(agentsDir, agentFile);
    let content = readFileSync(agentPath, "utf-8");

    const modelRegex = /^model:\s*.+$/m;
    const oldModelLine = content.match(modelRegex)?.[0];

    if (!oldModelLine) {
      console.log(`- ${agentName}: no model line found (skipping)`);
      continue;
    }

    const candidates = getModelKeyCandidates(agentName);
    const key = candidates.find((k) => profile.models && Object.hasOwn(profile.models, k));
    const newModel = (key ? profile.models[key] : undefined) || profile.models.default;

    const newContent = content.replace(modelRegex, `model: ${newModel}`);
    const oldModel = oldModelLine.replace(/^model:\s*/, "");
    const changed = oldModel !== newModel;

    if (changed) updated++;
    if (!opts.dryRun && changed) {
      content = newContent;
      writeFileSync(agentPath, content);
    }

    const targetKey = key ? ` (key: ${key})` : " (default)";
    console.log(`${changed ? "*" : "-"} ${agentName}: ${oldModel} -> ${newModel}${targetKey}`);
  }

  console.log(`\nDone: ${agentFiles.length} agents processed (${updated} updated)`);
  return { updated, total: agentFiles.length };
}

function parseSimpleProfileYaml(content: string): SimpleProfile {
  const out: SimpleProfile = {};
  let currentMap: "models" | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    if (/^[a-zA-Z0-9_-]+:\s*$/.test(trimmed)) {
      const key = trimmed.slice(0, -1).trim();
      if (key === "models") {
        out.models = out.models || {};
        currentMap = "models";
      } else {
        currentMap = null;
      }
      continue;
    }

    if (currentMap === "models" && /^\s{2,}[a-zA-Z0-9_-]+:/.test(line)) {
      const idx = line.indexOf(":");
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) {
        const models = out.models ?? {};
        models[k] = stripYamlScalar(v);
        out.models = models;
      }
      continue;
    }

    const idx = trimmed.indexOf(":");
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (k) out[k] = stripYamlScalar(v);
    }
  }

  return out;
}

function stripYamlScalar(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) process.exit(1);

  try {
    applyProfileToAgents(args);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    usage(args.opencodeDir);
    process.exit(1);
  }
}

main();

