#!/usr/bin/env bun

import type { Type } from "cmd-ts";
import {
  runSafely,
  subcommands,
} from "cmd-ts";

import { createAgentResultCmd } from "./deep-research-option-c/cmd/agent-result";
import { createCancelCmd } from "./deep-research-option-c/cmd/cancel";
import { createCaptureFixturesCmd } from "./deep-research-option-c/cmd/capture-fixtures";
import { createInitCmd } from "./deep-research-option-c/cmd/init";
import { createInspectCmd } from "./deep-research-option-c/cmd/inspect";
import { createPauseCmd } from "./deep-research-option-c/cmd/pause";
import { createPerspectivesDraftCmd } from "./deep-research-option-c/cmd/perspectives-draft";
import { createResumeCmd } from "./deep-research-option-c/cmd/resume";
import { createRerunCmd } from "./deep-research-option-c/cmd/rerun";
import { createRunCmd } from "./deep-research-option-c/cmd/run";
import { createStageAdvanceCmd } from "./deep-research-option-c/cmd/stage-advance";
import { createStatusCmd } from "./deep-research-option-c/cmd/status";
import { createTickCmd } from "./deep-research-option-c/cmd/tick";
import { createTriageCmd } from "./deep-research-option-c/cmd/triage";
import {
  runAgentResult,
} from "./deep-research-option-c/handlers/agent-result";
import {
  runCancel,
} from "./deep-research-option-c/handlers/cancel";
import {
  runCaptureFixtures,
} from "./deep-research-option-c/handlers/capture-fixtures";
import {
  runInit,
} from "./deep-research-option-c/handlers/init";
import {
  runInspect,
} from "./deep-research-option-c/handlers/inspect";
import {
  runPause,
} from "./deep-research-option-c/handlers/pause";
import {
  runPerspectivesDraft,
} from "./deep-research-option-c/handlers/perspectives-draft";
import {
  runResume,
} from "./deep-research-option-c/handlers/resume";
import {
  runRerunWave1,
} from "./deep-research-option-c/handlers/rerun";
import {
  runRun,
} from "./deep-research-option-c/handlers/run";
import {
  runStageAdvance,
} from "./deep-research-option-c/handlers/stage-advance";
import {
  runStatus,
} from "./deep-research-option-c/handlers/status";
import {
  runTick,
} from "./deep-research-option-c/handlers/tick";
import {
  runTriage,
} from "./deep-research-option-c/handlers/triage";
import {
  configureStdoutForJsonMode,
  emitJson,
  getCliArgv,
  isJsonModeRequested,
} from "./deep-research-option-c/cli/json-mode";
import {
  requireAbsolutePath,
} from "./deep-research-option-c/utils/paths";

const CLI_ARGV = getCliArgv();
const JSON_MODE_REQUESTED = isJsonModeRequested(CLI_ARGV);

configureStdoutForJsonMode(JSON_MODE_REQUESTED);

const AbsolutePath: Type<string, string> = {
  async from(str) {
    return requireAbsolutePath(str, "path");
  },
};

const initCmd = createInitCmd({ AbsolutePath, runInit });

const tickCmd = createTickCmd({ AbsolutePath, runTick });

const agentResultCmd = createAgentResultCmd({ AbsolutePath, runAgentResult });

const runCmd = createRunCmd({ AbsolutePath, runRun });

const stageAdvanceCmd = createStageAdvanceCmd({ AbsolutePath, runStageAdvance });

const perspectivesDraftCmd = createPerspectivesDraftCmd({ AbsolutePath, runPerspectivesDraft });

const statusCmd = createStatusCmd({ AbsolutePath, runStatus });

const inspectCmd = createInspectCmd({ AbsolutePath, runInspect });

const triageCmd = createTriageCmd({ AbsolutePath, runTriage });

const pauseCmd = createPauseCmd({ AbsolutePath, runPause });

const resumeCmd = createResumeCmd({ AbsolutePath, runResume });

const cancelCmd = createCancelCmd({ AbsolutePath, runCancel });

const captureFixturesCmd = createCaptureFixturesCmd({ AbsolutePath, runCaptureFixtures });

const rerunCmd = createRerunCmd({ AbsolutePath, runRerunWave1 });

const app = subcommands({
  name: "deep-research-option-c",
  cmds: {
    init: initCmd,
    tick: tickCmd,
    "agent-result": agentResultCmd,
    run: runCmd,
    "stage-advance": stageAdvanceCmd,
    "perspectives-draft": perspectivesDraftCmd,
    status: statusCmd,
    inspect: inspectCmd,
    triage: triageCmd,
    pause: pauseCmd,
    resume: resumeCmd,
    cancel: cancelCmd,
    "capture-fixtures": captureFixturesCmd,
    rerun: rerunCmd,
  },
});

runSafely(app, CLI_ARGV)
  .then((result) => {
    if (result._tag === "ok") return;

    const command = typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown";
    if (JSON_MODE_REQUESTED) {
      emitJson({
        ok: false,
        command,
        error: {
          code: "CLI_PARSE_ERROR",
          message: result.error.config.message,
        },
      });
      process.exit(result.error.config.exitCode);
      return;
    }

    result.error.run();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: string }).code)
      : "CLI_ERROR";

    if (JSON_MODE_REQUESTED) {
      emitJson({
        ok: false,
        command: typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown",
        error: {
          code: errorCode,
          message,
        },
      });
    } else {
      console.error(`ERROR: ${message}`);
    }

    process.exit(1);
  });
