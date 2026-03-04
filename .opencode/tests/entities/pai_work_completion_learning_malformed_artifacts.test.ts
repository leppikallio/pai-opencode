import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureWorkCompletionSummary } from "../../plugins/handlers/learning-capture";
import { getLearningCategory } from "../../plugins/lib/learning-utils";

type MetaOverrides = {
  title?: string;
  status?: string;
  started_at?: string | null;
  completed_at?: string | null;
  work_id?: string | null;
  source?: string | null;
};

type SessionSetupOptions = {
  yearMonth?: string;
  meta?: MetaOverrides;
  iscJson?: unknown;
  iscRaw?: string;
  lineageJson?: unknown;
  lineageRaw?: string;
};

type SessionFixture = {
  workDir: string;
  yearMonth: string;
  meta: {
    title: string;
    started_at?: string;
    completed_at?: string;
    work_id?: string;
    source?: string;
  };
};

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

async function withTempRoot(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function listMarkdownFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "digest.md") {
        out.push(full);
      }
    }
  };

  await walk(root);
  return out.sort();
}

function buildMeta(sessionId: string, overrides: MetaOverrides | undefined): {
  content: string;
  parsed: SessionFixture["meta"];
} {
  const title = overrides?.title ?? "Work Completion Learning Malformed Artifacts";
  const status = overrides?.status ?? "ACTIVE";
  const startedAt = overrides?.started_at === undefined ? "2099-01-02T03:04:05.000Z" : overrides.started_at;
  const completedAt = overrides?.completed_at;
  const workId = overrides?.work_id === undefined ? `work-${sessionId}` : overrides.work_id;
  const source = overrides?.source;

  const lines = [`status: ${status}`, `title: ${JSON.stringify(title)}`, `opencode_session_id: ${sessionId}`];
  const parsed: SessionFixture["meta"] = { title };

  if (typeof startedAt === "string") {
    lines.splice(1, 0, `started_at: ${startedAt}`);
    parsed.started_at = startedAt;
  }
  if (typeof completedAt === "string") {
    lines.push(`completed_at: ${completedAt}`);
    parsed.completed_at = completedAt;
  }
  if (typeof workId === "string") {
    lines.push(`work_id: ${workId}`);
    parsed.work_id = workId;
  }
  if (typeof source === "string") {
    lines.push(`source: ${source}`);
    parsed.source = source;
  }

  return {
    content: `${lines.join("\n")}\n`,
    parsed,
  };
}

