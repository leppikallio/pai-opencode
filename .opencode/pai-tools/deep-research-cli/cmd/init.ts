import {
  boolean,
  command,
  flag,
  type Type,
  oneOf,
  option,
  optional,
  positional,
  string,
} from "cmd-ts";

type InitSensitivity = "normal" | "restricted" | "no_web";
type InitMode = "quick" | "standard" | "deep";

type RunInitArgs = {
  query: string;
  runId?: string;
  runsRoot?: string;
  sensitivity: InitSensitivity;
  mode: InitMode;
  citationsBrightDataEndpoint?: string;
  citationsApifyEndpoint?: string;
  citationValidationTier?: "basic" | "standard" | "thorough";
  writePerspectives: boolean;
  force: boolean;
  json: boolean;
};

export function createInitCmd(deps: {
  AbsolutePath: Type<string, string>;
  runInit: (args: RunInitArgs) => Promise<void>;
}) {
  return command({
    name: "init",
    description: "Initialize a new Option C run",
    args: {
      query: positional({ type: string, displayName: "query" }),
      runId: option({ long: "run-id", type: optional(string) }),
      runsRoot: option({ long: "runs-root", type: optional(deps.AbsolutePath) }),
      sensitivity: option({ long: "sensitivity", type: optional(oneOf(["normal", "restricted", "no_web"])) }),
      mode: option({ long: "mode", type: optional(oneOf(["quick", "standard", "deep"])) }),
      citationsBrightDataEndpoint: option({ long: "citations-brightdata-endpoint", type: optional(string) }),
      citationsApifyEndpoint: option({ long: "citations-apify-endpoint", type: optional(string) }),
      citationValidationTier: option({ long: "citation-validation-tier", type: optional(oneOf(["basic", "standard", "thorough"])) }),
      noPerspectives: flag({ long: "no-perspectives", type: boolean }),
      force: flag({ long: "force", type: boolean }),
      json: flag({ long: "json", type: boolean }),
    },
    handler: async (args) => {
      await deps.runInit({
        query: args.query,
        runId: args.runId,
        runsRoot: args.runsRoot,
        sensitivity: (args.sensitivity ?? "normal") as InitSensitivity,
        mode: (args.mode ?? "standard") as InitMode,
        citationsBrightDataEndpoint: args.citationsBrightDataEndpoint,
        citationsApifyEndpoint: args.citationsApifyEndpoint,
        citationValidationTier: args.citationValidationTier,
        writePerspectives: !args.noPerspectives,
        force: args.force,
        json: args.json,
      });
    },
  });
}
