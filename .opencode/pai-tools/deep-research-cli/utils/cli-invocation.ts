import * as fs from "node:fs";
import * as path from "node:path";

const REPO_CLI_RELATIVE_PATH = ".opencode/pai-tools/deep-research-cli.ts";
const RUNTIME_CLI_RELATIVE_PATH = "pai-tools/deep-research-cli.ts";

export function resolveDeepResearchCliInvocation(): string {
  const repoCliPath = path.join(process.cwd(), REPO_CLI_RELATIVE_PATH);
  const cliPath = fs.existsSync(repoCliPath)
    ? REPO_CLI_RELATIVE_PATH
    : RUNTIME_CLI_RELATIVE_PATH;
  return `bun "${cliPath}"`;
}
