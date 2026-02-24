#!/usr/bin/env bun
import { runThreadProjectionHook } from "./lib/thread-projections";

await runThreadProjectionHook({ outputFileName: "INTEGRITY_HOOK.md" });
