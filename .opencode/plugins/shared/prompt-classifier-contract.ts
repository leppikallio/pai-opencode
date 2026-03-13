import {
  type AdvisoryHintCandidate,
  type HintProducerMode,
  type PromptDepth,
  type ReasoningProfile,
  type Verbosity,
  createAdvisoryHintCandidate,
} from "./hint-envelope";

type HeuristicHintProducerMode = Extract<HintProducerMode, "runtime_default" | "utility">;

const CONTINUE_PROMPT_RE = /\b(continue|please continue|next step|keep going)\b/i;
const QUESTION_START_RE = /^(what|why|how|when|where|who|can|could|should|would|is|are|do|does|did)\b/i;
const READ_ONLY_QUESTION_RE = /\b(what(?:'s| is)?|what does|explain|describe|summarize|summarise|show|tell me)\b/i;
const EDIT_REQUEST_RE =
  /\b(implement|fix|refactor|add|remove|change|update|modify|create|write|build|debug|optimi[sz]e|rename|migrate|patch)\b/i;
const COMMAND_EXECUTION_RE = /\b(run|execute|test|build|install|deploy|commit|push|start|restart|benchmark)\b/i;
const DISCOVERY_VERB_RE = /\b(find|search|scan|grep|locate|list|enumerate|discover|trace)\b/i;
const REPO_SCOPE_RE = /\b(repo|repository|codebase|project|across files|all files|every file|throughout)\b/i;
const EXTERNAL_STATE_RE =
  /\b(latest|current|today|now|web|internet|online|external|remote|api status|weather|stock|news)\b/i;
const STRONG_VERIFICATION_RE = /\b(verify|validation|prove|evidence|benchmark|measure)\b/i;
const FILE_PATH_RE =
  /(?:^|[\s`'"(])(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.[a-z0-9]+(?:[:#]L?\d+(?::\d+)?)?(?=$|[\s`'"),.!?])/i;
const EXPLICIT_SURFACE_RE = /`[^`]{1,120}`/;

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

function hasFullEscalationSignal(prompt: string, lower: string): boolean {
  if (EDIT_REQUEST_RE.test(lower)) return true;
  if (COMMAND_EXECUTION_RE.test(lower)) return true;
  if (EXTERNAL_STATE_RE.test(lower)) return true;
  if (STRONG_VERIFICATION_RE.test(lower)) return true;
  if (DISCOVERY_VERB_RE.test(lower) && REPO_SCOPE_RE.test(lower)) return true;
  if (/\b(all|every|across|throughout)\b/.test(lower) && /\b(files?|repo|codebase)\b/.test(lower)) {
    return true;
  }
  if (prompt.includes("\n") && /\b(\d+\.|-|\*)\s+/.test(prompt)) {
    return true;
  }
  return false;
}

function isLightweightQuestion(prompt: string, lower: string): boolean {
  if (hasFullEscalationSignal(prompt, lower)) return false;

  const trimmed = prompt.trim();
  const hasQuestionShape = trimmed.endsWith("?") || QUESTION_START_RE.test(lower);
  if (!hasQuestionShape) return false;

  const hasExplicitFileSurface = FILE_PATH_RE.test(prompt);
  const hasExplicitAnswerSurface = EXPLICIT_SURFACE_RE.test(prompt);
  if ((hasExplicitFileSurface || hasExplicitAnswerSurface) && READ_ONLY_QUESTION_RE.test(lower)) {
    return true;
  }

  return false;
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
  const hasFullTrigger = hasFullEscalationSignal(p, lower);

  let depth: PromptDepth = "FULL";
  if (CONTINUE_PROMPT_RE.test(p)) depth = "ITERATION";
  else if (!hasFullTrigger && (isGreeting(p) || isLightweightQuestion(p, lower))) depth = "MINIMAL";

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
