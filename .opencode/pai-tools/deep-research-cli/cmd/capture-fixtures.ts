import {
  boolean,
  command,
  flag,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

type CaptureFixturesArgs = {
  manifest: string;
  outputDir?: string;
  bundleId?: string;
  reason: string;
  json?: boolean;
};

export function createCaptureFixturesCmd(deps: {
  AbsolutePath: Type<string, string>;
  runCaptureFixtures: (args: CaptureFixturesArgs) => Promise<void>;
}) {
  return command({
    name: "capture-fixtures",
    description: "Capture deterministic fixture bundle for replay",
    args: {
      manifest: option({ long: "manifest", type: deps.AbsolutePath }),
      outputDir: option({ long: "output-dir", type: optional(deps.AbsolutePath) }),
      bundleId: option({ long: "bundle-id", type: optional(string) }),
      reason: option({ long: "reason", type: optional(string) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runCaptureFixtures({
        manifest: args.manifest,
        outputDir: args.outputDir,
        bundleId: args.bundleId,
        reason: args.reason ?? "operator-cli capture-fixtures",
        json: args.json,
      });
    },
  });
}
