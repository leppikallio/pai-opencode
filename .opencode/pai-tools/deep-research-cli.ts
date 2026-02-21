#!/usr/bin/env bun

import type { Type } from "cmd-ts";
import {
  runSafely,
  subcommands,
} from "cmd-ts";

import { createAgentResultCmd } from "./deep-research-cli/cmd/agent-result";
import { createCancelCmd } from "./deep-research-cli/cmd/cancel";
import { createCaptureFixturesCmd } from "./deep-research-cli/cmd/capture-fixtures";
import { createInitCmd } from "./deep-research-cli/cmd/init";
import { createInspectCmd } from "./deep-research-cli/cmd/inspect";
import { createPauseCmd } from "./deep-research-cli/cmd/pause";
import { createPerspectivesDraftCmd } from "./deep-research-cli/cmd/perspectives-draft";
import { createResumeCmd } from "./deep-research-cli/cmd/resume";
import { createRerunCmd } from "./deep-research-cli/cmd/rerun";
import { createRunCmd } from "./deep-research-cli/cmd/run";
import { createStageAdvanceCmd } from "./deep-research-cli/cmd/stage-advance";
import { createStatusCmd } from "./deep-research-cli/cmd/status";
import { createTickCmd } from "./deep-research-cli/cmd/tick";
import { createTriageCmd } from "./deep-research-cli/cmd/triage";
import {
  runAgentResult,
} from "./deep-research-cli/handlers/agent-result";
import {
  runCancel,
} from "./deep-research-cli/handlers/cancel";
import {
  runCaptureFixtures,
} from "./deep-research-cli/handlers/capture-fixtures";
import {
  runInit,
} from "./deep-research-cli/handlers/init";
import {
  runInspect,
} from "./deep-research-cli/handlers/inspect";
import {
  runPause,
} from "./deep-research-cli/handlers/pause";
import {
  runPerspectivesDraft,
} from "./deep-research-cli/handlers/perspectives-draft";
import {
  runResume,
} from "./deep-research-cli/handlers/resume";
import {
  runRerunWave1,
} from "./deep-research-cli/handlers/rerun";
import {
  runRun,
} from "./deep-research-cli/handlers/run";
import {
  runStageAdvance,
} from "./deep-research-cli/handlers/stage-advance";
import {
  runStatus,
} from "./deep-research-cli/handlers/status";
import {
  runTick,
} from "./deep-research-cli/handlers/tick";
import {
  runTriage,
} from "./deep-research-cli/handlers/triage";
import {
  configureStdoutForJsonMode,
  getCliArgv,
  isJsonModeRequested,
} from "./deep-research-cli/cli/json-mode";
import { emitJsonV1 } from "./deep-research-cli/cli/json-contract";
import {
  requireAbsolutePath,
} from "./deep-research-cli/utils/paths";
import { resolveDeepResearchCliInvocation } from "./deep-research-cli/utils/cli-invocation";

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
  name: "deep-research-cli",
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

function errorContract(): Record<string, unknown> {
  return {
    run_id: null,
    run_root: null,
    manifest_path: null,
    gates_path: null,
    stage_current: null,
    status: null,
    cli_invocation: resolveDeepResearchCliInvocation(),
  };
}

runSafely(app, CLI_ARGV)
  .then((result) => {
    if (result._tag === "ok") return;

    const command = typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown";
    if (JSON_MODE_REQUESTED) {
      emitJsonV1({
        ok: false,
        command,
        contract: errorContract(),
        result: null,
        error: {
          code: "CLI_PARSE_ERROR",
          message: result.error.config.message,
        },
        halt: null,
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
      emitJsonV1({
        ok: false,
        command: typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown",
        contract: errorContract(),
        result: null,
        error: {
          code: errorCode,
          message,
        },
        halt: null,
      });
    } else {
      console.error(`ERROR: ${message}`);
    }

    process.exit(1);
  });
