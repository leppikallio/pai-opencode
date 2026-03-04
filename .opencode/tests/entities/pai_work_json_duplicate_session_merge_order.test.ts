import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { upsertWorkSessionFromEvent } from "../../hooks/lib/prd-utils";

describe("upsertWorkSessionFromEvent duplicate baseline selection", () => {
  test("chooses deterministic best existing entry before merge", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-dup-order-"));
    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousOpenCodeConfigRoot = process.env.OPENCODE_CONFIG_ROOT;
    const sessionUUID = "session-prdsync-dup-order";
    const workPath = path.join(runtimeRoot, "MEMORY", "STATE", "work.json");

    try {
      process.env.OPENCODE_ROOT = runtimeRoot;
      process.env.OPENCODE_CONFIG_ROOT = runtimeRoot;

      await mkdir(path.dirname(workPath), { recursive: true });
      await writeFile(
        workPath,
        `${JSON.stringify(
          {
            v: "0.1",
            updatedAt: "2026-03-04T00:00:00.000Z",
            sessions: {
              zzz: {
                sessionUUID,
                targetKey: "zzz",
                source: "placeholder",
                prdPath: "/tmp/zzz.md",
                task: "from-zzz",
                criteria: [],
                updatedAt: "2026-03-04T12:00:00.000Z",
              },
              aaa: {
                sessionUUID,
                targetKey: "aaa",
                source: "prd",
                task: "from-aaa",
                criteria: [],
                updatedAt: "2026-03-04T12:00:00.000Z",
              },
              ccc: {
                sessionUUID,
                targetKey: "ccc",
                source: "prd",
                prdPath: "/tmp/ccc.md",
                task: "from-ccc",
                criteria: [],
                updatedAt: "2026-03-04T12:00:00.000Z",
              },
              ddd: {
                sessionUUID,
                targetKey: "ddd",
                source: "prd",
                prdPath: "/tmp/ddd.md",
                task: "from-ddd",
                criteria: [],
                updatedAt: "2026-03-04T12:00:00.000Z",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const result = await upsertWorkSessionFromEvent({
        sessionUUID,
        targetKey: "merged-key",
        source: "placeholder",
        entry: {
          criteria: [],
        },
      });

      expect(result.applied).toBe(true);

      const stateRaw = await readFile(workPath, "utf8");
      const state = JSON.parse(stateRaw) as {
        sessions?: Record<string, { sessionUUID?: string; task?: string; prdPath?: string }>;
      };

      const sessionEntries = Object.entries(state.sessions ?? {}).filter(
        ([, entry]) => entry.sessionUUID === sessionUUID,
      );
      expect(sessionEntries).toHaveLength(1);

      const merged = state.sessions?.["merged-key"];
      expect(merged?.task).toBe("from-ccc");
      expect(merged?.prdPath).toBe("/tmp/ccc.md");
    } finally {
      if (previousOpenCodeRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousOpenCodeRoot;
      }

      if (previousOpenCodeConfigRoot === undefined) {
        delete process.env.OPENCODE_CONFIG_ROOT;
      } else {
        process.env.OPENCODE_CONFIG_ROOT = previousOpenCodeConfigRoot;
      }

      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
