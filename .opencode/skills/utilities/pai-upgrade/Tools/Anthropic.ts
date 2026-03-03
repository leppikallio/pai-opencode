#!/usr/bin/env bun

/**
 * Anthropic.ts - Backward-compatible entry point
 *
 * This wrapper preserves existing command usage while delegating all
 * monitoring logic to MonitorSources.ts.
 */

import { runMonitorCli } from './MonitorSources.ts';

export async function runAnthropicCli(args: string[] = process.argv.slice(2)): Promise<number> {
  return runMonitorCli(args, {
    defaultProvider: 'anthropic',
    programName: 'Anthropic.ts',
    helpTitle: 'Anthropic Changes Monitor (compatibility wrapper)'
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const exitCode = await runAnthropicCli(args);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
