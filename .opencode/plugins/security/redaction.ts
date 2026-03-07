export function redactSensitiveText(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bsk-[A-Za-z0-9]{20,}\b/g, "sk-[REDACTED]"],
    [/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_[REDACTED]"],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[REDACTED]"],
    [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, "xox-[REDACTED]"],
    [
      /(-----BEGIN [A-Z ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+ PRIVATE KEY-----)/g,
      "$1\n[REDACTED]\n$2",
    ],
    [
      /([?&](?:token|key|api_key|apikey|secret|password)=)[^&\s]+/gi,
      "$1[REDACTED]",
    ],
    [/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer [REDACTED]"],
    [/--password\s+\S+/gi, "--password [REDACTED]"],
    [/--token\s+\S+/gi, "--token [REDACTED]"],
    [/AWS\s*SECRET\s*ACCESS\s*KEY\s*=\s*\S+/gi, "AWS_SECRET_ACCESS_KEY<REDACTED>"],
    [/OPENAI\s*API\s*KEY\s*=\s*\S+/gi, "OPENAI_API_KEY<REDACTED>"],
  ];

  let out = text;
  for (const [re, repl] of replacements) {
    out = out.replace(re, repl);
  }

  const max = 240;
  if (out.length > max) {
    out = `${out.slice(0, max)}…`;
  }

  return out;
}
