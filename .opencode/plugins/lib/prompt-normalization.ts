export function normalizePromptForArtifacts(prompt: string): string {
  return prompt.replace(/\r\n?/g, "\n").trim();
}
