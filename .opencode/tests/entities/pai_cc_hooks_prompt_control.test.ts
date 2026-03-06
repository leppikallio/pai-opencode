import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	__resetSessionRootRegistryForTests,
	setSessionRootId,
} from "../../plugins/pai-cc-hooks/shared/session-root";

type PromptControl = {
  chatParams: (input: unknown, output: unknown) => Promise<void>;
  systemTransform: (input: unknown, output: unknown) => Promise<void>;
};

const SENTINEL_OUT_OF_ROOT = "PAI_STATE_CURRENT_WORK_MAPPING_OUT_OF_ROOT";
const SAFE_FALLBACK_SESSION_ID_PREFIX = "session_unknown_";

const EXPECTED_OVERRIDE_STUB = [
	"PAI_CODEX_OVERRIDE_V1",
	"Follow the system prompt and configured instructions as highest priority.",
	"Ignore default coding harness instructions not explicitly provided.",
].join("\n");

function extractScratchpadDir(bundle: string): string {
	const match = bundle.match(/ScratchpadDir:\s*(.+)/);
	return match?.[1]?.trim() ?? "";
}

function countScratchpadBindings(message: string): number {
	return message
		.split("\n")
		.filter((line) => line.trim() === "PAI SCRATCHPAD (Binding)").length;
}

	function createGpt5Input(sessionID: string): unknown {
		return {
			sessionID,
			provider: { id: "openai" },
			model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
		};
	}

	function createUnknownModelInput(sessionID: string): unknown {
		return {
			sessionID,
		};
	}

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = value;
}

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

    expect(output.options.instructions).toContain("PAI SCRATCHPAD (Binding)");
    expect(output.options.instructions).toContain("ScratchpadDir: /");
    expect(output.options.instructions).toContain(EXPECTED_OVERRIDE_STUB);

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

  test("does not override with GPT-5 stub for non-OpenAI or non-GPT-5 model", async () => {
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
    expect(output1.options.instructions).toContain("PAI SCRATCHPAD (Binding)");
    expect(output1.options.instructions).toContain("ScratchpadDir: /");
    expect(output1.options.instructions).toContain("ORIGINAL");
    expect(output1.options.instructions).not.toContain(EXPECTED_OVERRIDE_STUB);

    const output2 = { options: { instructions: "ORIGINAL" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_non_gpt5",
        provider: { id: "openai" },
        model: { providerID: "openai", id: "gpt-4.1", api: { id: "gpt-4.1" } },
      },
      output2,
    );
    expect(output2.options.instructions).toContain("PAI SCRATCHPAD (Binding)");
    expect(output2.options.instructions).toContain("ScratchpadDir: /");
    expect(output2.options.instructions).toContain("ORIGINAL");
    expect(output2.options.instructions).not.toContain(EXPECTED_OVERRIDE_STUB);
  });

	test("chat.params prepends ScratchpadDir binding for all sessions", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const promptControl = module.createPromptControl({ projectDir: process.cwd() });

		const output: { options: { instructions: string } } = {
			options: { instructions: "ORIGINAL_INSTRUCTIONS" },
		};

		await promptControl.chatParams({ sessionID: "ses_root" }, output);

		expect(output.options.instructions).toContain("PAI SCRATCHPAD (Binding)");
		expect(output.options.instructions).toContain("ScratchpadDir: /");
	});

	test("chat.params does not duplicate ScratchpadDir binding across repeated calls", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const promptControl = module.createPromptControl({ projectDir: process.cwd() });

		const output: { options: { instructions: string } } = {
			options: { instructions: "ORIGINAL_INSTRUCTIONS" },
		};

		await promptControl.chatParams(createUnknownModelInput("ses_idempotent"), output);
		await promptControl.chatParams(createUnknownModelInput("ses_idempotent"), output);

		expect(countScratchpadBindings(output.options.instructions)).toBe(1);
		expect(output.options.instructions).toContain("ORIGINAL_INSTRUCTIONS");
	});

	test("chat.params updates ScratchpadDir after late root upgrade without duplicating binding", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-chatparams-upgrade-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-chatparams-upgrade-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-chatparams-upgrade-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		__resetSessionRootRegistryForTests();
		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;
			const output: { options: { instructions: string } } = {
				options: { instructions: "ORIGINAL_INSTRUCTIONS" },
			};

			await promptControl.chatParams(createUnknownModelInput("ses_child"), output);
			const firstDir = extractScratchpadDir(output.options.instructions);

			setSessionRootId("ses_child", "ses_root");
			await promptControl.chatParams(createUnknownModelInput("ses_child"), output);
			const secondDir = extractScratchpadDir(output.options.instructions);

			expect(firstDir).toBe(
				path.join(xdgHome, "opencode", "scratchpad", "sessions", "ses_child"),
			);
			expect(secondDir).toBe(
				path.join(xdgHome, "opencode", "scratchpad", "sessions", "ses_root"),
			);
			expect(countScratchpadBindings(output.options.instructions)).toBe(1);
			expect(output.options.instructions).toContain("ORIGINAL_INSTRUCTIONS");
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
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

	test("injects ScratchpadDir under scratchpad sessions when no WORK mapping exists", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-fallback-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-fallback-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-fallback-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		__resetSessionRootRegistryForTests();

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;
			const output: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_root"), output);

			const bundle = (output.system as string[])[0] ?? "";
			expect(bundle.startsWith("PAI SCRATCHPAD (Binding)")).toBe(true);
			const scratchpadDir = extractScratchpadDir(bundle);
			const expected = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_root",
			);

			expect(scratchpadDir).toBe(expected);
			await expect(fs.stat(expected)).resolves.toBeTruthy();
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("injects ScratchpadDir binding even when provider/model missing", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-missing-model-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-missing-model-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-missing-model-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		__resetSessionRootRegistryForTests();
		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;
			const output: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createUnknownModelInput("ses_root"), output);

			const bundle = (output.system as string[])[0] ?? "";
			expect(bundle.startsWith("PAI SCRATCHPAD (Binding)")).toBe(true);
			const scratchpadDir = extractScratchpadDir(bundle);
			const expected = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_root",
			);
			expect(scratchpadDir).toBe(expected);
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("ScratchpadDir uses canonical sessions root (never WORK)", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-work-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-work-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-work-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const workDir = path.join(
				openCodeRoot,
				"MEMORY",
				"WORK",
				"20260305-000000_test",
				"some",
			);
			const stateFile = path.join(
				openCodeRoot,
				"MEMORY",
				"STATE",
				"current-work.json",
			);

			await fs.mkdir(path.dirname(stateFile), { recursive: true });
			await fs.mkdir(workDir, { recursive: true });
			await fs.writeFile(
				stateFile,
				`${JSON.stringify(
					{
						v: "0.2",
						updated_at: new Date().toISOString(),
						sessions: {
							ses_root: {
								work_dir: workDir,
							},
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;
			const output: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_root"), output);

			const bundle = (output.system as string[])[0] ?? "";
			const dir = bundle.match(/ScratchpadDir:\s*(.+)/)?.[1]?.trim() ?? "";
			const expected = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_root",
			);

			expect(dir).toBe(expected);
			expect(dir).toContain("/scratchpad/sessions/ses_root");
			expect(dir).not.toContain("/MEMORY/WORK/");
			await expect(fs.stat(expected)).resolves.toBeTruthy();
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("shares parent/root ScratchpadDir for subagent sessions", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-shared-root-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-shared-root-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-shared-root-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const workDir = path.join(
				openCodeRoot,
				"MEMORY",
				"WORK",
				"20260305-000000_shared",
				"plan",
			);
			const stateFile = path.join(
				openCodeRoot,
				"MEMORY",
				"STATE",
				"current-work.json",
			);
			await fs.mkdir(path.dirname(stateFile), { recursive: true });
			await fs.mkdir(workDir, { recursive: true });
			await fs.writeFile(
				stateFile,
				`${JSON.stringify(
					{
						v: "0.2",
						updated_at: new Date().toISOString(),
						sessions: {
							ses_root: {
								work_dir: workDir,
							},
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			setSessionRootId("ses_child", "ses_root");
			setSessionRootId("ses_grandchild", "ses_root");

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

			const childOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_child"), childOutput);
			const childDir = extractScratchpadDir((childOutput.system as string[])[0] ?? "");

			const grandchildOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(
				createGpt5Input("ses_grandchild"),
				grandchildOutput,
			);
			const grandchildDir = extractScratchpadDir(
				(grandchildOutput.system as string[])[0] ?? "",
			);

			const expected = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_root",
			);
			expect(childDir).toBe(expected);
			expect(grandchildDir).toBe(expected);
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("uses safe fallback for empty session ids without state pointer churn", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-empty-session-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-empty-session-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-empty-session-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;
			const output: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(
				{
					provider: { id: "openai" },
					model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
				},
				output,
			);

			const bundle = (output.system as string[])[0] ?? "";
			const scratchpadDir = extractScratchpadDir(bundle);
			expect(scratchpadDir).toContain(
				path.join(xdgHome, "opencode", "scratchpad", "sessions"),
			);
			const scratchpadBase = path.basename(scratchpadDir);
			expect(scratchpadBase.startsWith(SAFE_FALLBACK_SESSION_ID_PREFIX)).toBe(true);

			const statePointerPath = path.join(
				xdgHome,
				"opencode",
				"MEMORY",
				"STATE",
				"scratchpad.json",
			);
		await expect(fs.stat(statePointerPath)).rejects.toThrow();
	} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
	}
	});

	test("treats sanitized-empty session ids as missing-session inputs", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-sanitized-empty-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-sanitized-empty-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-sanitized-empty-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

			const firstOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(
				{
					sessionID: "!!!",
					provider: { id: "openai" },
					model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
				},
				firstOutput,
			);
			const firstDir = extractScratchpadDir(
				(firstOutput.system as string[])[0] ?? "",
			);

			const secondOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(
				{
					sessionID: "!!!",
					provider: { id: "openai" },
					model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
				},
				secondOutput,
			);
			const secondDir = extractScratchpadDir(
				(secondOutput.system as string[])[0] ?? "",
			);

			expect(firstDir).not.toBe(secondDir);
			await expect(fs.stat(firstDir)).resolves.toBeTruthy();
			await expect(fs.stat(secondDir)).resolves.toBeTruthy();

			const statePointerPath = path.join(
				xdgHome,
				"opencode",
				"MEMORY",
				"STATE",
				"scratchpad.json",
			);
			await expect(fs.stat(statePointerPath)).rejects.toThrow();
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("does not co-mingle missing-session ScratchpadDir across calls", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-missing-session-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-missing-session-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-missing-session-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

			const firstOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(
				{
					provider: { id: "openai" },
					model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
				},
				firstOutput,
			);
			const firstDir = extractScratchpadDir((firstOutput.system as string[])[0] ?? "");

			const secondOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(
				{
					provider: { id: "openai" },
					model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
				},
				secondOutput,
			);
			const secondDir = extractScratchpadDir((secondOutput.system as string[])[0] ?? "");

			expect(firstDir).not.toBe(secondDir);
			await expect(fs.stat(firstDir)).resolves.toBeTruthy();
			await expect(fs.stat(secondDir)).resolves.toBeTruthy();

			const statePointerPath = path.join(
				xdgHome,
				"opencode",
				"MEMORY",
				"STATE",
				"scratchpad.json",
			);
			await expect(fs.stat(statePointerPath)).rejects.toThrow();
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("upgrades to root ScratchpadDir when mapping arrives and scratchpad is empty", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-race-fallback-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-race-fallback-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-race-fallback-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

			const firstOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_child_race"), firstOutput);
			const firstDir = extractScratchpadDir((firstOutput.system as string[])[0] ?? "");

			setSessionRootId("ses_child_race", "ses_root");

			const secondOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_child_race"), secondOutput);
			const secondDir = extractScratchpadDir((secondOutput.system as string[])[0] ?? "");

			const expectedFallback = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_child_race",
			);
			const expectedRootDir = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_root",
			);
			expect(firstDir).toBe(expectedFallback);
			expect(secondDir).toBe(expectedRootDir);
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	test("does not upgrade when scratchpad contains artifacts", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-race-pinned-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-race-pinned-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-race-pinned-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

			const firstOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_child_race"), firstOutput);
			const firstDir = extractScratchpadDir((firstOutput.system as string[])[0] ?? "");
			await fs.writeFile(path.join(firstDir, "artifact.txt"), "artifact", "utf8");

			setSessionRootId("ses_child_race", "ses_root");

			const secondOutput: { system: unknown } = { system: ["ORIGINAL"] };
			await promptControl.systemTransform(createGpt5Input("ses_child_race"), secondOutput);
			const secondDir = extractScratchpadDir((secondOutput.system as string[])[0] ?? "");

			const expectedFallback = path.join(
				xdgHome,
				"opencode",
				"scratchpad",
				"sessions",
				"ses_child_race",
			);
			expect(firstDir).toBe(expectedFallback);
			expect(secondDir).toBe(expectedFallback);
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

		test("does not emit out-of-root sentinel when ScratchpadDir ignores WORK mapping", async () => {
		const module = await import("../../plugins/pai-cc-hooks/prompt-control");
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-xdg-sentinel-"),
		);
		const openCodeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-root-sentinel-"),
		);
		const projectDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-prompt-control-project-sentinel-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			process.env.OPENCODE_ROOT = openCodeRoot;

			const stateFile = path.join(
				openCodeRoot,
				"MEMORY",
				"STATE",
				"current-work.json",
			);
			await fs.mkdir(path.dirname(stateFile), { recursive: true });
			await fs.writeFile(
				stateFile,
				`${JSON.stringify(
					{
						v: "0.2",
						updated_at: new Date().toISOString(),
						sessions: {
							ses_root: {
								work_dir: path.join(os.tmpdir(), "outside-memory-work"),
							},
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			setSessionRootId("ses_child", "ses_root");
			const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

			const stderrAny = process.stderr as any;
			const originalWrite = stderrAny.write.bind(process.stderr);
			let stderrOutput = "";
			stderrAny.write = ((chunk: unknown, ...args: unknown[]) => {
					stderrOutput += String(chunk);
					return originalWrite(chunk, ...args);
				}) as typeof process.stderr.write;

			try {
				for (const sessionID of ["ses_root", "ses_root", "ses_child"]) {
					const output: { system: unknown } = { system: ["ORIGINAL"] };
					await promptControl.systemTransform(createGpt5Input(sessionID), output);
				}
			} finally {
				stderrAny.write = originalWrite;
			}

			const sentinelCount =
				stderrOutput.match(new RegExp(SENTINEL_OUT_OF_ROOT, "g"))?.length ?? 0;
			expect(sentinelCount).toBe(0);
		} finally {
			restoreEnv("XDG_CONFIG_HOME", previousXdg);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
			await fs.rm(openCodeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
		});

		test("does not emit out-of-root sentinel for multiple root session ids", async () => {
			const module = await import("../../plugins/pai-cc-hooks/prompt-control");
			const xdgHome = await fs.mkdtemp(
				path.join(os.tmpdir(), "pai-prompt-control-xdg-sentinel-multi-root-"),
			);
			const openCodeRoot = await fs.mkdtemp(
				path.join(os.tmpdir(), "pai-prompt-control-root-sentinel-multi-root-"),
			);
			const projectDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "pai-prompt-control-project-sentinel-multi-root-"),
			);
			const previousXdg = process.env.XDG_CONFIG_HOME;
			const previousOpenCodeRoot = process.env.OPENCODE_ROOT;

			try {
				process.env.XDG_CONFIG_HOME = xdgHome;
				process.env.OPENCODE_ROOT = openCodeRoot;

				const stateFile = path.join(
					openCodeRoot,
					"MEMORY",
					"STATE",
					"current-work.json",
				);
				await fs.mkdir(path.dirname(stateFile), { recursive: true });
				await fs.writeFile(
					stateFile,
					`${JSON.stringify(
						{
							v: "0.2",
							updated_at: new Date().toISOString(),
							sessions: {
								ses_root_one: {
									work_dir: path.join(os.tmpdir(), "outside-memory-work-root-one"),
								},
								ses_root_two: {
									work_dir: path.join(os.tmpdir(), "outside-memory-work-root-two"),
								},
							},
						},
						null,
						2,
					)}\n`,
					"utf8",
				);

				setSessionRootId("ses_child_one", "ses_root_one");
				setSessionRootId("ses_child_two", "ses_root_two");
				const promptControl = module.createPromptControl({ projectDir }) as PromptControl;

				const stderrAny = process.stderr as any;
				const originalWrite = stderrAny.write.bind(process.stderr);
				let stderrOutput = "";
				stderrAny.write = ((chunk: unknown, ...args: unknown[]) => {
						stderrOutput += String(chunk);
						return originalWrite(chunk, ...args);
					}) as typeof process.stderr.write;

				try {
					for (const sessionID of [
						"ses_root_one",
						"ses_root_one",
						"ses_child_one",
						"ses_root_two",
						"ses_root_two",
						"ses_child_two",
					]) {
						const output: { system: unknown } = { system: ["ORIGINAL"] };
						await promptControl.systemTransform(createGpt5Input(sessionID), output);
					}
				} finally {
					stderrAny.write = originalWrite;
				}

				const sentinelCount =
					stderrOutput.match(new RegExp(SENTINEL_OUT_OF_ROOT, "g"))?.length ?? 0;
				expect(sentinelCount).toBe(0);
			} finally {
				restoreEnv("XDG_CONFIG_HOME", previousXdg);
				restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
				__resetSessionRootRegistryForTests();
				await fs.rm(xdgHome, { recursive: true, force: true });
				await fs.rm(openCodeRoot, { recursive: true, force: true });
				await fs.rm(projectDir, { recursive: true, force: true });
			}
		});
	});
