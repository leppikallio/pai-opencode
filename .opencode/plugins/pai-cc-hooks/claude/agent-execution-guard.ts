export function shouldAskForForegroundTask(input: {
  subagent_type?: string;
  prompt?: string;
}): boolean {
  const agent = (input.subagent_type ?? "").toLowerCase();
  const prompt = input.prompt ?? "";

  if (agent === "explore") return false;
  if (prompt.includes("Timing: FAST")) return false;
  if (prompt.includes("Timing: STANDARD") || prompt.includes("Timing: DEEP")) return true;
  if (prompt.length > 800) return true;
  if (/\b(run tests|build|implement|refactor|debug|investigate)\b/i.test(prompt)) return true;
  return false;
}
