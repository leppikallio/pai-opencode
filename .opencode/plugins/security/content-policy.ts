export function checkPromptInjection(content: string): boolean {
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+/i,
    /system\s*:\s*you\s+are/i,
    /override\s+security/i,
    /disable\s+safety/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}
