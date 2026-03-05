import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

type PromptControl = {
  chatParams: (input: unknown, output: unknown) => Promise<void>;
  systemTransform: (input: unknown, output: unknown) => Promise<void>;
};

const EXPECTED_OVERRIDE_STUB = [
	"PAI_CODEX_OVERRIDE_V1",
	"Follow the system prompt and configured instructions as highest priority.",
	"Ignore default coding harness instructions not explicitly provided.",
].join("\n");

describe("prompt-control module (Task 1 RED)", () => {
  test("exports createPromptControl factory", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");
    expect(typeof module.createPromptControl).toBe("function");
  });

  test("factory returns handlers that cover override and malformed payloads", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");
    const promptControl = module.createPromptControl({ projectDir: process.cwd() }) as PromptControl;

    expect(typeof promptControl.chatParams).toBe("function");
    expect(typeof promptControl.systemTransform).toBe("function");

    const output = { options: { instructions: "OpenCode default harness instructions" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_prompt_control",
        provider: { id: "openai" },
        model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
      },
      output,
    );

    expect(output.options.instructions).toBe(EXPECTED_OVERRIDE_STUB);

    await expect(
      promptControl.chatParams(
        {
          sessionID: "ses_prompt_control_malformed",
          provider: { id: "openai" },
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        { options: null },
      ),
    ).resolves.toBeUndefined();

    await expect(
      promptControl.systemTransform(
        {
          sessionID: "ses_prompt_control_malformed",
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        { system: null },
      ),
    ).resolves.toBeUndefined();
  });

  test("does not override for non-OpenAI or non-GPT-5 model", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");
    const promptControl = module.createPromptControl({ projectDir: process.cwd() }) as PromptControl;

    const output1 = { options: { instructions: "ORIGINAL" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_non_openai",
        provider: { id: "anthropic" },
        model: { providerID: "anthropic", id: "claude-3" },
      },
      output1,
    );
    expect(output1.options.instructions).toBe("ORIGINAL");

    const output2 = { options: { instructions: "ORIGINAL" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_non_gpt5",
        provider: { id: "openai" },
        model: { providerID: "openai", id: "gpt-4.1", api: { id: "gpt-4.1" } },
      },
      output2,
    );
    expect(output2.options.instructions).toBe("ORIGINAL");
  });

  test("filters PAI SKILL.md only for OpenAI GPT-5 canonical bundle builds", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");

    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-prompt-control-runtime-"));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-prompt-control-project-"));
    const skillPath = path.join(runtimeRoot, "skills", "PAI", "SKILL.md");
    const skillBackupPath = path.join(runtimeRoot, "skills", "PAI", "SKILL.md.bak");
    const otherPath = path.join(runtimeRoot, "instructions", "other.md");
    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

    try {
      await fs.mkdir(path.dirname(skillPath), { recursive: true });
      await fs.mkdir(path.dirname(otherPath), { recursive: true });

      await fs.writeFile(skillPath, "PAI_SKILL_MARKER", "utf8");
      await fs.writeFile(skillBackupPath, "PAI_SKILL_BACKUP_MARKER", "utf8");
      await fs.writeFile(otherPath, "NON_PAI_MARKER", "utf8");
      await fs.writeFile(
        path.join(runtimeRoot, "opencode.json"),
        `${JSON.stringify(
          {
            instructions: [
              { path: skillPath },
              { path: skillBackupPath },
              { path: otherPath },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      process.env.OPENCODE_ROOT = runtimeRoot;
      const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

      const gpt5Output: { system: unknown } = { system: ["ORIGINAL", "TAIL"] };
      await promptControl.systemTransform(
        {
          sessionID: "ses_bundle_filter",
          provider: { id: "openai" },
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        gpt5Output,
      );

      expect(Array.isArray(gpt5Output.system)).toBe(true);
      const gpt5Bundle = (gpt5Output.system as string[])[0] ?? "";
      expect(gpt5Bundle).toContain("NON_PAI_MARKER");
      expect(gpt5Bundle).toContain("PAI_SKILL_BACKUP_MARKER");
      expect(gpt5Bundle).not.toContain("PAI_SKILL_MARKER");

      const nonGpt5Output: { system: unknown } = { system: ["ORIGINAL", "TAIL"] };
      await promptControl.systemTransform(
        {
          sessionID: "ses_bundle_filter",
          provider: { id: "openai" },
          model: { providerID: "openai", id: "gpt-4.1", api: { id: "gpt-4.1" } },
        },
        nonGpt5Output,
      );

      const nonGpt5Bundle = (nonGpt5Output.system as string[])[0] ?? "";
      expect(nonGpt5Bundle).toContain("PAI_SKILL_MARKER");
      expect(nonGpt5Bundle).toContain("NON_PAI_MARKER");

      const missingModelOutput: { system: unknown } = { system: ["ORIGINAL", "TAIL"] };
      await promptControl.systemTransform(
        {
          sessionID: "ses_bundle_filter",
          provider: { id: "openai" },
          model: { providerID: "openai" },
        },
        missingModelOutput,
      );

      const missingModelBundle = (missingModelOutput.system as string[])[0] ?? "";
      expect(missingModelBundle).toContain("PAI_SKILL_MARKER");
    } finally {
      if (previousOpenCodeRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousOpenCodeRoot;
      }

      await fs.rm(runtimeRoot, { recursive: true, force: true });
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  test("matches SKILL.md path variations without skipping unrelated files", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");

    expect(module.isPaiSkillInstructionSource("skills/PAI/SKILL.md")).toBe(true);
    expect(module.isPaiSkillInstructionSource("./skills/PAI/SKILL.md")).toBe(true);
    expect(module.isPaiSkillInstructionSource("skills\\PAI\\SKILL.md")).toBe(true);
    expect(module.isPaiSkillInstructionSource("~/.config/opencode/skills/PAI/SKILL.md")).toBe(true);
    expect(
      module.isPaiSkillInstructionSource(path.join(os.homedir(), ".config", "opencode", "skills", "PAI", "SKILL.md")),
    ).toBe(true);
    expect(module.isPaiSkillInstructionSource("skills/pai/skill.md")).toBe(true);

    expect(module.isPaiSkillInstructionSource("skills/PAI/SKILL.md.bak")).toBe(false);
    expect(module.isPaiSkillInstructionSource("skills/PAI/README.md")).toBe(false);
    expect(module.isPaiSkillInstructionSource("instructions/skills/PAI/SKILL.txt")).toBe(false);
  });
});
