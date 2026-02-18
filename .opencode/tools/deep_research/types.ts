export type JsonObject = Record<string, unknown>;

export type ToolWithExecute = {
  execute: (...args: unknown[]) => unknown | Promise<unknown>;
};

export type RunMode = "quick" | "standard" | "deep";
export type Sensitivity = "normal" | "restricted" | "no_web";
export type CitationValidationTier = "basic" | "standard" | "thorough";

export type DeepResearchFlagsV1 = {
  optionCEnabled: boolean;
  modeDefault: RunMode;
  maxWave1Agents: number;
  maxWave2Agents: number;
  maxSummaryKb: number;
  maxTotalSummaryKb: number;
  maxReviewIterations: number;
  citationValidationTier: CitationValidationTier;
  citationsBrightDataEndpoint: string | null;
  citationsApifyEndpoint: string | null;
  noWeb: boolean;
  runsRoot: string;
  source: {
    env: string[];
    settings: string[];
  };
};

export type GateId = "A" | "B" | "C" | "D" | "E" | "F";
export type GapPriority = "P0" | "P1" | "P2" | "P3";

export type PivotGap = {
  gap_id: string;
  priority: GapPriority;
  text: string;
  tags: string[];
  source: "explicit" | "parsed_wave1";
  from_perspective_id?: string;
};
