import { command, option, string, subcommands, type Type } from "cmd-ts";

type RerunWave1CmdArgs = {
  manifest: string;
  perspective: string;
  reason: string;
};

export function createRerunCmd(deps: {
  AbsolutePath: Type<string, string>;
  runRerunWave1: (args: RerunWave1CmdArgs) => Promise<void>;
}) {
  const rerunWave1Cmd = command({
    name: "wave1",
    description: "Write/overwrite wave1 retry directives for one perspective",
    args: {
      manifest: option({ long: "manifest", type: deps.AbsolutePath }),
      perspective: option({ long: "perspective", type: string }),
      reason: option({ long: "reason", type: string }),
    },
    handler: async (args) => {
      await deps.runRerunWave1({
        manifest: args.manifest,
        perspective: args.perspective,
        reason: args.reason,
      });
    },
  });

  return subcommands({
    name: "rerun",
    cmds: {
      wave1: rerunWave1Cmd,
    },
  });
}
