export function getCliArgv(argv: string[] = process.argv.slice(2)): string[] {
  return argv;
}

export function isJsonModeRequested(argv: string[]): boolean {
  return argv.includes("--json");
}

export function configureStdoutForJsonMode(enabled: boolean): void {
  if (!enabled) return;

  // Hard contract: in --json mode, reserve stdout for exactly one JSON object.
  // Any incidental console.log output is redirected to stderr.
  console.log = (...args: unknown[]): void => {
    console.error(...args);
  };
}

export function emitJson(payload: unknown): void {
  // LLM/operator contract: JSON mode prints exactly one parseable object.
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
