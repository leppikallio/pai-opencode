import { fileLog } from "./file-logger.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

/**
 * PAI Model Configuration Schema
 */
export interface PaiModelConfig {
  model_provider: "sen" | "anthropic" | "openai";
  models: {
    default: string;
    validation: string;
    agents: {
      intern: string;
      architect: string;
      engineer: string;
      explorer: string;
      reviewer: string;
    };
  };
}

/**
 * Provider Presets
 * Default model configurations for each provider
 */
const PROVIDER_PRESETS: Record<"sen" | "anthropic" | "openai", PaiModelConfig["models"]> = {
  sen: {
    default: "sen/grok-1",
    validation: "sen/grok-1",
    agents: {
      intern: "sen/grok-1",
      architect: "sen/grok-1",
      engineer: "sen/grok-1",
      explorer: "sen/grok-1",
      reviewer: "sen/grok-1",
    },
  },
  anthropic: {
    default: "anthropic/claude-sonnet-4-5",
    validation: "anthropic/claude-sonnet-4-5",
    agents: {
      intern: "anthropic/claude-haiku-4-5",
      architect: "anthropic/claude-sonnet-4-5",
      engineer: "anthropic/claude-sonnet-4-5",
      explorer: "anthropic/claude-sonnet-4-5",
      reviewer: "anthropic/claude-opus-4-5",
    },
  },
  openai: {
    default: "openai/gpt-4o",
    validation: "openai/gpt-4o",
    agents: {
      intern: "openai/gpt-4o-mini",
      architect: "openai/gpt-4o",
      engineer: "openai/gpt-4o",
      explorer: "openai/gpt-4o",
      reviewer: "openai/gpt-4o",
    },
  },
};

/**
 * Get the provider preset configuration
 */
export function getProviderPreset(
  provider: "sen" | "anthropic" | "openai"
): PaiModelConfig["models"] {
  return PROVIDER_PRESETS[provider];
}

/**
 * Read opencode.json configuration
 * Returns null if file doesn't exist or can't be parsed
 */
function readOpencodeConfig(): any | null {
  try {
    // Find opencode.json in parent directory of .opencode
    const opencodeDir = process.cwd(); // Assumes we're running from .opencode
    const parentDir = dirname(opencodeDir);
    const configPath = join(parentDir, "opencode.json");

    if (!existsSync(configPath)) {
      fileLog("model-config", `No opencode.json found at ${configPath}, using defaults`);
      return null;
    }

    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    fileLog("model-config", `Loaded opencode.json from ${configPath}`);
    return config;
  } catch (error) {
    fileLog("model-config", `Error reading opencode.json: ${error}`);
    return null;
  }
}

/**
 * Get the full model configuration
 * Reads from opencode.json or uses "sen" defaults
 */
export function getModelConfig(): PaiModelConfig {
  const config = readOpencodeConfig();

  // Check for PAI section in config
  const paiConfig = config?.pai;

  if (!paiConfig || !paiConfig.model_provider) {
    fileLog("model-config", "No PAI config found, using sen defaults");
    return {
      model_provider: "sen",
      models: PROVIDER_PRESETS.sen,
    };
  }

  const provider = paiConfig.model_provider as "sen" | "anthropic" | "openai";

  // Validate provider
  if (!["sen", "anthropic", "openai"].includes(provider)) {
    fileLog("model-config", `Invalid provider "${provider}", falling back to sen`);
    return {
      model_provider: "sen",
      models: PROVIDER_PRESETS.sen,
    };
  }

  // If user provided custom models, merge with preset
  const preset = PROVIDER_PRESETS[provider];
  const customModels = paiConfig.models || {};

  const models: PaiModelConfig["models"] = {
    default: customModels.default || preset.default,
    validation: customModels.validation || preset.validation,
    agents: {
      intern: customModels.agents?.intern || preset.agents.intern,
      architect: customModels.agents?.architect || preset.agents.architect,
      engineer: customModels.agents?.engineer || preset.agents.engineer,
      explorer: customModels.agents?.explorer || preset.agents.explorer,
      reviewer: customModels.agents?.reviewer || preset.agents.reviewer,
    },
  };

  fileLog("model-config", `Using provider "${provider}" with models: ${JSON.stringify(models)}`);

  return {
    model_provider: provider,
    models,
  };
}

/**
 * Get a specific model by purpose
 * Supports dot notation for nested paths (e.g., "agents.intern")
 */
export function getModel(
  purpose:
    | "default"
    | "validation"
    | "agents.intern"
    | "agents.architect"
    | "agents.engineer"
    | "agents.explorer"
    | "agents.reviewer"
): string {
  const config = getModelConfig();
  const models = config.models;

  // Handle nested paths (agents.*)
  if (purpose.startsWith("agents.")) {
    const agentType = purpose.split(".")[1] as keyof PaiModelConfig["models"]["agents"];
    return models.agents[agentType];
  }

  // Handle top-level paths
  if (purpose === "default" || purpose === "validation") {
    return models[purpose];
  }

  // Fallback to default
  fileLog("model-config", `Unknown purpose "${purpose}", falling back to default`);
  return models.default;
}

/**
 * Get all agent models as a map
 */
export function getAgentModels(): Record<string, string> {
  const config = getModelConfig();
  return config.models.agents;
}

/**
 * Check if API key is required for current provider
 */
export function requiresApiKey(): boolean {
  const config = getModelConfig();
  return config.model_provider !== "sen";
}

/**
 * Get the current provider name
 */
export function getProvider(): "sen" | "anthropic" | "openai" {
  const config = getModelConfig();
  return config.model_provider;
}
