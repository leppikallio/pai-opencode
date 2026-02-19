import {
  boolean,
  command,
  flag,
  type Type,
  oneOf,
  option,
  optional,
  string,
} from "cmd-ts";

type TickDriver = "fixture" | "live" | "task";

type RunTickArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
  reason: string;
  driver: TickDriver;
  json: boolean;
};

export function createTickCmd(deps: {
  AbsolutePath: Type<string, string>;
  runTick: (args: RunTickArgs) => Promise<void>;
}) {
  return command({
    name: "tick",
    description: "Run exactly one orchestrator tick (driver-specific, run-handle aware)",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      gates: option({ long: "gates", type: optional(deps.AbsolutePath) }),
      reason: option({ long: "reason", type: string }),
      driver: option({ long: "driver", type: oneOf(["fixture", "live", "task"]) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runTick({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        gates: args.gates,
        reason: args.reason,
        driver: args.driver as TickDriver,
        json: args.json,
      });
    },
  });
}
