const DISABLE_WHEN_DEFAULT_ON = new Set(["0", "false", "off", "no"]);
const ENABLE_WHEN_DEFAULT_OFF = new Set(["1", "true", "on", "yes"]);

function normalizeEnvValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isEnvFlagEnabled(name: string, defaultEnabled: boolean): boolean {
  const normalized = normalizeEnvValue(process.env[name]);
  if (!normalized) return defaultEnabled;

  if (defaultEnabled) {
    return !DISABLE_WHEN_DEFAULT_ON.has(normalized);
  }

  return ENABLE_WHEN_DEFAULT_OFF.has(normalized);
}

export function isMemoryParityEnabled(): boolean {
  return isEnvFlagEnabled("PAI_ENABLE_MEMORY_PARITY", true);
}
