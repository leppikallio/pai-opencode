import {
  boolean,
  command,
  flag,
  oneOf,
  option,
  optional,
  string,
  type Type,
} from "cmd-ts";

const manifestStages = [
  "init",
  "perspectives",
  "wave1",
  "pivot",
  "wave2",
  "citations",
  "summaries",
  "synthesis",
  "review",
  "finalize",
] as const;

type ManifestStage = (typeof manifestStages)[number];

type RunStageAdvanceArgs = {
  manifest: string;
  gates?: string;
  requestedNext?: ManifestStage;
  reason: string;
  json: boolean;
};

export function createStageAdvanceCmd(deps: {
  AbsolutePath: Type<string, string>;
  runStageAdvance: (args: RunStageAdvanceArgs) => Promise<void>;
}) {
  return command({
    name: "stage-advance",
    description: "Advance manifest stage with deterministic guardrails",
    args: {
      manifest: option({ long: "manifest", type: deps.AbsolutePath }),
      gates: option({ long: "gates", type: optional(deps.AbsolutePath) }),
      requestedNext: option({ long: "requested-next", type: optional(oneOf([...manifestStages])) }),
      reason: option({ long: "reason", type: string }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runStageAdvance({
        manifest: args.manifest,
        gates: args.gates,
        requestedNext: args.requestedNext,
        reason: args.reason,
        json: args.json,
      });
    },
  });
}
