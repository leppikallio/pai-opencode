import { promises as fs } from "node:fs";
import path from "node:path";

import { getStateDir } from "../lib/paths";

export type RtkCapabilityRecord = {
  present: boolean;
  version: string | null;
  supportsRewrite: boolean;
};

export type DetectRtkCapabilityArgs = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type RtkCapabilityCacheLocationArgs = {
  stateDir?: string;
};

export type RefreshRtkCapabilityCacheArgs = DetectRtkCapabilityArgs & RtkCapabilityCacheLocationArgs;

const RTK_REWRITE_MINIMUM = { major: 0, minor: 23, patch: 0 };
const RTK_CAPABILITY_CACHE_RELATIVE_PATH = path.join("rtk", "capability.json");

function missingCapabilityRecord(): RtkCapabilityRecord {
  return {
    present: false,
    version: null,
    supportsRewrite: false,
  };
}

function mergeEnv(overrides?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function readProcessText(stream: unknown): Promise<string> {
  if (!(stream instanceof ReadableStream)) return "";
  const buffer = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

function parseVersion(text: string): string | null {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < 3; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
}

export function supportsRtkRewrite(version: string | null): boolean {
  if (!version) return false;
  return compareVersions(version, `${RTK_REWRITE_MINIMUM.major}.${RTK_REWRITE_MINIMUM.minor}.${RTK_REWRITE_MINIMUM.patch}`) >= 0;
}

export function getRtkCapabilityCachePath(args: RtkCapabilityCacheLocationArgs = {}): string {
  const stateDir = args.stateDir ?? getStateDir();
  return path.join(stateDir, RTK_CAPABILITY_CACHE_RELATIVE_PATH);
}

export async function detectRtkCapability(args: DetectRtkCapabilityArgs = {}): Promise<RtkCapabilityRecord> {
  let proc: Bun.Subprocess;

  try {
    proc = Bun.spawn(["rtk", "--version"], {
      cwd: args.cwd,
      env: mergeEnv(args.env),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return missingCapabilityRecord();
  }

  const stdoutPromise = readProcessText(proc.stdout);
  const stderrPromise = readProcessText(proc.stderr);
  const exitCode = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  const version = parseVersion(`${stdout}\n${stderr}`);
  if (exitCode !== 0 && !version) {
    return missingCapabilityRecord();
  }

  return {
    present: true,
    version,
    supportsRewrite: supportsRtkRewrite(version),
  };
}

export async function writeRtkCapabilityCache(args: {
  capability: RtkCapabilityRecord;
  stateDir?: string;
}): Promise<string> {
  const cachePath = getRtkCapabilityCachePath({ stateDir: args.stateDir });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(args.capability, null, 2)}\n`, "utf8");
  return cachePath;
}

export async function refreshRtkCapabilityCache(
  args: RefreshRtkCapabilityCacheArgs = {},
): Promise<{ capability: RtkCapabilityRecord; cachePath: string }> {
  const capability = await detectRtkCapability({ cwd: args.cwd, env: args.env });
  const cachePath = await writeRtkCapabilityCache({ capability, stateDir: args.stateDir });
  return { capability, cachePath };
}
