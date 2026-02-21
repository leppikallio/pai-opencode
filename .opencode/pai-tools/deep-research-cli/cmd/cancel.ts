import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type CancelCmdArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  reason: string;
  json: boolean;
};

export function createCancelCmd(deps: {
  AbsolutePath: Type<string, string>;
  runCancel: (args: CancelCmdArgs) => Promise<void>;
}) {
  return command({
    name: "cancel",
    description: "Cancel a run durably and write a cancel checkpoint",
    args: {
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      runRoot: option({ long: "run-root", type: optional(deps.AbsolutePath) }),
      manifest: option({ long: "manifest", type: optional(deps.AbsolutePath) }),
      reason: option({ long: "reason", type: optional(string) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runCancel({
        runId: args.runId,
        runsRoot: args.runsRoot,
        runRoot: args.runRoot,
        manifest: args.manifest,
        reason: args.reason ?? "operator-cli cancel",
        json: args.json,
      });
    },
  });
}
