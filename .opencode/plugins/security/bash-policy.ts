export type BashBypassDetection = { id: string; reason: string };

export function matchesRule<T extends { regex: RegExp }>(rules: T[], command: string): T | null {
  for (const rule of rules) {
    if (rule.regex.test(command)) {
      return rule;
    }
  }

  return null;
}

function stripEnvVarPrefix(command: string): string {
  return command.replace(
    /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)*/,
    "",
  );
}

function hasDestructiveRmFlags(command: string): boolean {
  return /\brm\b[^\n;|&]*-(?:[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r[a-z]*)\b/i.test(command);
}

function hasTraversalTarget(command: string): boolean {
  return /\brm\b[^\n;|&]*-(?:[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r[a-z]*)\b[^\n;|&]*(?:\.\.|\$PWD\/\.\.)/i.test(
    command,
  );
}

function normalizeSimpleCommandSubstitutions(command: string): string {
  return command
    .replace(/\$\(\s*(?:printf|echo)\s+(['"]?)([A-Za-z0-9._-]+)\1\s*\)/gi, "$2")
    .replace(/`\s*(?:printf|echo)\s+(['"]?)([A-Za-z0-9._-]+)\1\s*`/gi, "$2");
}

function extractDecodedBase64Payloads(command: string): string[] {
  const tokens = command.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? [];
  const payloads: string[] = [];

  for (const token of tokens) {
    if (token.length % 4 !== 0) {
      continue;
    }

    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      if (!decoded) {
        continue;
      }

      if (!containsOnlySafeDecodedCharacters(decoded)) {
        continue;
      }

      payloads.push(decoded.trim());
    } catch {
      // Ignore invalid base64 tokens.
    }
  }

  return payloads;
}

function containsOnlySafeDecodedCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) {
      continue;
    }

    if (code < 32 || code > 126) {
      return false;
    }
  }

  return true;
}

export function detectKnownBashBypass(command: string): BashBypassDetection | null {
  const stripped = stripEnvVarPrefix(command).trim();
  const normalized = normalizeSimpleCommandSubstitutions(stripped);

  if (hasTraversalTarget(normalized)) {
    return {
      id: "bash.traversal_destructive",
      reason: "Traversal-shaped destructive rm intent detected",
    };
  }

  if (
    /\bxargs\b[^\n;|&]*\brm\b[^\n;|&]*-(?:[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r[a-z]*)\b/i.test(
      normalized,
    )
  ) {
    return {
      id: "bash.xargs_destructive",
      reason: "xargs-driven destructive rm chain detected",
    };
  }

  const hasSubshellSyntax = /\$\([^)]*\)|`[^`]*`/.test(stripped);
  if (hasSubshellSyntax && hasDestructiveRmFlags(normalized)) {
    return {
      id: "bash.subshell_destructive",
      reason: "Command substitution hides destructive rm intent",
    };
  }

  const hasWrapperExecution =
    /\bbase64\b[^\n;|&]*-\w*d\w*[^\n;|&]*\|\s*(?:bash|sh)\b/i.test(stripped) ||
    /\bpython(?:3)?\b[^\n;|&]*(?:base64\.b64decode|os\.system)/i.test(stripped);

  if (hasWrapperExecution) {
    const decodedPayloads = extractDecodedBase64Payloads(stripped);
    for (const payload of decodedPayloads) {
      if (hasDestructiveRmFlags(payload) || hasTraversalTarget(payload)) {
        return {
          id: "bash.wrapper_destructive",
          reason: "Wrapper/script-dropper decodes destructive payload",
        };
      }
    }
  }

  return null;
}
