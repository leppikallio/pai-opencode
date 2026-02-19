import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type RunTriageArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  json: boolean;
};

export function createTriageCmd(deps: {
  AbsolutePath: Type<string, string>;
  runTriage: (args: RunTriageArgs) => Promise<void>;
}) {
  return command({
    name: "triage",
    description: "Print a compact blocker summary from stage_advance dry-run",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runTriage({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        json: args.json,
      });
    },
  });
}
