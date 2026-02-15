import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 as resolveFlagsFromSpecReader } from "../../tools/deep_research/flags_v1";
import { resolveDeepResearchFlagsV1 as resolveFlagsFromLifecycle } from "../../tools/deep_research/lifecycle_lib";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const FLAG_ENV_KEYS = [
  "PAI_DR_OPTION_C_ENABLED",
  "PAI_DR_MODE_DEFAULT",
  "PAI_DR_MAX_WAVE1_AGENTS",
  "PAI_DR_MAX_WAVE2_AGENTS",
  "PAI_DR_MAX_SUMMARY_KB",
  "PAI_DR_MAX_TOTAL_SUMMARY_KB",
  "PAI_DR_MAX_REVIEW_ITERATIONS",
  "PAI_DR_CITATION_VALIDATION_TIER",
  "PAI_DR_NO_WEB",
  "PAI_DR_RUNS_ROOT",
] as const;

function deterministicFlagEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    PAI_DR_OPTION_C_ENABLED: "1",
    PAI_DR_MODE_DEFAULT: "standard",
    PAI_DR_MAX_WAVE1_AGENTS: "6",
    PAI_DR_MAX_WAVE2_AGENTS: "6",
    PAI_DR_MAX_SUMMARY_KB: "5",
    PAI_DR_MAX_TOTAL_SUMMARY_KB: "60",
    PAI_DR_MAX_REVIEW_ITERATIONS: "4",
    PAI_DR_CITATION_VALIDATION_TIER: "standard",
    PAI_DR_NO_WEB: "0",
    PAI_DR_RUNS_ROOT: path.join(os.tmpdir(), "dr-feature-flags-contract-runs"),
    ...overrides,
  };
}

async function withDeterministicFlagsEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const updates: Record<string, string | undefined> = deterministicFlagEnv(overrides);

  // Explicitly set every known env input so tests stay deterministic
  // even when parent shell has extra Option C env values.
  for (const key of FLAG_ENV_KEYS) {
    if (!(key in updates)) updates[key] = undefined;
  }

  return withEnv(updates, fn);
}

