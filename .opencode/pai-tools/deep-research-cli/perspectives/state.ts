export type TaskDriverMissingPerspective = {
  perspectiveId: string;
  promptPath: string;
  outputPath: string;
  metaPath: string;
  promptDigest: string;
};

export type PerspectivesDraftStatus = "awaiting_agent_results" | "merging" | "awaiting_human_review" | "promoted";

export type PerspectivesDraftStateArtifactV1 = {
  schema_version: "perspectives-draft-state.v1";
  run_id: string;
  status: PerspectivesDraftStatus;
  policy_path: string;
  inputs_digest: string;
  draft_digest: string | null;
  promoted_digest: string | null;
};

export type PerspectivesDraftMergeReportV1 = {
  schema_version: "perspectives-draft-merge-report.v1";
  run_id: string;
  generated_from: string[];
  candidate_count_in: number;
  candidate_count_out: number;
  review_required: boolean;
  dedupe_keys: string[];
};

export type PerspectivesV1Payload = {
  schema_version: "perspectives.v1";
  run_id: string;
  created_at: string;
  perspectives: Array<{
    id: string;
    title: string;
    track: "standard" | "independent" | "contrarian";
    agent_type: string;
    prompt_contract: {
      max_words: number;
      max_sources: number;
      tool_budget: {
        search_calls: number;
        fetch_calls: number;
      };
      must_include_sections: string[];
    };
    platform_requirements: Array<{ name: string; reason: string }>;
    tool_policy: {
      primary: string[];
      secondary: string[];
      forbidden: string[];
    };
  }>;
};

export type PerspectivesPolicyArtifactV1 = {
  schema_version: "perspectives-policy.v1";
  thresholds: {
    ensemble_threshold: 80;
    backup_threshold: 85;
    match_bonus: 10;
    mismatch_penalty: -25;
    threshold_operator: ">=";
    confidence: {
      type: "integer";
      min: 0;
      max: 100;
    };
  };
  track_allocation: {
    standard: 0.5;
    independent: 0.25;
    contrarian: 0.25;
    rounding: "largest_remainder_method";
  };
  partial_failure_policy: {
    mode: "fail_closed";
    on_partial_failure: "awaiting_agent_results";
  };
};
