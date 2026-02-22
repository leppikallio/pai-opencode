#!/usr/bin/env bun
import { readFileSync } from "node:fs";

import { updateAlgorithmTrackerState } from "./lib/algorithm-tracker";

function readStdinBestEffort(): unknown {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

process.stdout.write('{"continue": true}\n');

try {
  const payload = readStdinBestEffort();
  if (payload) {
    await updateAlgorithmTrackerState(payload);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[AlgorithmTracker] ${message}`);
}
