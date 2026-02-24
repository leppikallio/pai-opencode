#!/usr/bin/env bun

try {
  process.stdout.write('{"continue": true}\n');
} catch {
  // Never throw from hooks.
}

process.exit(0);
