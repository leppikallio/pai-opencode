import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type PauseCmdArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  reason: string;
  json: boolean;
};

export function createPauseCmd(deps: {
  AbsolutePath: Type<string, string>;
  runPause: (args: PauseCmdArgs) => Promise<void>;
}) {
  return command({
    name: "pause",
    description: "Pause a run durably and write a checkpoint artifact",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      reason: option({ long: "reason", type: optional(string) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runPause({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        reason: args.reason ?? "operator-cli pause",
        json: args.json,
      });
    },
  });
}
