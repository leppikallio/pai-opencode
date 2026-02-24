#!/usr/bin/env bun
import { runThreadProjectionHook } from "./lib/thread-projections";

await runThreadProjectionHook({ outputFileName: "RELATIONSHIP_HOOK.md" });