describe("deep_research_feature_flags contract (entity)", () => {
  test("spec surface is deterministic and identical across both flag readers", async () => {
    await withDeterministicFlagsEnv({}, async () => {
      const specReader = resolveFlagsFromSpecReader();
      const lifecycleReader = resolveFlagsFromLifecycle();

      assert.deepEqual(
        specReader,
        lifecycleReader,
        "Flag invariant broke: flags_v1.ts and lifecycle_lib.ts resolved different effective surfaces",
      );

      assert.equal(specReader.optionCEnabled, true, "Flag invariant broke: PAI_DR_OPTION_C_ENABLED should resolve true");
      assert.equal(specReader.modeDefault, "standard", "Flag invariant broke: PAI_DR_MODE_DEFAULT should resolve to standard");
      assert.equal(specReader.maxWave1Agents, 6, "Flag invariant broke: PAI_DR_MAX_WAVE1_AGENTS should resolve to 6");
      assert.equal(specReader.maxWave2Agents, 6, "Flag invariant broke: PAI_DR_MAX_WAVE2_AGENTS should resolve to 6");
      assert.equal(specReader.maxSummaryKb, 5, "Flag invariant broke: PAI_DR_MAX_SUMMARY_KB should resolve to 5");
      assert.equal(specReader.maxTotalSummaryKb, 60, "Flag invariant broke: PAI_DR_MAX_TOTAL_SUMMARY_KB should resolve to 60");
      assert.equal(specReader.maxReviewIterations, 4, "Flag invariant broke: PAI_DR_MAX_REVIEW_ITERATIONS should resolve to 4");
      assert.equal(
        specReader.citationValidationTier,
        "standard",
        "Flag invariant broke: PAI_DR_CITATION_VALIDATION_TIER should resolve to standard",
      );
      assert.equal(specReader.noWeb, false, "Flag invariant broke: PAI_DR_NO_WEB should resolve false when set to 0");
      assert.deepEqual(
        specReader.source.env,
        [...FLAG_ENV_KEYS],
        "Flag invariant broke: source.env should list all explicit env keys in canonical order",
      );
    });
  });

  test("safety clamps prevent runaway canary fan-out and invalid bounds", async () => {
    await withDeterministicFlagsEnv(
      {
        PAI_DR_MAX_WAVE1_AGENTS: "0",
        PAI_DR_MAX_WAVE2_AGENTS: "999",
        PAI_DR_MAX_SUMMARY_KB: "0",
        PAI_DR_MAX_TOTAL_SUMMARY_KB: "999999",
        PAI_DR_MAX_REVIEW_ITERATIONS: "-7",
      },
      async () => {
        const flags = resolveFlagsFromSpecReader();

        assert.equal(
          flags.maxWave1Agents,
          1,
          "Flag invariant broke: maxWave1Agents must clamp to >= 1 for rollout/canary safety",
        );
        assert.equal(
          flags.maxWave2Agents,
          50,
          "Flag invariant broke: maxWave2Agents must clamp to <= 50 to prevent runaway fan-out",
        );
        assert.equal(flags.maxSummaryKb, 1, "Flag invariant broke: maxSummaryKb must clamp to >= 1");
        assert.equal(flags.maxTotalSummaryKb, 100000, "Flag invariant broke: maxTotalSummaryKb must clamp to <= 100000");
        assert.equal(flags.maxReviewIterations, 0, "Flag invariant broke: maxReviewIterations must clamp to >= 0");
      },
    );
  });

  test("master disable switch blocks Option C immediately", async () => {
    await withDeterministicFlagsEnv(
      {
        PAI_DR_OPTION_C_ENABLED: "0",
      },
      async () => {
        const outRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "normal",
            run_id: "dr_test_flags_disabled_001",
            root_override: "/tmp",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        assert.equal(out.ok, false, "Flag invariant broke: run_init must fail when master enable flag is off");
        assert.equal((out as any).error.code, "DISABLED", "Flag invariant broke: disabled path must return DISABLED error code");
      },
    );
  });

  test("offline-first safety: PAI_DR_NO_WEB forces no_web sensitivity and preserves canary caps in manifest", async () => {
    await withDeterministicFlagsEnv(
      {
        PAI_DR_OPTION_C_ENABLED: "1",
        PAI_DR_NO_WEB: "1",
        PAI_DR_MAX_WAVE1_AGENTS: "2",
        PAI_DR_MAX_WAVE2_AGENTS: "2",
      },
      async () => {
        await withTempDir(async (base) => {
          const runId = "dr_test_flags_offline_001";
          const outRaw = (await (run_init as any).execute(
            {
              query: "Q",
              mode: "standard",
              sensitivity: "normal",
              run_id: runId,
              root_override: base,
            },
            makeToolContext(),
          )) as string;
          const out = parseToolJson(outRaw);

          assert.equal(out.ok, true, "Flag invariant broke: run_init should succeed when Option C is enabled");

          const manifestPath = (out as any).manifest_path as string;
          const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

          assert.equal(
            manifest.query.sensitivity,
            "no_web",
            "Flag invariant broke: PAI_DR_NO_WEB=1 must force offline sensitivity regardless of requested sensitivity",
          );
          assert.equal(
            manifest.query.constraints.deep_research_flags.PAI_DR_NO_WEB,
            true,
            "Flag invariant broke: manifest deep_research_flags must persist PAI_DR_NO_WEB=true",
          );
          assert.equal(
            manifest.limits.max_wave1_agents,
            2,
            "Flag invariant broke: max_wave1_agents manifest limit must reflect canary cap flag",
          );
          assert.equal(
            manifest.limits.max_wave2_agents,
            2,
            "Flag invariant broke: max_wave2_agents manifest limit must reflect canary cap flag",
          );
        });
      },
    );
  });
});
