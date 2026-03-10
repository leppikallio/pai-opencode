import { describe, expect, test } from "bun:test";

import {
  PAI_ORCHESTRATION_FEATURE_FLAG_DEFAULTS,
  PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS,
  paiOrchestrationCompactionBundleEnabled,
  paiOrchestrationConcurrencyEnabled,
  paiOrchestrationFeatureFlags,
  paiOrchestrationForegroundParityEnabled,
  paiOrchestrationStableCompletionEnabled,
  paiOrchestrationWisdomProjectionEnabled,
  resolvePaiOrchestrationFeatureFlags,
} from "../../plugins/pai-cc-hooks/feature-flags";

describe("PAI orchestration feature flag contract", () => {
  test("required orchestration flags exist in the canonical module", () => {
    const requiredFlags = [
      "paiOrchestrationForegroundParityEnabled",
      "paiOrchestrationConcurrencyEnabled",
      "paiOrchestrationStableCompletionEnabled",
      "paiOrchestrationCompactionBundleEnabled",
      "paiOrchestrationWisdomProjectionEnabled",
    ] as const;

    for (const flagName of requiredFlags) {
      expect(flagName in PAI_ORCHESTRATION_FEATURE_FLAG_DEFAULTS).toBe(true);
      expect(flagName in PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS).toBe(true);
      expect(typeof paiOrchestrationFeatureFlags[flagName]).toBe("boolean");
      expect(PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS[flagName]).toMatch(/^PAI_ORCHESTRATION_[A-Z0-9_]+_ENABLED$/);
    }

    expect(paiOrchestrationForegroundParityEnabled).toBe(paiOrchestrationFeatureFlags.paiOrchestrationForegroundParityEnabled);
    expect(paiOrchestrationConcurrencyEnabled).toBe(paiOrchestrationFeatureFlags.paiOrchestrationConcurrencyEnabled);
    expect(paiOrchestrationStableCompletionEnabled).toBe(paiOrchestrationFeatureFlags.paiOrchestrationStableCompletionEnabled);
    expect(paiOrchestrationCompactionBundleEnabled).toBe(paiOrchestrationFeatureFlags.paiOrchestrationCompactionBundleEnabled);
    expect(paiOrchestrationWisdomProjectionEnabled).toBe(paiOrchestrationFeatureFlags.paiOrchestrationWisdomProjectionEnabled);
  });

  test("defaults are explicit and represent rollback-safe off-path posture", () => {
    expect(PAI_ORCHESTRATION_FEATURE_FLAG_DEFAULTS).toEqual({
      paiOrchestrationForegroundParityEnabled: false,
      paiOrchestrationConcurrencyEnabled: false,
      paiOrchestrationStableCompletionEnabled: false,
      paiOrchestrationCompactionBundleEnabled: false,
      paiOrchestrationWisdomProjectionEnabled: false,
    });
  });

  test("override resolution is deterministic: env override > module default", () => {
    const env = {
      [PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationForegroundParityEnabled]: "1",
      [PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationConcurrencyEnabled]: "false",
      [PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationStableCompletionEnabled]: "  TRUE  ",
      [PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationCompactionBundleEnabled]: "unexpected",
      [PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationWisdomProjectionEnabled]: "0",
    } as const;

    const firstPass = resolvePaiOrchestrationFeatureFlags(env);
    const secondPass = resolvePaiOrchestrationFeatureFlags(env);

    expect(firstPass).toEqual(secondPass);
    expect(firstPass).toEqual({
      paiOrchestrationForegroundParityEnabled: true,
      paiOrchestrationConcurrencyEnabled: false,
      paiOrchestrationStableCompletionEnabled: true,
      paiOrchestrationCompactionBundleEnabled:
        PAI_ORCHESTRATION_FEATURE_FLAG_DEFAULTS.paiOrchestrationCompactionBundleEnabled,
      paiOrchestrationWisdomProjectionEnabled: false,
    });
  });
});
