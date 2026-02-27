import { describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

type HelpResult = SpawnSyncReturns<string>;

function runCmuxHelp(args: string[]): HelpResult {
  return spawnSync("cmux", args, {
    encoding: "utf8",
    shell: false,
  });
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}

function combinedOutput(result: HelpResult): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

const cmuxHelpProbe = runCmuxHelp(["--help"]);
const maybeTest = isEnoent(cmuxHelpProbe.error) ? test.skip : test;

describe("cmux CLI contract smoke", () => {
  maybeTest("help output contains required contract checklist entries", () => {
    const cmuxHelp = runCmuxHelp(["--help"]);
    expect(cmuxHelp.status).toBe(0);

    const cmuxNotifyHelp = runCmuxHelp(["notify", "--help"]);
    expect(cmuxNotifyHelp.status).toBe(0);

    const cmuxTabActionHelp = runCmuxHelp(["tab-action", "--help"]);
    expect(cmuxTabActionHelp.status).toBe(0);

    const root = normalize(combinedOutput(cmuxHelp));
    const notify = normalize(combinedOutput(cmuxNotifyHelp));
    const tabAction = normalize(combinedOutput(cmuxTabActionHelp));

    // These are the required checklist entries from the plan (Task 0.5).
    // We intentionally require ALL of them so contract drift fails loudly.
    const checks: Array<{ id: string; ok: boolean }> = [
      {
        id: "notify_title",
        ok: /notify\s+--title\s+<text>/.test(root)
          || /--title\s+<text>/.test(notify)
          || /cmux notify --title/.test(notify),
      },
      { id: "workspace_target", ok: /--workspace\s+<id\|ref>/.test(notify) },
      { id: "surface_target", ok: /--surface\s+<id\|ref>/.test(notify) },
      { id: "clear_status", ok: /clear-status\s+<key>/.test(root) },
      { id: "clear_progress", ok: /\bclear-progress\b/.test(root) },
      { id: "tab_action", ok: /tab-action\s+--action\s+<name>/.test(root) },
      { id: "clear_name_action", ok: /\bclear-name\b/.test(tabAction) },
      {
        id: "capabilities_json",
        ok: /\bcapabilities\b/.test(root) && /\[--json\]/.test(root),
      },
      { id: "list_notifications", ok: /\blist-notifications\b/.test(root) },
    ];

    for (const { id, ok } of checks) {
      expect(ok, id).toBe(true);
    }
  });
});
