import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectRtkCapability } from "../../plugins/rtk/capability";

async function createRtkShim(args: { versionOutput: string }): Promise<string> {
  const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-contract-shim-"));
  const shimPath = path.join(shimDir, "rtk");
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${args.versionOutput}"
  exit 0
fi
if [ "$1" = "rewrite" ]; then
  shift
  printf "%s\\n" "$*"
  exit 0
fi
exit 1
`;

  await fs.writeFile(shimPath, script, { mode: 0o755 });
  await fs.chmod(shimPath, 0o755);
  return shimDir;
}

describe("rtk capability contract", () => {
  test("missing rtk fails open with rewrite disabled", async () => {
    const emptyPathDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-missing-"));

    try {
      const result = await detectRtkCapability({
        env: { PATH: emptyPathDir },
      });

      expect(result).toEqual({
        present: false,
        version: null,
        supportsRewrite: false,
      });
    } finally {
      await fs.rm(emptyPathDir, { recursive: true, force: true });
    }
  });

  test("rtk 0.22.x keeps rewrite disabled", async () => {
    const shimDir = await createRtkShim({ versionOutput: "rtk 0.22.9" });

    try {
      const result = await detectRtkCapability({ env: { PATH: shimDir } });

      expect(result).toEqual({
        present: true,
        version: "0.22.9",
        supportsRewrite: false,
      });
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("malformed rtk version output fails open", async () => {
    const shimDir = await createRtkShim({ versionOutput: "rtk version: not-a-semver" });

    try {
      const result = await detectRtkCapability({ env: { PATH: shimDir } });

      expect(result).toEqual({
        present: true,
        version: null,
        supportsRewrite: false,
      });
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });
});
