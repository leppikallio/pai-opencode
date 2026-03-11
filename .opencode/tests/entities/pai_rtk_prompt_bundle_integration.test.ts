import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __resetSessionRootRegistryForTests,
  setSessionRootId,
} from "../../plugins/pai-cc-hooks/shared/session-root";
import { createPromptControl } from "../../plugins/pai-cc-hooks/prompt-control";

type PromptControl = ReturnType<typeof createPromptControl>;

const repoRoot =
  path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();

const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
const sourceDir = path.join(repoRoot, ".opencode");

function createGpt5Input(sessionID: string): unknown {
  return {
    sessionID,
    provider: { id: "openai" },
    model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
  };
}

function prependPath(binDir: string): string {
  const existingPath = process.env.PATH ?? "";
  return existingPath.length > 0 ? `${binDir}:${existingPath}` : binDir;
}

function createRtkShim(args: { versionOutput: string }): string {
  const shimDir = mkdtempSync(path.join(os.tmpdir(), "pai-prompt-bundle-rtk-shim-"));
  const shimPath = path.join(shimDir, "rtk");
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${args.versionOutput}"
  exit 0
fi
if [ "$1" = "rewrite" ]; then
  shift
  printf "rtk %s\\n" "$*"
  exit 0
fi
exit 1
`;

  writeFileSync(shimPath, script, "utf8");
  chmodSync(shimPath, 0o755);
  return shimDir;
}

function runInstall(args: { targetDir: string; pathValue: string }) {
  return spawnSync(
    "bun",
    [
      installToolPath,
      "--target",
      args.targetDir,
      "--source",
      sourceDir,
      "--non-interactive",
      "--skills",
      "all",
      "--skills-gate-profile",
      "off",
      "--no-install-deps",
      "--no-verify",
    ],
    {
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        PATH: args.pathValue,
      },
    },
  );
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe("RTK prompt bundle integration contract (Task 3 semantics)", () => {
  test("GPT-5 root and child system bundles include runtime RTK.md authority semantics", async () => {
    const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "pai-rtk-bundle-runtime-"));
    const xdgHome = mkdtempSync(path.join(os.tmpdir(), "pai-rtk-bundle-xdg-"));
    const projectDir = mkdtempSync(path.join(os.tmpdir(), "pai-rtk-bundle-project-"));
    const shimDir = createRtkShim({ versionOutput: "rtk 0.23.0" });
    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousOpenCodeConfigRoot = process.env.OPENCODE_CONFIG_ROOT;
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;

    __resetSessionRootRegistryForTests();

    try {
      // Recipe for RTK prompt-bundle integration parity:
      // 1) install into a temp runtime root
      // 2) write a unique RTK.md sentinel under that runtime
      // 3) set OPENCODE_ROOT/OPENCODE_CONFIG_ROOT to the temp runtime
      // 4) call GPT-5 prompt-control system transform for a root session
      // 5) repeat for child session context and assert the same RTK sentinel
      const installRun = runInstall({
        targetDir: runtimeRoot,
        pathValue: prependPath(shimDir),
      });
      const output = `${installRun.stdout ?? ""}\n${installRun.stderr ?? ""}`;
      expect(installRun.status, output).toBe(0);

      const runtimeRtkPath = path.join(runtimeRoot, "RTK.md");
      const installedRuntimeRtkDoc = readFileSync(runtimeRtkPath, "utf8");

      expect(installedRuntimeRtkDoc).toContain(
        "RTK-proxied output is authoritative by default",
      );
      expect(installedRuntimeRtkDoc).toContain("Raw-output/tee recovery is an exception path");

      const sentinel = "RTK_PROMPT_BUNDLE_SENTINEL_TASK1";
      writeFileSync(runtimeRtkPath, `${installedRuntimeRtkDoc}\n${sentinel}\n`, "utf8");

      process.env.OPENCODE_ROOT = runtimeRoot;
      process.env.OPENCODE_CONFIG_ROOT = runtimeRoot;
      process.env.XDG_CONFIG_HOME = xdgHome;

      const promptControl = createPromptControl({ projectDir }) as PromptControl;

      const rootOutput: { system: unknown } = { system: ["ORIGINAL"] };
      await promptControl.systemTransform(createGpt5Input("ses_rtk_root"), rootOutput);
      const rootBundle = (rootOutput.system as string[])[0] ?? "";
      expect(rootBundle).toContain(sentinel);
      expect(rootBundle).toContain("RTK-proxied output is authoritative by default");
      expect(rootBundle).toContain("If RTK emits a `[full output: ~/.local/share/rtk/tee/... ]` hint");
      expect(rootBundle).toContain("Read ~/.local/share/rtk/tee/<file>");
      expect(rootBundle).toContain("rtk proxy cat ~/.local/share/rtk/tee/<file>");

      setSessionRootId("ses_rtk_child", "ses_rtk_root");
      const childOutput: { system: unknown } = { system: ["ORIGINAL"] };
      await promptControl.systemTransform(createGpt5Input("ses_rtk_child"), childOutput);
      const childBundle = (childOutput.system as string[])[0] ?? "";
      expect(childBundle).toContain(sentinel);
      expect(childBundle).toContain("RTK-proxied output is authoritative by default");
      expect(childBundle).toContain("If RTK emits a `[full output: ~/.local/share/rtk/tee/... ]` hint");
      expect(childBundle).toContain("Read ~/.local/share/rtk/tee/<file>");
      expect(childBundle).toContain("rtk proxy cat ~/.local/share/rtk/tee/<file>");
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
      restoreEnv("OPENCODE_CONFIG_ROOT", previousOpenCodeConfigRoot);
      restoreEnv("XDG_CONFIG_HOME", previousXdgConfigHome);
      __resetSessionRootRegistryForTests();
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(xdgHome, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
