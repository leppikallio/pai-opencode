import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type CliRunResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

const paiTuiCliPath = fileURLToPath(
	new URL("../../pai-tools/pai-tui.ts", import.meta.url),
);

const testsRoot = fileURLToPath(new URL("../..", import.meta.url));

function runPaiTuiCli(args: string[]): Promise<CliRunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", [paiTuiCliPath, ...args], {
			cwd: testsRoot,
			shell: false,
			env: {
				...process.env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`pai-tui CLI timed out: ${args.join(" ")}`));
		}, 5000);

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr });
		});
	});
}

describe("pai-tui CLI contract", () => {
	test("--help exits 0 and prints usage", async () => {
		const out = await runPaiTuiCli(["--help"]);
		expect(out.signal).toBeNull();
		expect(out.code).toBe(0);
		expect(out.stdout).toContain("pai-tui");
		expect(out.stdout).toContain("Usage:");
		expect(out.stdout).toContain("--codex-clean-slate <on|off>");
		expect(out.stdout).toContain("omit flag to inherit");
	});
});
