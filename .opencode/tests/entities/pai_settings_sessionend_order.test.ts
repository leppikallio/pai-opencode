import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

describe("settings SessionEnd hook order", () => {
  test("matches the required execution sequence", async () => {
    const paiDir = "$" + "{PAI_DIR}";
    const settingsPath = fileURLToPath(new URL("../../settings.json", import.meta.url));
    const settingsText = await Bun.file(settingsPath).text();
    const settings = JSON.parse(settingsText) as {
      hooks?: { SessionEnd?: Array<{ hooks?: Array<{ command?: string }> }> };
    };

    const actual = settings.hooks?.SessionEnd?.[0]?.hooks?.map((hook) => hook.command) ?? [];

    expect(actual).toEqual([
      `${paiDir}/hooks/WorkCompletionLearning.hook.ts`,
      `${paiDir}/hooks/RelationshipMemory.hook.ts`,
      `${paiDir}/hooks/UpdateCounts.hook.ts`,
      `${paiDir}/hooks/IntegrityCheck.hook.ts`,
      `${paiDir}/hooks/SessionSummary.hook.ts`,
    ]);
  });
});
