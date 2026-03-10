import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadContextBundle } from "../../hooks/lib/context-loader";
import {
  getWisdomProjectionPath,
  updateWisdomProjection,
} from "../../plugins/handlers/wisdom-projection";

async function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function seedWisdomSources(root: string, includeActiveWork: boolean): Promise<void> {
  await fs.mkdir(path.join(root, "MEMORY", "LEARNING", "ALGORITHM", "2026-03"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "LEARNING", "SYSTEM", "2026-03"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "LEARNING", "REFLECTIONS"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "STATE"), { recursive: true });

  await fs.writeFile(
    path.join(root, "MEMORY", "LEARNING", "ALGORITHM", "2026-03", "2026-03-09_work_completion_learning_aaa111bbb2.md"),
    [
      "# Work Completion Learning",
      "",
      "**Session:** ses_parent",
      "**Source:** WORK_COMPLETION",
      "",
      "## What Was Done",
      "",
      "Verified ISC criteria before completion and reconciled progress.",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    path.join(root, "MEMORY", "LEARNING", "SYSTEM", "2026-03", "2026-03-09_orchestration_note_ccc333ddd4.md"),
    [
      "# Delegation Notes",
      "",
      "Delegation failed when stale background task fan-in was skipped.",
      "Parallel batching improved once concurrency was bounded.",
      "Compaction recovery worked after continuation hints were restored.",
      "",
    ].join("\n"),
    "utf8",
  );

  const reflectionLines = [
    {
      timestamp: "2026-03-10T09:00:00.000Z",
      task_description: "orchestration cleanup",
      implied_sentiment: 3,
      reflection_q1: "Delegation failed after stale background tasks were ignored",
      reflection_q2: "Need stronger completion verification before closeout",
      reflection_q3: "Compaction recovery should preserve continuation hints",
    },
    {
      timestamp: "2026-03-10T10:00:00.000Z",
      task_description: "parallel fan-in refinement",
      implied_sentiment: 9,
      reflection_q1: "Parallel execution succeeded with bounded concurrency groups",
      reflection_q2: "Verified ISC checks improved reliability",
      reflection_q3: "Parent fan-in reduced delegation regressions",
    },
  ].map((entry) => JSON.stringify(entry));

  await fs.writeFile(
    path.join(root, "MEMORY", "LEARNING", "REFLECTIONS", "algorithm-reflections.jsonl"),
    `${reflectionLines.join("\n")}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(root, "MEMORY", "STATE", "background-tasks.json"),
    `${JSON.stringify({
      version: 2,
      updatedAtMs: 100,
      notifiedTaskIds: {},
      duplicateBySession: {},
      backgroundTasks: {
        task_done: {
          task_id: "task_done",
          child_session_id: "ses_child_done",
          parent_session_id: "ses_parent",
          launched_at_ms: 10,
          updated_at_ms: 20,
          completed_at_ms: 20,
          status: "completed",
          terminal_reason: "completed",
          concurrency_group: "grp-a",
        },
        task_failed: {
          task_id: "task_failed",
          child_session_id: "ses_child_failed",
          parent_session_id: "ses_parent",
          launched_at_ms: 11,
          updated_at_ms: 25,
          completed_at_ms: 25,
          status: "failed",
          terminal_reason: "failed",
          launch_error: "timeout",
          concurrency_group: "grp-a",
        },
        task_stale: {
          task_id: "task_stale",
          child_session_id: "ses_child_stale",
          parent_session_id: "ses_parent",
          launched_at_ms: 12,
          updated_at_ms: 30,
          completed_at_ms: 30,
          status: "stale",
          terminal_reason: "stale",
          concurrency_group: "grp-b",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(root, "MEMORY", "STATE", "compaction-continuity.json"),
    `${JSON.stringify({
      v: "0.1",
      updatedAt: "2026-03-10T10:30:00.000Z",
      sessions: {
        ses_parent: {
          snapshotAt: "2026-03-10T10:00:00.000Z",
          lastRestoredAt: "2026-03-10T10:20:00.000Z",
          restoreCount: 2,
          derived: {
            schema: "pai.compaction.derived.continuity.v1",
            updatedAt: "2026-03-10T10:20:00.000Z",
            continuationHints: [
              "Resume from next unfinished ISC and reconcile background fan-in.",
            ],
          },
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const currentWork = includeActiveWork
    ? {
      v: "0.2",
      updated_at: "2026-03-10T11:00:00.000Z",
      session_id: "ses_parent",
      sessions: {
        ses_parent: {
          work_dir: path.join(root, "MEMORY", "WORK", "2026-03", "ses_parent"),
          started_at: "2026-03-10T09:00:00.000Z",
        },
      },
    }
    : {
      v: "0.2",
      updated_at: "2026-03-10T11:00:00.000Z",
      sessions: {},
    };

  await fs.writeFile(
    path.join(root, "MEMORY", "STATE", "current-work.json"),
    `${JSON.stringify(currentWork, null, 2)}\n`,
    "utf8",
  );
}

function extractTaggedSection(content: string, tagName: string): string | null {
  const rawMatch = content.match(new RegExp(`<${tagName}>\\n([\\s\\S]*?)\\n</${tagName}>`));
  if (rawMatch?.[1]) {
    return rawMatch[1];
  }

  const escapedOpen = `&lt;${tagName}&gt;`;
  const escapedClose = `&lt;/${tagName}&gt;`;
  const escapedPattern = new RegExp(`${escapedOpen}\\n([\\s\\S]*?)\\n${escapedClose}`);
  const escapedMatch = content.match(escapedPattern);
  return escapedMatch?.[1] ?? null;
}

describe("learning wisdom projection", () => {
  test("flag OFF keeps wisdom projection slice disabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-wisdom-projection-off-"));

    try {
      await seedWisdomSources(root, true);

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED: "0",
        },
        async () => {
          const result = await updateWisdomProjection();
          expect(result.success).toBe(true);
          expect(result.written).toBe(false);
          expect(result.reason).toBe("wisdom-projection-disabled");

          await expect(fs.stat(getWisdomProjectionPath())).rejects.toBeDefined();

          const bundle = loadContextBundle(root);
          expect(bundle.combinedContent).not.toContain("&lt;orchestration-wisdom-summary&gt;");
          expect(bundle.combinedContent).not.toContain("[score:");
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("flag ON emits and injects bounded wisdom projection slice", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-wisdom-projection-on-"));

    try {
      await seedWisdomSources(root, true);

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED: "1",
        },
        async () => {
          const result = await updateWisdomProjection();
          expect(result.success).toBe(true);
          expect(result.written).toBe(true);
          expect(result.summary?.sourceCoverage.learningEntries).toBeGreaterThan(0);
          expect(result.summary?.sourceCoverage.reflections).toBeGreaterThan(0);
          expect(result.summary?.sourceCoverage.backgroundTaskOutcomes).toBeGreaterThan(0);
          expect(result.summary?.sourceCoverage.compactionRecoveryOutcomes).toBeGreaterThan(0);

          const projectionPath = getWisdomProjectionPath();
          expect(projectionPath).toBe(path.join(root, "MEMORY", "LEARNING", "wisdom-projection.md"));

          const projection = await fs.readFile(projectionPath, "utf8");
          expect(projection).toContain("# Orchestration Wisdom Projection");
          expect(projection).toContain("## Source Coverage");
          expect(projection).toContain("## Wisdom");
          expect(projection).toContain("delegation");
          expect(projection).toContain("compaction");
          expect(projection).toContain("Parallelism");

          const rankedWisdomLines = projection
            .split(/\r?\n/)
            .filter((line) => line.trim().startsWith("- [score:"));
          expect(rankedWisdomLines.length).toBeGreaterThan(0);
          expect(rankedWisdomLines.length).toBeLessThanOrEqual(4);

          const bundle = loadContextBundle(root);
          expect(bundle.combinedContent).toContain("&lt;orchestration-wisdom-summary&gt;");
          const wisdomSection = extractTaggedSection(bundle.combinedContent, "orchestration-wisdom-summary");
          expect(wisdomSection).not.toBeNull();

          const wisdomLines = (wisdomSection ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith("- "));

          expect(wisdomLines.length).toBeGreaterThan(0);
          expect(wisdomLines.length).toBeLessThanOrEqual(4);
          expect(Buffer.byteLength(wisdomLines.join("\n"), "utf8")).toBeLessThanOrEqual(720);
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("retrieval trigger requires active work session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-wisdom-projection-trigger-"));

    try {
      await seedWisdomSources(root, false);

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED: "1",
        },
        async () => {
          const result = await updateWisdomProjection();
          expect(result.success).toBe(true);
          expect(result.written).toBe(true);

          const projection = await fs.readFile(getWisdomProjectionPath(), "utf8");
          expect(projection).toContain("- [score:");

          const bundleWithoutActiveWork = loadContextBundle(root);
          const wisdomSectionWithoutActiveWork = extractTaggedSection(
            bundleWithoutActiveWork.combinedContent,
            "orchestration-wisdom-summary",
          );
          expect(wisdomSectionWithoutActiveWork).toBeNull();
          expect(bundleWithoutActiveWork.combinedContent).not.toContain("&lt;orchestration-wisdom-summary&gt;");

          await fs.writeFile(
            path.join(root, "MEMORY", "STATE", "current-work.json"),
            `${JSON.stringify({
              v: "0.2",
              updated_at: "2026-03-10T11:30:00.000Z",
              session_id: "ses_parent",
              sessions: {
                ses_parent: {
                  work_dir: path.join(root, "MEMORY", "WORK", "2026-03", "ses_parent"),
                  started_at: "2026-03-10T09:00:00.000Z",
                },
              },
            }, null, 2)}\n`,
            "utf8",
          );

          const bundleWithActiveWork = loadContextBundle(root);
          const wisdomSectionWithActiveWork = extractTaggedSection(
            bundleWithActiveWork.combinedContent,
            "orchestration-wisdom-summary",
          );
          expect(wisdomSectionWithActiveWork).not.toBeNull();
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
