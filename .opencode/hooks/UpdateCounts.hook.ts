#!/usr/bin/env bun

import { handleUpdateCounts } from "./handlers/UpdateCounts";

async function main(): Promise<void> {
  try {
    await handleUpdateCounts();
  } catch (error) {
    console.error("[UpdateCounts] Error:", error);
  }
}

await main();
process.exit(0);
