import { describe, expect, test } from "bun:test";

import { createHeuristicPromptHintCandidate } from "../../plugins/shared/prompt-classifier-contract";

describe("prompt classifier lightweight question routing", () => {
  test("classifies greetings as MINIMAL", () => {
    const candidate = createHeuristicPromptHintCandidate("hello there", "runtime_default");

    expect(candidate.advisory.depth).toBe("MINIMAL");
    expect(candidate.advisory.reasoning_profile).toBe("light");
    expect(candidate.advisory.verbosity).toBe("minimal");
  });

  test("keeps generic short questions at FULL without explicit answer surfaces", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "What does bd ready do?",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("classifies explicit answer-surface read-only questions as MINIMAL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "What does `bd ready` do?",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("MINIMAL");
  });

  test("classifies explicit-file read-only questions as MINIMAL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "In .opencode/plugins/shared/prompt-classifier-contract.ts, what does isGreeting do?",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("MINIMAL");
  });

  test("keeps repo-wide discovery questions at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "Find all places in the repo where prompt hints are classified.",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps non-trivial implementation prompts at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "Implement prompt hint routing updates and add focused tests.",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps command execution requests at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "Run the targeted test suite for prompt routing.",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps greeting-prefixed command execution requests at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "hi run the targeted test suite for prompt routing.",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps greeting-prefixed repo-wide discovery requests at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "hello find all places in the repo where prompt hints are classified.",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps external and web-state requests at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "What is the latest API status for OpenAI today?",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps stronger verification requests at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "Can you prove this fix with evidence from tests?",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps multiline numbered prompts at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "1. Read the classifier.\n2. Update the tests.",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });

  test("keeps multiline bullet prompts at FULL", () => {
    const candidate = createHeuristicPromptHintCandidate(
      "- Read the classifier\n- Update the tests",
      "runtime_default",
    );

    expect(candidate.advisory.depth).toBe("FULL");
  });
});
