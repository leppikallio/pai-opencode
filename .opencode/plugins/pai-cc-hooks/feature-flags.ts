export type PaiOrchestrationFeatureFlags = {
  paiOrchestrationForegroundParityEnabled: boolean;
  paiOrchestrationConcurrencyEnabled: boolean;
  paiOrchestrationStableCompletionEnabled: boolean;
  paiOrchestrationCompactionBundleEnabled: boolean;
  paiOrchestrationWisdomProjectionEnabled: boolean;
};

export const PAI_ORCHESTRATION_FEATURE_FLAG_DEFAULTS: Readonly<PaiOrchestrationFeatureFlags> = Object.freeze({
  paiOrchestrationForegroundParityEnabled: false,
  paiOrchestrationConcurrencyEnabled: false,
  paiOrchestrationStableCompletionEnabled: false,
  paiOrchestrationCompactionBundleEnabled: false,
  paiOrchestrationWisdomProjectionEnabled: false,
});

export type PaiOrchestrationFeatureFlagName = keyof PaiOrchestrationFeatureFlags;

export const PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS: Readonly<Record<PaiOrchestrationFeatureFlagName, string>> =
  Object.freeze({
    paiOrchestrationForegroundParityEnabled: "PAI_ORCHESTRATION_FOREGROUND_PARITY_ENABLED",
    paiOrchestrationConcurrencyEnabled: "PAI_ORCHESTRATION_CONCURRENCY_ENABLED",
    paiOrchestrationStableCompletionEnabled: "PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED",
    paiOrchestrationCompactionBundleEnabled: "PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED",
    paiOrchestrationWisdomProjectionEnabled: "PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED",
  });

const PAI_ORCHESTRATION_FEATURE_FLAG_NAMES: ReadonlyArray<PaiOrchestrationFeatureFlagName> = Object.freeze([
  "paiOrchestrationForegroundParityEnabled",
  "paiOrchestrationConcurrencyEnabled",
  "paiOrchestrationStableCompletionEnabled",
  "paiOrchestrationCompactionBundleEnabled",
  "paiOrchestrationWisdomProjectionEnabled",
]);

function parseBooleanEnvOverride(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return undefined;
}

export function resolvePaiOrchestrationFeatureFlags(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<PaiOrchestrationFeatureFlags> {
  const resolved: PaiOrchestrationFeatureFlags = {
    ...PAI_ORCHESTRATION_FEATURE_FLAG_DEFAULTS,
  };

  for (const flagName of PAI_ORCHESTRATION_FEATURE_FLAG_NAMES) {
    const envKey = PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS[flagName];
    const override = parseBooleanEnvOverride(env[envKey]);

    if (override !== undefined) {
      resolved[flagName] = override;
    }
  }

  return Object.freeze(resolved);
}

export const paiOrchestrationFeatureFlags = resolvePaiOrchestrationFeatureFlags();

export const paiOrchestrationForegroundParityEnabled =
  paiOrchestrationFeatureFlags.paiOrchestrationForegroundParityEnabled;

export const paiOrchestrationConcurrencyEnabled =
  paiOrchestrationFeatureFlags.paiOrchestrationConcurrencyEnabled;

export const paiOrchestrationStableCompletionEnabled =
  paiOrchestrationFeatureFlags.paiOrchestrationStableCompletionEnabled;

export const paiOrchestrationCompactionBundleEnabled =
  paiOrchestrationFeatureFlags.paiOrchestrationCompactionBundleEnabled;

export const paiOrchestrationWisdomProjectionEnabled =
  paiOrchestrationFeatureFlags.paiOrchestrationWisdomProjectionEnabled;
