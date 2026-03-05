import { describe, expect, test } from "bun:test";

import { generateSettingsJson } from "../../PAIOpenCodeWizard";

describe("generateSettingsJson", () => {
  test("defaults dynamic context parity and excludes PAI SKILL.md from contextFiles", () => {
    const config: Parameters<typeof generateSettingsJson>[0] = {
      PRINCIPAL_NAME: "User",
      TIMEZONE: "Europe/Vienna",
      AI_NAME: "PAI",
      CATCHPHRASE: "PAI here, ready to help.",
      PROVIDER: {
        id: "openai",
        name: "OpenAI (GPT-5.2)",
        defaultModel: "openai/gpt-5.2",
        description: "GPT-5.2 model",
        authType: "oauth",
      },
      VOICE_TYPE: "male",
    };

    const settings = generateSettingsJson(config, "/tmp/pai") as {
      dynamicContext?: boolean;
      loadAtStartup?: { files?: string[] };
      contextFiles?: string[];
      env?: Record<string, string>;
    };

    expect(settings.dynamicContext).toBe(true);
    expect(settings.loadAtStartup?.files).toEqual([]);
    expect(settings.contextFiles).toBeArray();
    expect(settings.contextFiles).not.toContain("skills/PAI/SKILL.md");
    expect(Object.keys(settings.env ?? {}).some((key) => key.startsWith("CLAUDE_CODE_"))).toBe(false);
  });
});
