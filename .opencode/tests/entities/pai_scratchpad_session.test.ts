import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { clearScratchpadSession, ensureScratchpadSession } from "../../plugins/lib/scratchpad";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe("scratchpad session workspace", () => {
  test("ensureScratchpadSession(sessionId) uses deterministic directory and does not write scratchpad.json", async () => {
    const xdgHome = await fs.mkdtemp(path.join(os.tmpdir(), "pai-scratchpad-xdg-deterministic-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;

    try {
      process.env.XDG_CONFIG_HOME = xdgHome;

      const scratchpad = await ensureScratchpadSession("ses_deterministic");
      const expectedDir = path.join(
        xdgHome,
        "opencode",
        "scratchpad",
        "sessions",
        "ses_deterministic",
      );

      expect(scratchpad.id).toBe("ses_deterministic");
      expect(scratchpad.dir).toBe(expectedDir);
      await expect(fs.stat(expectedDir)).resolves.toBeTruthy();

      const statePointerPath = path.join(
        xdgHome,
        "opencode",
        "MEMORY",
        "STATE",
        "scratchpad.json",
      );
      await expect(fs.stat(statePointerPath)).rejects.toThrow();
    } finally {
      restoreEnv("XDG_CONFIG_HOME", previousXdg);
      await fs.rm(xdgHome, { recursive: true, force: true });
    }
  });

  test("ensureScratchpadSession(sessionId) sanitizes unsafe characters", async () => {
    const xdgHome = await fs.mkdtemp(path.join(os.tmpdir(), "pai-scratchpad-xdg-sanitize-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;

    try {
      process.env.XDG_CONFIG_HOME = xdgHome;

      const scratchpad = await ensureScratchpadSession("ses/../evil:root");
      const expectedId = "sesevilroot";
      const expectedDir = path.join(
        xdgHome,
        "opencode",
        "scratchpad",
        "sessions",
        expectedId,
      );

      expect(scratchpad.id).toBe(expectedId);
      expect(scratchpad.dir).toBe(expectedDir);
      await expect(fs.stat(expectedDir)).resolves.toBeTruthy();
    } finally {
      restoreEnv("XDG_CONFIG_HOME", previousXdg);
      await fs.rm(xdgHome, { recursive: true, force: true });
    }
  });

  test("ensureScratchpadSession() without sessionId persists pointer state", async () => {
    const xdgHome = await fs.mkdtemp(path.join(os.tmpdir(), "pai-scratchpad-xdg-pointer-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;

    try {
      process.env.XDG_CONFIG_HOME = xdgHome;

      const scratchpad = await ensureScratchpadSession();
      expect(scratchpad.id).toBeTruthy();
      expect(scratchpad.dir).toContain(
        path.join(xdgHome, "opencode", "scratchpad", "sessions"),
      );
      await expect(fs.stat(scratchpad.dir)).resolves.toBeTruthy();

      const statePointerPath = path.join(
        xdgHome,
        "opencode",
        "MEMORY",
        "STATE",
        "scratchpad.json",
      );

      const raw = await fs.readFile(statePointerPath, "utf8");
      const parsed = JSON.parse(raw) as {
        id?: unknown;
        dir?: unknown;
        created_at?: unknown;
      };
      expect(parsed.id).toBe(scratchpad.id);
      expect(parsed.dir).toBe(scratchpad.dir);
      expect(typeof parsed.created_at).toBe("string");
    } finally {
      restoreEnv("XDG_CONFIG_HOME", previousXdg);
      await fs.rm(xdgHome, { recursive: true, force: true });
    }
  });

  test("clearScratchpadSession clears pointer without deleting historical session directory", async () => {
    const xdgHome = await fs.mkdtemp(path.join(os.tmpdir(), "pai-scratchpad-xdg-clear-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;

    try {
      process.env.XDG_CONFIG_HOME = xdgHome;

      const scratchpad = await ensureScratchpadSession();
      const statePointerPath = path.join(
        xdgHome,
        "opencode",
        "MEMORY",
        "STATE",
        "scratchpad.json",
      );

      await expect(fs.stat(statePointerPath)).resolves.toBeTruthy();
      await clearScratchpadSession();
      await expect(fs.stat(statePointerPath)).rejects.toThrow();

      // Historical dir should remain.
      await expect(fs.stat(scratchpad.dir)).resolves.toBeTruthy();
    } finally {
      restoreEnv("XDG_CONFIG_HOME", previousXdg);
      await fs.rm(xdgHome, { recursive: true, force: true });
    }
  });
});
