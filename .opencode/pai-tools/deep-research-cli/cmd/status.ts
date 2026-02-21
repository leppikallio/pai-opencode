import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type RunStatusArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  json: boolean;
};

export function createStatusCmd(deps: {
  AbsolutePath: Type<string, string>;
  runStatus: (args: RunStatusArgs) => Promise<void>;
}) {
  return command({
    name: "status",
    description: "Print the run contract fields (run-id-first)",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runStatus({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        json: args.json,
      });
    },
  });
}
