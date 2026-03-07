import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

function readDoc(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

test("security docs describe current canonical architecture and adapters", () => {
  const architecture = readDoc(
    ".opencode",
    "skills",
    "PAI",
    "SYSTEM",
    "PAISECURITYSYSTEM",
    "ARCHITECTURE.md",
  );
  const hooks = readDoc(
    ".opencode",
    "skills",
    "PAI",
    "SYSTEM",
    "PAISECURITYSYSTEM",
    "HOOKS.md",
  );
  const plugins = readDoc(
    ".opencode",
    "skills",
    "PAI",
    "SYSTEM",
    "PAISECURITYSYSTEM",
    "PLUGINS.md",
  );
  const memory = readDoc(
    ".opencode",
    "skills",
    "PAI",
    "SYSTEM",
    "MEMORYSYSTEM.md",
  );

  expect(architecture).toContain(".opencode/pai-unified.ts");
  expect(architecture).toContain("deprecated");
  expect(architecture).toContain(".opencode/plugins/security/");
  expect(architecture).toContain(".opencode/plugins/handlers/security-validator.ts");
  expect(architecture).toContain(".opencode/mcp/research-shell/security-adapter.ts");

  expect(hooks).toContain(".opencode/hooks/SecurityValidator.hook.ts");
  expect(hooks).toContain(".opencode/plugins/pai-cc-hooks/tool-before.ts");
  expect(hooks).toContain(".opencode/plugins/pai-cc-hooks/security-adapter.ts");
  expect(hooks).toContain(".opencode/plugins/pai-cc-hooks/claude/pre-tool-use.ts");
  expect(hooks).toContain("no internal CLI composition");

  expect(plugins).toContain(".opencode/plugins/security/index.ts");
  expect(plugins).toContain(".opencode/plugins/handlers/security-validator.ts");
  expect(plugins).toContain(".opencode/mcp/research-shell/security-adapter.ts");
  expect(plugins).toContain("Known follow-ups");

  expect(memory).toContain("plugins/security/audit-log.ts");
  expect(memory).toContain("mcp/research-shell/security-adapter.ts");
  expect(memory).toContain("MEMORY/SECURITY/YYYY-MM/security.jsonl");
});
