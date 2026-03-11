import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const runtimeRtkDocPath = path.join(repoRoot, ".opencode", "RTK.md");
const awarenessHookPath = path.join(repoRoot, ".opencode", "hooks", "RtkAwareness.hook.ts");

describe("RTK upstream semantic ownership contract (Task 5)", () => {
  test("RTK.md carries authority and tee/raw recovery semantics", () => {
    const runtimeRtkDoc = readFileSync(runtimeRtkDocPath, "utf8");

    expect(runtimeRtkDoc).toContain("RTK may rewrite shell commands transparently");
    expect(runtimeRtkDoc).toContain("RTK-proxied output is authoritative by default");
    expect(runtimeRtkDoc).toContain("Shorter optimized output is normal");
    expect(runtimeRtkDoc).toContain("Do not rerun raw commands outside RTK by default");
    expect(runtimeRtkDoc).toContain("If RTK emits a `[full output: ~/.local/share/rtk/tee/... ]` hint");
    expect(runtimeRtkDoc).toContain("OpenCode `Read`");
    expect(runtimeRtkDoc).toContain("`rtk proxy`");
    expect(runtimeRtkDoc).toContain("Read ~/.local/share/rtk/tee/<file>");
    expect(runtimeRtkDoc).toContain("rtk proxy cat ~/.local/share/rtk/tee/<file>");
  });

  test("RtkAwareness hook stays capability/status-only", () => {
    const awarenessHookSource = readFileSync(awarenessHookPath, "utf8");

    expect(awarenessHookSource).toContain("Detailed RTK semantics live in RTK.md.");
    expect(awarenessHookSource).toContain("This hook is capability/status reminder only.");
    expect(awarenessHookSource).toContain("rtk proxy <cmd>");
    expect(awarenessHookSource).toContain(
      "If RTK emits a tee/raw-output hint, follow RTK.md recovery guidance (OpenCode Read or rtk proxy).",
    );

    expect(awarenessHookSource).not.toContain("RTK-proxied output is authoritative by default");
    expect(awarenessHookSource).not.toContain("Shorter optimized output is normal");
    expect(awarenessHookSource).not.toContain("Raw-output/tee recovery is an exception path");
    expect(awarenessHookSource).not.toContain("Read ~/.local/share/rtk/tee/<file>");
    expect(awarenessHookSource).not.toContain("rtk proxy cat ~/.local/share/rtk/tee/<file>");
    expect(awarenessHookSource).not.toContain("Do not rerun raw commands outside RTK by default");
  });
});
