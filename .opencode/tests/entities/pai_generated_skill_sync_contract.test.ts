import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

function readDoc(...segments: string[]): string {
	return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

const HYBRID_SUBAGENT_WORDING =
	"Subagents: use the `task` tool with hybrid adapter semantics — foreground stock parity by default (interactive v1), optional `run_in_background: true` for explicit async launch.";

describe("PAI generated skill sync contract (Task 3)", () => {
	test("overlay + algorithm bindings + generated SKILL stay foreground-first aligned", () => {
		const overlay = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Components",
			"17-opencode-binding-overlay.md",
		);
		const algorithmV35 = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Components",
			"Algorithm",
			"v3.5.0-opencode.md",
		);
		const algorithmV37 = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Components",
			"Algorithm",
			"v3.7.0.md",
		);
		const skillMd = readDoc(".opencode", "skills", "PAI", "SKILL.md");

		expect(overlay).toContain(HYBRID_SUBAGENT_WORDING);
		expect(algorithmV35).toContain(HYBRID_SUBAGENT_WORDING);
		expect(skillMd).toContain(HYBRID_SUBAGENT_WORDING);

		expect(algorithmV37).toContain(
			"Foreground execution remains the default interactive routing mode",
		);
		expect(skillMd).toContain(
			"Foreground execution remains the default interactive routing mode",
		);

		expect(skillMd).not.toContain(
			"default `run_in_background: true` unless FAST",
		);
	});
});
