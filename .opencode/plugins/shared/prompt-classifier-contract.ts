import {
  type AdvisoryHintCandidate,
  type HintProducerMode,
  type PromptDepth,
  type ReasoningProfile,
  type Verbosity,
  createAdvisoryHintCandidate,
} from "./hint-envelope";

type HeuristicHintProducerMode = Extract<HintProducerMode, "runtime_default" | "utility">;

function isGreeting(s: string): boolean {
  const trimmed = s.trim().toLowerCase();
  return (
    trimmed === "hi" ||
    trimmed === "hello" ||
    trimmed === "hey" ||
    trimmed.startsWith("hello ") ||
    trimmed.startsWith("hi ")
  );
}

export const PROMPT_CLASSIFIER_SYSTEM_PROMPT = [
  "You are a classifier for an OpenCode-based Personal AI Infrastructure.",
  "Return ONLY valid JSON that matches this schema:",
  "{",
  '  "depth": "MINIMAL"|"ITERATION"|"FULL",',
  '  "reasoning_profile": "light"|"standard"|"deep",',
  '  "verbosity": "minimal"|"standard"|"detailed",',
  '  "capabilities": ["Engineer"|"Designer"|"QATester"|"Pentester"|"researcher"|"Explore"],',
  '  "thinking_tools": ["FirstPrinciples"|"RedTeam"|"be-creative"|"Council"|"research"|"evals"],',
  '  "confidence": 0.0',
  "}",
  "Do not use tools.",
  "Do not emit imperative fields such as model/spawn/run_in_background/subagent_type.",
  "Use conservative defaults when uncertain.",
].join("\n");

export function createHeuristicPromptHintCandidate(
  prompt: string,
  mode: HeuristicHintProducerMode,
): AdvisoryHintCandidate {
  const p = prompt.trim();
  const lower = p.toLowerCase();

  let depth: PromptDepth = "FULL";
  if (p.length <= 40 && isGreeting(p)) depth = "MINIMAL";
  else if (/\b(continue|please continue|next step|keep going)\b/i.test(p)) depth = "ITERATION";

  let reasoning_profile: ReasoningProfile = "standard";
  if (depth === "MINIMAL") reasoning_profile = "light";
  if (/\b(thorough|very thorough|deep|architecture|system design|detailed plan)\b/i.test(p)) {
    reasoning_profile = "deep";
  }

  let verbosity: Verbosity = "standard";
  if (depth === "MINIMAL") verbosity = "minimal";
  if (/\b(detailed|very detailed|exhaustive)\b/i.test(p)) verbosity = "detailed";

  const capabilities: string[] = [];
  if (/\b(ui|ux|design|layout)\b/i.test(lower)) capabilities.push("Designer");
  if (/\b(test|tests|qa|verify)\b/i.test(lower)) capabilities.push("QATester");
  if (/\b(security|pentest|vuln|threat model)\b/i.test(lower)) capabilities.push("Pentester");
  if (/\b(research|sources|citations)\b/i.test(lower)) capabilities.push("researcher");
  if (/\b(implement|fix|refactor|code)\b/i.test(lower)) capabilities.push("Engineer");
  if (capabilities.length === 0) capabilities.push("Engineer");

  const thinking_tools: string[] = [];
  if (depth === "FULL") {
    thinking_tools.push("FirstPrinciples", "red-team");
    if (/\b(options|ideas|brainstorm)\b/i.test(lower)) thinking_tools.push("be-creative");
  }

  return createAdvisoryHintCandidate({
    producer: "runtime_heuristic",
    mode,
    advisory: {
      depth,
      reasoning_profile,
      verbosity,
      capabilities,
      thinking_tools,
      confidence: 0.55,
    },
  });
}
