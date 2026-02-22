import { describe, expect, test } from "bun:test";

import type { ClaudeHooksConfig } from "../../plugins/pai-cc-hooks/claude/types";
import { collectMatchingHookCommands } from "../../plugins/pai-cc-hooks/shared/pattern-matcher";

describe("collectMatchingHookCommands for ApplyPatch aliases", () => {
  test("includes ApplyPatch, Edit, and Write matchers", () => {
    const config: ClaudeHooksConfig = {
      PreToolUse: [
        { matcher: "ApplyPatch", hooks: [{ type: "command", command: "hooks/apply.sh" }] },
        { matcher: "Edit", hooks: [{ type: "command", command: "hooks/edit.sh" }] },
        { matcher: "Write", hooks: [{ type: "command", command: "hooks/write.sh" }] },
      ],
    };

    const commands = collectMatchingHookCommands(config, "PreToolUse", ["ApplyPatch", "Edit", "Write"]);

    expect(commands).toEqual(["hooks/apply.sh", "hooks/edit.sh", "hooks/write.sh"]);
  });

  test("dedupes duplicate hook commands across aliases", () => {
    const config: ClaudeHooksConfig = {
      PreToolUse: [
        { matcher: "ApplyPatch", hooks: [{ type: "command", command: "hooks/shared.sh" }] },
        { matcher: "Edit", hooks: [{ type: "command", command: "hooks/shared.sh" }] },
        {
          matcher: "Write",
          hooks: [
            { type: "command", command: "hooks/shared.sh" },
            { type: "command", command: "hooks/write-only.sh" },
          ],
        },
      ],
    };

    const commands = collectMatchingHookCommands(config, "PreToolUse", ["ApplyPatch", "Edit", "Write"]);

    expect(commands).toEqual(["hooks/shared.sh", "hooks/write-only.sh"]);
  });

  test("executes all distinct commands across matching matchers", () => {
    const config: ClaudeHooksConfig = {
      PreToolUse: [
        {
          matcher: "ApplyPatch",
          hooks: [
            { type: "command", command: "hooks/first.sh" },
            { type: "command", command: "hooks/shared.sh" },
          ],
        },
        {
          matcher: "Edit",
          hooks: [
            { type: "command", command: "hooks/shared.sh" },
            { type: "command", command: "hooks/second.sh" },
          ],
        },
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "hooks/third.sh" }],
        },
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "hooks/fourth.sh" }],
        },
      ],
    };

    const commands = collectMatchingHookCommands(config, "PreToolUse", ["ApplyPatch", "Edit", "Write"]);

    expect(commands).toEqual([
      "hooks/first.sh",
      "hooks/shared.sh",
      "hooks/second.sh",
      "hooks/fourth.sh",
      "hooks/third.sh",
    ]);
  });
});
