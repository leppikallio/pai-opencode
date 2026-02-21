import { describe, expect, test } from "bun:test";

import { STAGE_TIMEOUT_SECONDS_V1 as TIMEOUTS_A } from "../../tools/deep_research_cli/lifecycle_lib";
import { STAGE_TIMEOUT_SECONDS_V1 as TIMEOUTS_B } from "../../tools/deep_research_cli/schema_v1";

describe("deep_research timeout constants (regression)", () => {
  test("STAGE_TIMEOUT_SECONDS_V1 matches between lifecycle_lib and schema_v1", () => {
    expect(TIMEOUTS_A).toEqual(TIMEOUTS_B);
  });
});