async function setupSession(
  root: string,
  sessionId: string,
  options: SessionSetupOptions = {},
): Promise<SessionFixture> {
  const yearMonth = options.yearMonth ?? "2099-01";
  const workDir = path.join(root, "MEMORY", "WORK", yearMonth, sessionId);
  const stateDir = path.join(root, "MEMORY", "STATE");

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });

  await fs.writeFile(
    path.join(stateDir, "current-work.json"),
    `${JSON.stringify(
      {
        v: "0.2",
        updated_at: "2099-01-02T03:04:05.000Z",
        sessions: {
          [sessionId]: {
            work_dir: workDir,
            started_at: "2099-01-02T03:04:05.000Z",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const meta = buildMeta(sessionId, options.meta);
  await fs.writeFile(path.join(workDir, "META.yaml"), meta.content, "utf8");

  if (options.iscRaw !== undefined) {
    await fs.writeFile(path.join(workDir, "ISC.json"), options.iscRaw, "utf8");
  } else {
    const iscJson = options.iscJson ?? {
      v: "0.1",
      ideal: "",
      criteria: [{ id: "isc-1", text: "Pending criterion", status: "PENDING" }],
      antiCriteria: [],
      updatedAt: "2099-01-02T03:04:05.000Z",
    };
    await fs.writeFile(path.join(workDir, "ISC.json"), `${JSON.stringify(iscJson, null, 2)}\n`, "utf8");
  }

  if (options.lineageRaw !== undefined) {
    await fs.writeFile(path.join(workDir, "LINEAGE.json"), options.lineageRaw, "utf8");
  } else if (options.lineageJson !== undefined) {
    await fs.writeFile(path.join(workDir, "LINEAGE.json"), `${JSON.stringify(options.lineageJson, null, 2)}\n`, "utf8");
  }

  await fs.writeFile(path.join(workDir, "THREAD.md"), "# THREAD\n", "utf8");

  return {
    workDir,
    yearMonth,
    meta: meta.parsed,
  };
}

async function runCapture(
  root: string,
  sessionId: string,
): Promise<Awaited<ReturnType<typeof captureWorkCompletionSummary>>> {
  let result: Awaited<ReturnType<typeof captureWorkCompletionSummary>> | undefined;

  await withEnv(
    {
      OPENCODE_ROOT: root,
      PAI_ENABLE_MEMORY_PARITY: "1",
      PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
      PAI_ENABLE_FINE_GRAIN_LEARNINGS: "0",
    },
    async () => {
      result = await captureWorkCompletionSummary(sessionId);
    },
  );

  return result as Awaited<ReturnType<typeof captureWorkCompletionSummary>>;
}

function fingerprintForWorkCompletionSummary(
  sessionId: string,
  stableWorkId: string,
  stableStartedAt: string,
  stableYearMonth: string,
): string {
  return createHash("sha1")
    .update([sessionId, stableWorkId, stableStartedAt, stableYearMonth].join("|"))
    .digest("hex")
    .slice(0, 10);
}

function buildWorkCompletionSummaryText(args: {
  title: string;
  verifiedIscCount: number;
  criteriaSummary: string;
  antiCriteriaSummary: string;
  applyPatchCount: number;
  writeCount: number;
  editCount: number;
}): string {
  return [
    `Work session title: ${args.title}`,
    `Verified ISC criteria: ${args.verifiedIscCount}`,
    `ISC criteria: ${args.criteriaSummary}`,
    `ISC anti-criteria: ${args.antiCriteriaSummary}`,
    `Lineage edit tools: apply_patch=${args.applyPatchCount}, write=${args.writeCount}, edit=${args.editCount}`,
  ].join("\n");
}

describe("work completion learning malformed/negative invariants", () => {
  test("Case A: malformed ISC + significant LINEAGE writes with Not specified criteria", async () => {
    await withTempRoot("pai-work-completion-case-a-", async (root) => {
      const sessionId = "session_case_a";
      await setupSession(root, sessionId, {
        iscRaw: "{ malformed json",
        lineageJson: {
          v: "0.1",
          updated_at: "2099-01-02T03:04:05.000Z",
          tools_used: { apply_patch: 1 },
          agents_spawned: [],
        },
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(true);

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);

      const content = await fs.readFile(files[0], "utf8");
      expect(content).toContain("# Work Completion Learning");
      expect(content).toContain("ISC criteria: Not specified");
    });
  });

  test("Case B: missing/malformed LINEAGE + verified ISC still writes", async () => {
    await withTempRoot("pai-work-completion-case-b-", async (root) => {
      const sessionId = "session_case_b";
      await setupSession(root, sessionId, {
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Verified criterion", status: "VERIFIED" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
        lineageRaw: "{ malformed lineage",
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(true);

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);
    });
  });

  test("Case C: missing work_id + missing started_at uses deterministic month fallback and one file", async () => {
    await withTempRoot("pai-work-completion-case-c-", async (root) => {
      const sessionId = "session_case_c";
      const yearMonth = "2042-11";
      await setupSession(root, sessionId, {
        yearMonth,
        meta: {
          started_at: null,
          work_id: null,
          title: "Deterministic fallback",
        },
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Verified fallback criterion", status: "VERIFIED" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
      });

      const first = await runCapture(root, sessionId);
      const second = await runCapture(root, sessionId);

      expect(first.success).toBe(true);
      expect(first.written).toBe(true);
      expect(second.success).toBe(true);
      expect(second.written).toBe(false);

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(`${path.sep}${yearMonth}${path.sep}`);
      expect(path.basename(files[0])).toContain(`${sessionId}_work_completion_learning_`);
    });
  });

  test("Case D: read/search-only tools + no verified ISC + non-MANUAL source does not write", async () => {
    await withTempRoot("pai-work-completion-case-d-", async (root) => {
      const sessionId = "session_case_d";
      await setupSession(root, sessionId, {
        meta: { source: "AUTO" },
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Pending criterion", status: "PENDING" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
        lineageJson: {
          v: "0.1",
          updated_at: "2099-01-02T03:04:05.000Z",
          tools_used: { read: 4, grep: 2, glob: 3 },
          agents_spawned: [],
        },
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(false);
      expect(result.reason).toBe("insignificant-work");

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(0);
    });
  });

  test("Case E: agents_spawned-only lineage + no verified ISC + non-MANUAL source does not write", async () => {
    await withTempRoot("pai-work-completion-case-e-", async (root) => {
      const sessionId = "session_case_e";
      await setupSession(root, sessionId, {
        meta: { source: "AUTO" },
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Pending criterion", status: "PENDING" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
        lineageJson: {
          v: "0.1",
          updated_at: "2099-01-02T03:04:05.000Z",
          tools_used: {},
          agents_spawned: [{ type: "Engineer", id: "agent-1" }],
        },
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(false);
      expect(result.reason).toBe("insignificant-work");

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(0);
    });
  });

  test("Case F: MANUAL source with insignificant lineage still writes when ISC is verified", async () => {
    await withTempRoot("pai-work-completion-case-f-", async (root) => {
      const sessionId = "session_case_f";
      await setupSession(root, sessionId, {
        meta: { source: "MANUAL" },
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Manual verified criterion", status: "VERIFIED" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
        lineageJson: {
          v: "0.1",
          updated_at: "2099-01-02T03:04:05.000Z",
          tools_used: { read: 1, grep: 1, glob: 1 },
          agents_spawned: [],
        },
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(true);

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);
    });
  });

  test("Case G: upstream-ish ISC current.criteria/current.antiCriteria renders in summary", async () => {
    await withTempRoot("pai-work-completion-case-g-", async (root) => {
      const sessionId = "session_case_g";
      await setupSession(root, sessionId, {
        iscJson: {
          v: "0.1",
          current: {
            criteria: ["Ship parity", "Keep deterministic outputs"],
            antiCriteria: ["Avoid runtime-only hacks"],
          },
        },
        lineageJson: {
          v: "0.1",
          updated_at: "2099-01-02T03:04:05.000Z",
          tools_used: { apply_patch: 1 },
          agents_spawned: [],
        },
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(true);

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);

      const content = await fs.readFile(files[0], "utf8");
      expect(content).toContain("ISC criteria: Ship parity; Keep deterministic outputs");
      expect(content).toContain("ISC anti-criteria: Avoid runtime-only hacks");
    });
  });

  test("Case H: month bucketing uses META.started_at month, not wall clock", async () => {
    await withTempRoot("pai-work-completion-case-h-", async (root) => {
      const sessionId = "session_case_h";
      const startedAt = "2011-02-10T08:09:10.000Z";
      await setupSession(root, sessionId, {
        yearMonth: "2099-12",
        meta: {
          started_at: startedAt,
          work_id: "work-case-h",
        },
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Verified criterion", status: "VERIFIED" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
      });

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(true);

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);

      const rel = path.relative(path.join(root, "MEMORY", "LEARNING"), files[0]);
      const bucketMonth = rel.split(path.sep)[1];
      const wallClockMonth = new Date().toISOString().slice(0, 7);

      expect(bucketMonth).toBe("2011-02");
      expect(bucketMonth).not.toBe(wallClockMonth);
    });
  });

  test("Case I: category-drift dedupe blocks second file for same fingerprint/month", async () => {
    await withTempRoot("pai-work-completion-case-i-", async (root) => {
      const sessionId = "session_case_i";
      const startedAt = "2015-07-08T09:10:11.000Z";
      const workId = "work-case-i";
      const yearMonth = "2015-07";
      const title = "Category drift dedupe";

      await setupSession(root, sessionId, {
        yearMonth: "2099-12",
        meta: {
          title,
          started_at: startedAt,
          work_id: workId,
        },
        iscJson: {
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Verified drift criterion", status: "VERIFIED" }],
          antiCriteria: [],
          updatedAt: "2099-01-02T03:04:05.000Z",
        },
        lineageJson: {
          v: "0.1",
          updated_at: "2099-01-02T03:04:05.000Z",
          tools_used: { apply_patch: 1 },
          agents_spawned: [],
        },
      });

      const summaryText = buildWorkCompletionSummaryText({
        title,
        verifiedIscCount: 1,
        criteriaSummary: "Verified drift criterion",
        antiCriteriaSummary: "(none)",
        applyPatchCount: 1,
        writeCount: 0,
        editCount: 0,
      });
      const category = getLearningCategory(summaryText, title);
      const oppositeCategory = category === "ALGORITHM" ? "SYSTEM" : "ALGORITHM";
      const fingerprint = fingerprintForWorkCompletionSummary(sessionId, workId, startedAt, yearMonth);

      const preseedPath = path.join(
        root,
        "MEMORY",
        "LEARNING",
        oppositeCategory,
        yearMonth,
        `preseed_work_completion_learning_${fingerprint}.md`,
      );
      await fs.mkdir(path.dirname(preseedPath), { recursive: true });
      await fs.writeFile(preseedPath, "# Existing drift entry\n", "utf8");

      const result = await runCapture(root, sessionId);
      expect(result.success).toBe(true);
      expect(result.written).toBe(false);
      expect(result.reason).toBe("already-exists");

      const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
      expect(files).toHaveLength(1);
      expect(path.resolve(files[0])).toBe(path.resolve(preseedPath));
    });
  });
});
