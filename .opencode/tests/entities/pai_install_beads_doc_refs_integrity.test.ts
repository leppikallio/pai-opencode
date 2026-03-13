import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRtkShim, prependPath, runInstall } from "./pai_install_runtime_test_helpers";

const repoRoot =
  path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();

const scanToolPath = path.join(repoRoot, ".opencode", "skills", "system", "Tools", "ScanBrokenRefs.ts");

function runScanBrokenRefs(rootDir: string, scopeDir: string) {
  return spawnSync(
    "bun",
    [scanToolPath, "--root", rootDir, "--scope", scopeDir, "--format", "json", "--allow-standalone"],
    {
      encoding: "utf8",
      shell: false,
    },
  );
}

describe("runtime install beads doc refs integrity", () => {
  test("vendored beads docs keep critical references valid after install", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-beads-doc-refs-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-install-beads-doc-refs-rtk-shim-",
    });

    try {
      const installRun = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const installOutput = `${installRun.stdout ?? ""}\n${installRun.stderr ?? ""}`;
      expect(installRun.status, installOutput).toBe(0);

      const runtimeBeadsRoot = path.join(targetDir, "skills", "utilities", "beads");
      const cliRefPath = path.join(runtimeBeadsRoot, "resources", "CLI_REFERENCE.md");
      const agentsPath = path.join(runtimeBeadsRoot, "resources", "AGENTS.md");
      const labelsPath = path.join(runtimeBeadsRoot, "resources", "LABELS.md");
      const adrPath = path.join(runtimeBeadsRoot, "adr", "0001-bd-prime-as-source-of-truth.md");

      expect(existsSync(runtimeBeadsRoot)).toBe(true);
      expect(existsSync(cliRefPath)).toBe(true);
      expect(existsSync(agentsPath)).toBe(true);
      expect(existsSync(labelsPath)).toBe(true);
      expect(existsSync(adrPath)).toBe(true);

      const cliRef = readFileSync(cliRefPath, "utf8");
      const agents = readFileSync(agentsPath, "utf8");
      const labels = readFileSync(labelsPath, "utf8");
      const adr = readFileSync(adrPath, "utf8");

      expect(cliRef).toContain("Customization:");
      expect(cliRef).toContain(".beads/PRIME.md");
      expect(cliRef).toContain("[AGENTS.md](AGENTS.md)");
      expect(cliRef).toContain("[LABELS.md](LABELS.md)");

      expect(labels).toContain("[CLI_REFERENCE.md](CLI_REFERENCE.md)");
      expect(labels).toContain("[AGENTS.md](AGENTS.md)");

      expect(agents).toContain("Run `bd agent --help`");
      expect(agents).toContain("Run `bd slot --help`");

      expect(adr).toContain("../resources/CLI_REFERENCE.md");

      const scanRun = runScanBrokenRefs(targetDir, runtimeBeadsRoot);
      const scanOutput = `${scanRun.stdout ?? ""}\n${scanRun.stderr ?? ""}`;
      expect(scanRun.status, scanOutput).toBe(0);

      const parsed = JSON.parse(scanRun.stdout || "{}") as {
        count?: number;
        findings?: Array<{ source?: string; resolved?: string }>;
      };

      expect(parsed.count, scanOutput).toBe(0);
      expect(parsed.findings ?? [], scanOutput).toHaveLength(0);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
