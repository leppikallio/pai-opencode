import {
  boolean,
  command,
  flag,
  number,
  oneOf,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

const runUntilStages = [
  "init",
  "perspectives",
  "wave1",
  "pivot",
  "wave2",
  "citations",
  "summaries",
  "synthesis",
  "review",
  "finalize",
] as const;

type RunDriver = "fixture" | "live";
type RunUntilStage = (typeof runUntilStages)[number];

type RunCmdArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
  reason: string;
  driver: RunDriver;
  maxTicks: number;
  until?: RunUntilStage;
  json: boolean;
};

export function createRunCmd(deps: {
  AbsolutePath: Type<string, string>;
  runRun: (args: RunCmdArgs) => Promise<void>;
}) {
  return command({
    name: "run",
    description: "Run multiple ticks with watchdog enforcement and stage stops",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      gates: option({ long: "gates", type: optional(deps.AbsolutePath) }),
      reason: option({ long: "reason", type: string }),
      driver: option({ long: "driver", type: oneOf(["fixture", "live"]) }),
      maxTicks: option({ long: "max-ticks", type: optional(number) }),
      until: option({ long: "until", type: optional(oneOf([...runUntilStages])) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runRun({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        gates: args.gates,
        reason: args.reason,
        driver: args.driver as RunDriver,
        maxTicks: args.maxTicks ?? 10,
        until: args.until,
        json: args.json,
      });
    },
  });
}
