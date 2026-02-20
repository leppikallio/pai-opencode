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

type AgentResultStage = "perspectives" | "wave1" | "wave2" | "summaries" | "synthesis";

type RunAgentResultArgs = {
  manifest: string;
  stage: AgentResultStage;
  perspective: string;
  input: string;
  agentRunId: string;
  reason: string;
  force: boolean;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  json?: boolean;
};

export function createAgentResultCmd(deps: {
  AbsolutePath: Type<string, string>;
  runAgentResult: (args: RunAgentResultArgs) => Promise<void>;
}) {
  return command({
    name: "agent-result",
    description: "Ingest a task-produced stage output into canonical artifacts",
    args: {
      manifest: option({ long: "manifest", type: deps.AbsolutePath }),
      stage: option({ long: "stage", type: oneOf(["perspectives", "wave1", "wave2", "summaries", "synthesis"]) }),
      perspective: option({ long: "perspective", type: string }),
      input: option({ long: "input", type: deps.AbsolutePath }),
      agentRunId: option({ long: "agent-run-id", type: string }),
      reason: option({ long: "reason", type: string }),
      force: flag({ long: "force", type: boolean }),
      startedAt: option({ long: "started-at", type: optional(string) }),
      finishedAt: option({ long: "finished-at", type: optional(string) }),
      model: option({ long: "model", type: optional(string) }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runAgentResult({
        manifest: args.manifest,
        stage: args.stage as RunAgentResultArgs["stage"],
        perspective: args.perspective,
        input: args.input,
        agentRunId: args.agentRunId,
        reason: args.reason,
        force: args.force,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        model: args.model,
        json: args.json,
      });
    },
  });
}
