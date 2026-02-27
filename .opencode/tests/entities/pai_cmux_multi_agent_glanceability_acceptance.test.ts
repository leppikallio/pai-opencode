import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emitAmbient, emitInterrupt } from "../../hooks/lib/cmux-attention";
import { normalizeReasonShort } from "../../hooks/lib/cmux-attention-types";
import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

type LogicalSession = {
  sessionId: string;
  state: "running" | "question" | "blocked" | "failed" | "completed";
  eventKey?: "QUESTION_PENDING" | "AGENT_BLOCKED" | "AGENT_FAILED" | "AGENT_COMPLETED";
  reasonShort?: string;
};

function cleanupPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function readFlagArg(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1) {
    return "";
  }

  return args[index + 1] ?? "";
}

describe("cmux multi-agent glanceability acceptance", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("keeps unresolved interrupts pending, trims reason, suppresses duplicate bursts, and mirrors active workspace", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-runtime-"));
    const stub = createQueuedCmuxCliExecStub(
      Array.from({ length: 25 }, () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        signal: null,
        timedOut: false,
      })),
      { onEmpty: "throw" },
    );

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    const duplicateQuestionReason = "Need deploy approval for release";
    const duplicateCompletionReason = "Done: bundle docs";
    const longQuestionReason =
      "Need approval after full release candidate checks and smoke tests";

    const logicalSessions: LogicalSession[] = [
      { sessionId: "ses-running-1", state: "running" },
      { sessionId: "ses-running-2", state: "running" },
      { sessionId: "ses-running-3", state: "running" },
      {
        sessionId: "ses-question-1",
        state: "question",
        eventKey: "QUESTION_PENDING",
        reasonShort: duplicateQuestionReason,
      },
      {
        sessionId: "ses-question-2",
        state: "question",
        eventKey: "QUESTION_PENDING",
        reasonShort: longQuestionReason,
      },
      {
        sessionId: "ses-blocked-1",
        state: "blocked",
        eventKey: "AGENT_BLOCKED",
        reasonShort: "Waiting for lock",
      },
      {
        sessionId: "ses-failed-1",
        state: "failed",
        eventKey: "AGENT_FAILED",
        reasonShort: "Tests failed",
      },
      {
        sessionId: "ses-completed-1",
        state: "completed",
        eventKey: "AGENT_COMPLETED",
        reasonShort: duplicateCompletionReason,
      },
      {
        sessionId: "ses-completed-2",
        state: "completed",
        eventKey: "AGENT_COMPLETED",
        reasonShort: "Done: build package",
      },
      {
        sessionId: "ses-completed-3",
        state: "completed",
        eventKey: "AGENT_COMPLETED",
        reasonShort: "Done: sync docs",
      },
    ];

    __testOnlySetCmuxCliExec(stub.exec);

    delete process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_WORKSPACE_ID = "workspace-acceptance";
    process.env.CMUX_SURFACE_ID = "surface-acceptance";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_FLASH_ON_P0 = "0";

    try {
      for (const session of logicalSessions) {
        if (session.state === "running") {
          continue;
        }

        if (session.eventKey === "AGENT_COMPLETED") {
          await emitAmbient({
            eventKey: session.eventKey,
            sessionId: session.sessionId,
            reasonShort: session.reasonShort,
          });
          continue;
        }

        await emitInterrupt({
          eventKey: session.eventKey!,
          sessionId: session.sessionId,
          reasonShort: session.reasonShort,
        });
      }

      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses-question-1",
        reasonShort: duplicateQuestionReason,
      });

      await emitAmbient({
        eventKey: "AGENT_COMPLETED",
        sessionId: "ses-completed-1",
        reasonShort: duplicateCompletionReason,
      });

      const notificationCalls = stub.calls.filter((call) => call.args[0] === "notify");
      expect(notificationCalls).toHaveLength(7);

      for (const call of notificationCalls) {
        expect(readFlagArg(call.args, "--workspace")).toBe("workspace-acceptance");
        expect(readFlagArg(call.args, "--surface")).toBe("surface-acceptance");
      }

      const unresolvedExpected = logicalSessions.filter((session) => {
        return (
          session.state === "question" || session.state === "blocked" || session.state === "failed"
        );
      }).length;

      const unresolvedNotifications = notificationCalls.filter((call) => {
        const subtitle = readFlagArg(call.args, "--subtitle");
        return subtitle.endsWith("P0") || subtitle.endsWith("P1");
      });

      expect(unresolvedNotifications).toHaveLength(unresolvedExpected);

      for (const call of unresolvedNotifications) {
        const body = readFlagArg(call.args, "--body");
        expect(body.length).toBeGreaterThan(0);
        expect(body.length).toBeLessThanOrEqual(60);
      }

      expect(
        unresolvedNotifications.some((call) => readFlagArg(call.args, "--body") === normalizeReasonShort(longQuestionReason)),
      ).toBe(true);

      const duplicateQuestionCount = notificationCalls.filter((call) => {
        return (
          readFlagArg(call.args, "--subtitle") === "Question P0" &&
          readFlagArg(call.args, "--body") === duplicateQuestionReason
        );
      }).length;

      expect(duplicateQuestionCount).toBe(1);

      const duplicateCompletionCount = notificationCalls.filter((call) => {
        return (
          readFlagArg(call.args, "--subtitle") === "Completed P2" &&
          readFlagArg(call.args, "--body") === duplicateCompletionReason
        );
      }).length;

      expect(duplicateCompletionCount).toBe(1);

      expect(
        stub.calls.some((call) => call.args[0] === "set-status" && call.args[1] === "oc_attention"),
      ).toBe(true);
      expect(
        stub.calls.some((call) => call.args[0] === "set-status" && call.args[1] === "oc_phase"),
      ).toBe(true);
      expect(stub.calls.some((call) => call.args[0] === "set-progress")).toBe(true);

      expect(
        stub.calls.some((call) => call.args[0] === "clear-status" && call.args[1] === "oc_attention"),
      ).toBe(false);
      expect(stub.calls.some((call) => call.args[0] === "clear-progress")).toBe(false);
      expect(stub.calls.some((call) => call.args[0] === "trigger-flash")).toBe(false);
    } finally {
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_FLASH_ON_P0", previousFlashOnP0);
    }
  });
});
