import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { classifyPromptHint } from "../../plugins/handlers/prompt-hints";
import { classifyPromptToHintEnvelope } from "../../skills/PAI/Tools/PromptClassifier";

const repoRoot =
  path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();

function readDoc(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("PAI lightweight question routing integration contract", () => {
  test("runtime and utility producers keep lightweight/full routing outcomes aligned", async () => {
    const prompts = [
      {
        id: "greeting",
        prompt: "hello there",
        expectedDepth: "MINIMAL",
      },
      {
        id: "generic-short-question",
        prompt: "What does bd ready do?",
        expectedDepth: "FULL",
      },
      {
        id: "explicit-answer-surface-question",
        prompt: "What does `bd ready` do?",
        expectedDepth: "MINIMAL",
      },
      {
        id: "explicit-file-read-only-question",
        prompt:
          "In .opencode/plugins/shared/prompt-classifier-contract.ts, what does isGreeting do?",
        expectedDepth: "MINIMAL",
      },
      {
        id: "repo-wide-discovery",
        prompt: "Find all places in the repo where prompt hints are classified.",
        expectedDepth: "FULL",
      },
      {
        id: "non-trivial-implementation",
        prompt: "Implement prompt hint routing updates and add focused tests.",
        expectedDepth: "FULL",
      },
      {
        id: "command-execution",
        prompt: "Run the targeted test suite for prompt routing.",
        expectedDepth: "FULL",
      },
      {
        id: "greeting-prefixed-command-execution",
        prompt: "hi run the targeted test suite for prompt routing.",
        expectedDepth: "FULL",
      },
      {
        id: "greeting-prefixed-repo-discovery",
        prompt: "hello find all places in the repo where prompt hints are classified.",
        expectedDepth: "FULL",
      },
      {
        id: "external-web-state",
        prompt: "What is the latest API status for OpenAI today?",
        expectedDepth: "FULL",
      },
      {
        id: "stronger-verification",
        prompt: "Can you prove this fix with evidence from tests?",
        expectedDepth: "FULL",
      },
      {
        id: "multiline-numbered",
        prompt: "1. Read the classifier.\n2. Update the tests.",
        expectedDepth: "FULL",
      },
      {
        id: "multiline-bulleted",
        prompt: "- Read the classifier\n- Update the tests",
        expectedDepth: "FULL",
      },
    ] as const;

    for (const scenario of prompts) {
      const runtimeHint = await classifyPromptHint(scenario.prompt, `U-${scenario.id}`, {
        carrierMode: "disabled",
      });
      const utilityHint = await classifyPromptToHintEnvelope(scenario.prompt, {
        carrierMode: "disabled",
      });

      expect(runtimeHint.advisory.depth).toBe(scenario.expectedDepth);
      expect(utilityHint.advisory.depth).toBe(scenario.expectedDepth);
      expect(runtimeHint.advisory).toEqual(utilityHint.advisory);
      expect(runtimeHint.source).toBe("heuristic");
      expect(utilityHint.source).toBe("heuristic");
      expect(runtimeHint.reducer.selectedProducer).toBe("runtime_heuristic");
      expect(utilityHint.reducer.selectedProducer).toBe("runtime_heuristic");
    }
  });

  test("generated SKILL keeps lightweight routing doctrine in sync with source components", () => {
    const formatModeSelection = readDoc(
      ".opencode",
      "skills",
      "PAI",
      "Components",
      "15-format-mode-selection.md",
    );
    const workflowRouting = readDoc(
      ".opencode",
      "skills",
      "PAI",
      "Components",
      "30-workflow-routing.md",
    );
    const skillMd = readDoc(".opencode", "skills", "PAI", "SKILL.md");

    expect(formatModeSelection).toContain("Every prompt enters one routing contract first.");
    expect(skillMd).toContain("Every prompt enters one routing contract first.");

    expect(formatModeSelection).toContain("bounded read-only quick questions");
    expect(skillMd).toContain("bounded read-only quick questions");

    expect(workflowRouting).toContain(
      "Routing-light by default; escalate when FULL triggers appear",
    );
    expect(skillMd).toContain("Routing-light by default; escalate when FULL triggers appear");

    const fullTriggers = [
      "repo-wide discovery",
      "multi-file investigation",
      "edits",
      "command execution",
      "external/web state",
      "destructive/security-sensitive work",
      "material ambiguity",
      "stronger verification needs",
    ] as const;

    for (const trigger of fullTriggers) {
      expect(workflowRouting).toContain(trigger);
      expect(skillMd).toContain(trigger);
    }
  });

  test("doctrine and runtime-facing prompt-hint outputs stay aligned for lightweight boundaries", async () => {
    const formatModeSelection = readDoc(
      ".opencode",
      "skills",
      "PAI",
      "Components",
      "15-format-mode-selection.md",
    );
    const workflowRouting = readDoc(
      ".opencode",
      "skills",
      "PAI",
      "Components",
      "30-workflow-routing.md",
    );
    const skillMd = readDoc(".opencode", "skills", "PAI", "SKILL.md");

    expect(formatModeSelection).toContain("bounded read-only quick questions");
    expect(workflowRouting).toContain("bounded read-only local inspection");
    expect(skillMd).toContain("bounded read-only quick questions");

    const minimalRuntimeHint = await classifyPromptHint("What does `bd ready` do?", "U-minimal", {
      carrierMode: "disabled",
    });
    const fullRuntimeHint = await classifyPromptHint("What does bd ready do?", "U-full", {
      carrierMode: "disabled",
    });

    expect(minimalRuntimeHint.advisory.depth).toBe("MINIMAL");
    expect(fullRuntimeHint.advisory.depth).toBe("FULL");
    expect(minimalRuntimeHint.source).toBe("heuristic");
    expect(fullRuntimeHint.source).toBe("heuristic");
  });
});
