import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type RunInspectArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  json: boolean;
};

export function createInspectCmd(deps: {
  AbsolutePath: Type<string, string>;
  runInspect: (args: RunInspectArgs) => Promise<void>;
}) {
  return command({
    name: "inspect",
    description: "Print gate status + next-stage blockers",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runInspect({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        json: args.json,
      });
    },
  });
}
