import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleToolExecuteBefore } from "../../plugins/pai-cc-hooks/tool-before";

async function createRtkShim(args: { mode: "prefix" | "same" }): Promise<string> {
	const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-hooks-rtk-shim-"));
	const shimPath = path.join(shimDir, "rtk");
	const rewriteCommand =
		args.mode === "prefix" ? 'printf "rtk %s\\n" "$*"' : 'printf "%s\\n" "$*"';
	const script = `#!/bin/sh
if [ "$1" = "rewrite" ]; then
  shift
  ${rewriteCommand}
  exit 0
fi
exit 1
`;

	await fs.writeFile(shimPath, script, { mode: 0o755 });
	await fs.chmod(shimPath, 0o755);
	return shimDir;
}

function prependPath(binDir: string): string {
	const existingPath = process.env.PATH ?? "";
	return existingPath.length > 0 ? `${binDir}:${existingPath}` : binDir;
}

async function withRtkRuntime<T>(args: {
	runtimeRoot: string;
	pathValue: string;
	run: () => Promise<T>;
}): Promise<T> {
	const previousRoot = process.env.OPENCODE_ROOT;
	const previousConfigRoot = process.env.OPENCODE_CONFIG_ROOT;
	const previousPath = process.env.PATH;

	process.env.OPENCODE_ROOT = args.runtimeRoot;
	delete process.env.OPENCODE_CONFIG_ROOT;
	process.env.PATH = args.pathValue;

	try {
		return await args.run();
	} finally {
		if (previousRoot === undefined) {
			delete process.env.OPENCODE_ROOT;
		} else {
			process.env.OPENCODE_ROOT = previousRoot;
		}

		if (previousConfigRoot === undefined) {
			delete process.env.OPENCODE_CONFIG_ROOT;
		} else {
			process.env.OPENCODE_CONFIG_ROOT = previousConfigRoot;
		}

		if (previousPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = previousPath;
		}
	}
}

async function writeCapabilityCache(args: {
	runtimeRoot: string;
	capability: { present: boolean; version: string | null; supportsRewrite: boolean };
}): Promise<void> {
	const cachePath = path.join(
		args.runtimeRoot,
		"MEMORY",
		"STATE",
		"rtk",
		"capability.json",
	);
	await fs.mkdir(path.dirname(cachePath), { recursive: true });
	await fs.writeFile(cachePath, `${JSON.stringify(args.capability, null, 2)}\n`, "utf8");
}

async function runToolBefore(args: {
	runtimeRoot: string;
	command: string;
}): Promise<string> {
	const output: { args: Record<string, unknown> } = {
		args: {
			command: args.command,
			workdir: args.runtimeRoot,
			description: "Runs test command",
		},
	};

	await handleToolExecuteBefore({
		input: {
			tool: "bash",
			sessionID: "ses_test",
			callID: "call_test",
		},
		output,
		config: null,
		cwd: args.runtimeRoot,
	});

	return String((output.args as Record<string, unknown>).command ?? "");
}

describe("pai-cc-hooks RTK rewrite integration", () => {
	test("rewrites bash commands through rtk when cache supports rewrite", async () => {
		const runtimeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-cc-hooks-rtk-runtime-"),
		);
		const shimDir = await createRtkShim({ mode: "prefix" });

		try {
			await writeCapabilityCache({
				runtimeRoot,
				capability: {
					present: true,
					version: "0.23.0",
					supportsRewrite: true,
				},
			});

			const command = await withRtkRuntime({
				runtimeRoot,
				pathValue: prependPath(shimDir),
				run: () => runToolBefore({ runtimeRoot, command: "git status" }),
			});

			expect(command).toBe("rtk git status");
		} finally {
			await fs.rm(shimDir, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("fails open when capability cache is missing", async () => {
		const runtimeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-cc-hooks-rtk-runtime-"),
		);
		const shimDir = await createRtkShim({ mode: "prefix" });

		try {
			const command = await withRtkRuntime({
				runtimeRoot,
				pathValue: prependPath(shimDir),
				run: () => runToolBefore({ runtimeRoot, command: "git status" }),
			});

			expect(command).toBe("git status");
		} finally {
			await fs.rm(shimDir, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("fails open when cache says rewrite unsupported", async () => {
		const runtimeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-cc-hooks-rtk-runtime-"),
		);
		const shimDir = await createRtkShim({ mode: "prefix" });

		try {
			await writeCapabilityCache({
				runtimeRoot,
				capability: {
					present: true,
					version: "0.22.9",
					supportsRewrite: false,
				},
			});

			const command = await withRtkRuntime({
				runtimeRoot,
				pathValue: prependPath(shimDir),
				run: () => runToolBefore({ runtimeRoot, command: "git status" }),
			});

			expect(command).toBe("git status");
		} finally {
			await fs.rm(shimDir, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("leaves commands already prefixed with rtk unchanged", async () => {
		const runtimeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-cc-hooks-rtk-runtime-"),
		);
		const shimDir = await createRtkShim({ mode: "prefix" });

		try {
			await writeCapabilityCache({
				runtimeRoot,
				capability: {
					present: true,
					version: "0.23.0",
					supportsRewrite: true,
				},
			});

			const command = await withRtkRuntime({
				runtimeRoot,
				pathValue: prependPath(shimDir),
				run: () => runToolBefore({ runtimeRoot, command: "rtk git status" }),
			});

			expect(command).toBe("rtk git status");
		} finally {
			await fs.rm(shimDir, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("fails open when rtk rewrite returns unchanged command", async () => {
		const runtimeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-cc-hooks-rtk-runtime-"),
		);
		const shimDir = await createRtkShim({ mode: "same" });

		try {
			await writeCapabilityCache({
				runtimeRoot,
				capability: {
					present: true,
					version: "0.23.0",
					supportsRewrite: true,
				},
			});

			const command = await withRtkRuntime({
				runtimeRoot,
				pathValue: prependPath(shimDir),
				run: () => runToolBefore({ runtimeRoot, command: "git status" }),
			});

			expect(command).toBe("git status");
		} finally {
			await fs.rm(shimDir, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});
});
