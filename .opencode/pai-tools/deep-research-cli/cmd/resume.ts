import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type ResumeCmdArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  reason: string;
  json: boolean;
};

export function createResumeCmd(deps: {
  AbsolutePath: Type<string, string>;
  runResume: (args: ResumeCmdArgs) => Promise<void>;
}) {
  return command({
    name: "resume",
    description: "Resume a paused run and reset stage timer semantics",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      reason: option({ long: "reason", type: optional(string) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runResume({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        reason: args.reason ?? "operator-cli resume",
        json: args.json,
      });
    },
  });
}
