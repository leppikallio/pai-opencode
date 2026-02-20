import {
  boolean,
  command,
  flag,
  oneOf,
  option,
  string,
  type Type,
} from "cmd-ts";

type PerspectivesDraftDriver = "task";

type RunPerspectivesDraftArgs = {
  manifest: string;
  reason: string;
  driver: PerspectivesDraftDriver;
  json: boolean;
};

export function createPerspectivesDraftCmd(deps: {
  AbsolutePath: Type<string, string>;
  runPerspectivesDraft: (args: RunPerspectivesDraftArgs) => Promise<void>;
}) {
  return command({
    name: "perspectives-draft",
    description: "Draft perspectives prompts and halt for task-driver agent work",
    args: {
      manifest: option({ long: "manifest", type: deps.AbsolutePath }),
      reason: option({ long: "reason", type: string }),
      driver: option({ long: "driver", type: oneOf(["task"]) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runPerspectivesDraft({
        manifest: args.manifest,
        reason: args.reason,
        driver: args.driver as PerspectivesDraftDriver,
        json: args.json,
      });
    },
  });
}
