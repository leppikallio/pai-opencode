import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisFileDir, "..", "..", "..");

type PrdOptions = {
  slug: string;
  task: string;
  updated?: string;
};

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

function buildPrdContent(args: PrdOptions): string {
  const updatedLine = args.updated ? `updated: ${args.updated}` : "";

  return `---
task: ${args.task}
slug: ${args.slug}
effort: standard
phase: observe
progress: 0/1
mode: interactive
started: 2026-03-04T08:00:00.000Z
${updatedLine}
---

## Criteria

- [ ] ISC-1: Backfill indexes deterministic canonical PRD entries
`;
}

async function runBackfill(runtimeRoot: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/WorkJsonBackfill.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: runtimeRoot,
      OPENCODE_CONFIG_ROOT: runtimeRoot,
      PAI_DIR: runtimeRoot,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

function sessionEntries(
  sessions: Record<string, { sessionUUID?: string; prdPath?: string }>,
  sessionUUID: string,
): Array<[string, { sessionUUID?: string; prdPath?: string }]> {
  return Object.entries(sessions).filter(([, entry]) => entry.sessionUUID === sessionUUID);
}

describe("WorkJsonBackfill", () => {
  test("indexes deterministic canonical PRDs and stays idempotent", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-workjson-backfill-"));
    const workRoot = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03");
    const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");

    const sessionPreferV2 = "session-backfill-v2";
    const sessionPreferDash = "session-backfill-dash";
    const sessionUpdatedTie = "session-backfill-updated";
    const sessionMtimeTie = "session-backfill-mtime";
    const sessionLexTie = "session-backfill-lex";

    const sessionDirs = {
      [sessionPreferV2]: path.join(workRoot, sessionPreferV2),
      [sessionPreferDash]: path.join(workRoot, sessionPreferDash),
      [sessionUpdatedTie]: path.join(workRoot, sessionUpdatedTie),
      [sessionMtimeTie]: path.join(workRoot, sessionMtimeTie),
      [sessionLexTie]: path.join(workRoot, sessionLexTie),
    };

    try {
      await mkdir(workRoot, { recursive: true });
      await mkdir(stateDir, { recursive: true });

      for (const dir of Object.values(sessionDirs)) {
        await mkdir(dir, { recursive: true });
      }

      const preferV2LegacyDash = path.join(sessionDirs[sessionPreferV2], "PRD-20260304-legacy.md");
      const preferV2Canonical = path.join(sessionDirs[sessionPreferV2], "PRD.md");
      await writeFile(
        preferV2LegacyDash,
        buildPrdContent({
          task: "Legacy Dash",
          slug: "legacy-dash-slug",
          updated: "2026-03-06T00:00:00.000Z",
        }),
        "utf8",
      );
      await writeFile(
        preferV2Canonical,
        buildPrdContent({
          task: "Prefer Identity Slug",
          slug: "20260304-120000-prefer-identity-slug-a1b2c3d4",
          updated: "2026-03-04T00:00:00.000Z",
        }),
        "utf8",
      );

      const preferDashPrdMd = path.join(sessionDirs[sessionPreferDash], "PRD.md");
      const preferDashCanonical = path.join(sessionDirs[sessionPreferDash], "PRD-20260304-canonical.md");
      await writeFile(
        preferDashPrdMd,
        buildPrdContent({
          task: "PRD md v2",
          slug: "20260304-120000-prd-md-v2-d4c3b2a1",
          updated: "2026-03-07T00:00:00.000Z",
        }),
        "utf8",
      );
      await writeFile(
        preferDashCanonical,
        buildPrdContent({
          task: "Prefer PRD Dash",
          slug: "20260304-120000-prefer-prd-dash-1a2b3c4d",
          updated: "2026-03-04T00:00:00.000Z",
        }),
        "utf8",
      );

      const updatedOlder = path.join(sessionDirs[sessionUpdatedTie], "PRD-20260304-older.md");
      const updatedNewer = path.join(sessionDirs[sessionUpdatedTie], "PRD-20260304-newer.md");
      await writeFile(
        updatedOlder,
        buildPrdContent({
          task: "Older Updated",
          slug: "legacy-updated-older",
          updated: "2026-03-04T08:00:00.000Z",
        }),
        "utf8",
      );
      await writeFile(
        updatedNewer,
        buildPrdContent({
          task: "Newer Updated",
          slug: "legacy-updated-newer",
          updated: "2026-03-04T09:00:00.000Z",
        }),
        "utf8",
      );

      const mtimeOlder = path.join(sessionDirs[sessionMtimeTie], "PRD-20260304-mtime-older.md");
      const mtimeNewer = path.join(sessionDirs[sessionMtimeTie], "PRD-20260304-mtime-newer.md");
      await writeFile(mtimeOlder, buildPrdContent({ task: "Mtime Older", slug: "legacy-mtime-older" }), "utf8");
      await writeFile(mtimeNewer, buildPrdContent({ task: "Mtime Newer", slug: "legacy-mtime-newer" }), "utf8");
      await utimes(mtimeOlder, new Date("2026-03-04T10:00:00.000Z"), new Date("2026-03-04T10:00:00.000Z"));
      await utimes(mtimeNewer, new Date("2026-03-04T11:00:00.000Z"), new Date("2026-03-04T11:00:00.000Z"));

      const lexA = path.join(sessionDirs[sessionLexTie], "PRD-20260304-lex-a.md");
      const lexB = path.join(sessionDirs[sessionLexTie], "PRD-20260304-lex-b.md");
      await writeFile(lexA, buildPrdContent({ task: "Lex A", slug: "legacy-lex-a" }), "utf8");
      await writeFile(lexB, buildPrdContent({ task: "Lex B", slug: "legacy-lex-b" }), "utf8");
      await utimes(lexA, new Date("2026-03-04T12:00:00.000Z"), new Date("2026-03-04T12:00:00.000Z"));
      await utimes(lexB, new Date("2026-03-04T12:00:00.000Z"), new Date("2026-03-04T12:00:00.000Z"));

      const workJsonPath = path.join(stateDir, "work.json");
      await writeFile(
        workJsonPath,
        `${JSON.stringify(
          {
            v: "0.1",
            updatedAt: "2026-03-04T00:00:00.000Z",
            sessions: {
              "dup-old-1": {
                sessionUUID: sessionUpdatedTie,
                targetKey: "dup-old-1",
                source: "placeholder",
                criteria: [],
                updatedAt: "2026-03-04T00:00:00.000Z",
              },
              "dup-old-2": {
                sessionUUID: sessionUpdatedTie,
                targetKey: "dup-old-2",
                source: "placeholder",
                criteria: [],
                updatedAt: "2026-03-04T00:00:01.000Z",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const firstRun = await runBackfill(runtimeRoot);
      expect(firstRun.exitCode).toBe(0);

      const firstState = JSON.parse(await readFile(workJsonPath, "utf8")) as {
        sessions?: Record<string, { sessionUUID?: string; prdPath?: string }>;
      };
      const sessions = firstState.sessions ?? {};

      expect(sessionEntries(sessions, sessionPreferV2)).toHaveLength(1);
      expect(sessionEntries(sessions, sessionPreferDash)).toHaveLength(1);
      expect(sessionEntries(sessions, sessionUpdatedTie)).toHaveLength(1);
      expect(sessionEntries(sessions, sessionMtimeTie)).toHaveLength(1);
      expect(sessionEntries(sessions, sessionLexTie)).toHaveLength(1);

      const indexedPathsBySession = new Map(
        Object.values(sessions)
          .filter((entry): entry is { sessionUUID: string; prdPath: string } =>
            typeof entry.sessionUUID === "string" && typeof entry.prdPath === "string",
          )
          .map((entry) => [entry.sessionUUID, path.resolve(entry.prdPath)]),
      );

      expect(indexedPathsBySession.get(sessionPreferV2)).toBe(path.resolve(preferV2Canonical));
      expect(indexedPathsBySession.get(sessionPreferDash)).toBe(path.resolve(preferDashCanonical));
      expect(indexedPathsBySession.get(sessionUpdatedTie)).toBe(path.resolve(updatedNewer));
      expect(indexedPathsBySession.get(sessionMtimeTie)).toBe(path.resolve(mtimeNewer));
      expect(indexedPathsBySession.get(sessionLexTie)).toBe(path.resolve(lexA));

      const secondRun = await runBackfill(runtimeRoot);
      expect(secondRun.exitCode).toBe(0);

      const secondState = JSON.parse(await readFile(workJsonPath, "utf8")) as {
        sessions?: Record<string, { sessionUUID?: string; prdPath?: string }>;
      };
      const secondSessions = secondState.sessions ?? {};

      expect(sessionEntries(secondSessions, sessionPreferV2)).toHaveLength(1);
      expect(sessionEntries(secondSessions, sessionPreferDash)).toHaveLength(1);
      expect(sessionEntries(secondSessions, sessionUpdatedTie)).toHaveLength(1);
      expect(sessionEntries(secondSessions, sessionMtimeTie)).toHaveLength(1);
      expect(sessionEntries(secondSessions, sessionLexTie)).toHaveLength(1);

      const secondIndexedPathsBySession = new Map(
        Object.values(secondSessions)
          .filter((entry): entry is { sessionUUID: string; prdPath: string } =>
            typeof entry.sessionUUID === "string" && typeof entry.prdPath === "string",
          )
          .map((entry) => [entry.sessionUUID, path.resolve(entry.prdPath)]),
      );

      expect(secondIndexedPathsBySession).toEqual(indexedPathsBySession);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
