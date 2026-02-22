import { describe, expect, test } from "bun:test";

import { expandHookCommand } from "../../plugins/pai-cc-hooks/shared/execute-hook-command";

describe("expandHookCommand", () => {
  test("placeholder self-reference falls back to process.env", () => {
    const originalPaiDir = process.env.PAI_DIR;
    process.env.PAI_DIR = "/Users/process/.config/opencode/skills/PAI";

    try {
      const expanded = expandHookCommand("bun ${PAI_DIR}/Tools/Inference.ts", "/tmp/project", {
        PAI_DIR: "${PAI_DIR}",
      });

      expect(expanded).toBe("bun /Users/process/.config/opencode/skills/PAI/Tools/Inference.ts");
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("settings env overrides process.env with real value", () => {
    const originalPaiDir = process.env.PAI_DIR;
    process.env.PAI_DIR = "/Users/process/.config/opencode/skills/PAI";

    try {
      const expanded = expandHookCommand("bun ${PAI_DIR}/Tools/Inference.ts", "/tmp/project", {
        PAI_DIR: "/Users/settings/.config/opencode/skills/PAI",
      });

      expect(expanded).toBe("bun /Users/settings/.config/opencode/skills/PAI/Tools/Inference.ts");
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("$HOME inside single quotes is not expanded", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/tmp/pai-hooks-home";

    try {
      const expanded = expandHookCommand("echo '$HOME' $HOME", "/tmp/project");

      expect(expanded).toBe("echo '$HOME' /tmp/pai-hooks-home");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});
